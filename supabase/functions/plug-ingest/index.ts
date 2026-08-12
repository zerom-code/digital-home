/**
 * plug-ingest — приём замеров от моста, стоящего в домашней сети.
 *
 * Почему это отдельная функция, а не запись из браузера. Розетка отвечает по
 * http, в локальной сети и без CORS. Страница на https до неё не достучится
 * никогда, поэтому опрашивает розетку отдельная программа (tools/tapo-bridge)
 * и присылает готовые числа сюда.
 *
 * Почему свой ключ, а не вход по паролю хозяина. Мост крутится на Raspberry
 * Pi без экрана, его ключ легко может утечь. Поэтому у него собственный
 * отзываемый токен, ограниченный одним домом и одним действием — прислать
 * замер. Токен хранится в базе хешем (0008_plugs.sql).
 *
 * Развёртывание (без проверки JWT — у моста нет аккаунта Supabase):
 *   supabase functions deploy plug-ingest --no-verify-jwt
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { bearer, fail, json, preflight } from '../_shared/http.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * Как часто добавляем строку в историю.
 *
 * Мост опрашивает розетку раз в несколько секунд — это нужно, чтобы «сейчас»
 * было действительно сейчас. Но писать каждый опрос в историю нельзя: это
 * 17 тысяч строк в сутки на розетку. Живое значение перезаписывается в самой
 * smart_plugs, а сюда падает точка раз в пять минут — этого хватает на график
 * и не съедает базу.
 */
const HISTORY_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Потолок правдоподобия, Вт.
 *
 * Розетка отдаёт мощность в милливаттах, мост переводит в ватты. Если
 * перевод где-то потеряется, сюда приедет число в тысячу раз больше — и
 * молча превратится в счёт на десятки тысяч гривен. Бытовая розетка на 230 В
 * физически не отдаст больше ~3.7 кВт, сама P110 рассчитана на 2300 Вт.
 * Поэтому всё, что выше, — это не рекорд потребления, а ошибка единиц.
 */
const MAX_PLAUSIBLE_W = 4000;

interface Payload {
  device_id?: unknown;
  name?: unknown;
  power_w?: unknown;
  today_wh?: unknown;
  month_wh?: unknown;
}

Deno.serve(async (request) => {
  const cors = preflight(request);
  if (cors) return cors;

  const token = bearer(request);
  if (!token) return fail('Нужен ключ моста', 401);

  const body = (await request.json().catch(() => null)) as Payload | null;
  if (!body) return fail('Тело запроса не разобралось');

  const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : '';
  if (!deviceId) return fail('Нужен device_id');

  const powerW = finite(body.power_w);
  const todayWh = finite(body.today_wh);
  const monthWh = finite(body.month_wh);

  // Отрицательной мощности у розетки не бывает, а запредельная означает, что
  // милливатты не перевели в ватты. И то и другое лучше отбить здесь, чем
  // показать человеку счёт с лишним нулём
  if (powerW !== null && (powerW < 0 || powerW > MAX_PLAUSIBLE_W)) {
    return fail(
      `Мощность ${powerW} Вт неправдоподобна — похоже, милливатты не переведены в ватты`
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Ключ ищем по хешу: в базе лежит только он
  const hash = await sha256Hex(token);
  const { data: keyRow } = await admin
    .from('plug_tokens')
    .select('id, household_id, revoked_at')
    .eq('token_hash', hash)
    .maybeSingle();

  if (!keyRow || keyRow.revoked_at) return fail('Ключ недействителен', 403);

  const householdId = keyRow.household_id;
  const now = new Date();

  // Розетка заводится сама при первом же замере: заставлять человека вручную
  // переписывать device_id из консоли — верный способ до пользы не дойти.
  // Привязку к вещи он сделает уже в приложении
  const { data: plug, error: upsertError } = await admin
    .from('smart_plugs')
    .upsert(
      {
        household_id: householdId,
        device_id: deviceId,
        ...(typeof body.name === 'string' && body.name ? { name: body.name } : {}),
        last_power_w: powerW,
        last_seen_at: now.toISOString(),
        today_wh: todayWh,
        month_wh: monthWh,
      },
      { onConflict: 'household_id,device_id' }
    )
    .select('id, item_id')
    .single();

  if (upsertError) return fail(upsertError.message, 500);

  // Историю прореживаем: смотрим, когда клали прошлую точку
  const { data: last } = await admin
    .from('plug_readings')
    .select('measured_at')
    .eq('plug_id', plug.id)
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const dueForHistory =
    !last || now.getTime() - new Date(last.measured_at).getTime() >= HISTORY_INTERVAL_MS;

  if (dueForHistory) {
    await admin.from('plug_readings').insert({
      household_id: householdId,
      plug_id: plug.id,
      measured_at: now.toISOString(),
      power_w: powerW,
      today_wh: todayWh,
    });
  }

  // Отметка живости ключа — чтобы в приложении было видно, что мост на связи,
  // и чтобы забытый ключ можно было опознать и отозвать
  await admin
    .from('plug_tokens')
    .update({ last_used_at: now.toISOString() })
    .eq('id', keyRow.id);

  return json({ ok: true, plug_id: plug.id, stored_history: dueForHistory });
});

/** Число или null: пустые и мусорные значения не должны стать нулём. */
function finite(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
