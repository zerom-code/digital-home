/**
 * ai-scan-room — фото комнаты → список техники для создания.
 *
 * Сценарий A-tier из docs/08-ai.md: «сфоткай кухню» вместо «заполни форму».
 * Модель находит на снимке приборы и предлагает создать карточки —
 * пользователь снимает галочки с лишнего.
 *
 * Железные правила (ADR-008, ADR-009):
 *   — ключ OpenAI живёт только здесь, на клиент не попадает никогда;
 *   — модель возвращает черновик списка, а не пишет карточки в базу;
 *   — все предложенные категории берутся из справочника, новых нет.
 *
 * Развёртывание:
 *   supabase functions deploy ai-scan-room
 *   supabase secrets set OPENAI_API_KEY=sk-...
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { bearer, fail, json, preflight } from '../_shared/http.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY')!;

const MODEL = 'gpt-4o-mini';
/** Дневной потолок на семью — защита от ошибки в коде, а не от человека. */
const DAILY_LIMIT = 50;

/** Стоимость gpt-4o-mini за миллион токенов, для учёта в ai_usage. */
const PRICE_IN = 0.15 / 1_000_000;
const PRICE_OUT = 0.6 / 1_000_000;

const SCHEMA = {
  name: 'room_scan',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'category_id', 'brand', 'confidence'],
          properties: {
            name: { type: 'string' },
            category_id: { type: ['string', 'null'] },
            brand: { type: ['string', 'null'] },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
        },
      },
    },
  },
} as const;

const PROMPT = `На фотографии комнаты в доме. Найди всю видимую бытовую технику.
Для каждого прибора определи:
— название (как его назвал бы хозяин);
— марку (если видна);
— подходящую категорию из переданного списка;
— уверенность (low если снимок нечёткий, объект частично скрыт или сомнение в типе).

Возвращай только то, что ясно видно. Предположительные объекты (может быть,
холодильник, похоже на посудомойку) пропускай — лучше мало, чем много ошибок.`;

Deno.serve(async (request) => {
  const cors = preflight(request);
  if (cors) return cors;

  const token = bearer(request);
  if (!token) return fail('Нужно войти в приложение', 401);

  // 1. Кто это. Клиент под своим токеном — RLS работает как обычно
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: auth } = await asUser.auth.getUser();
  if (!auth?.user) return fail('Нужно войти в приложение', 401);

  const body = await request.json().catch(() => null);
  const householdId: string | undefined = body?.householdId;
  const imageBase64: string | undefined = body?.image;
  const categories: { id: string; name: string }[] = body?.categories ?? [];

  if (!householdId || !imageBase64) return fail('Нужны householdId и image');

  // 2. Он правда в этой семье? Проверяем через его же токен: RLS вернёт
  // пусто, если нет
  const { data: membership } = await asUser
    .from('household_members')
    .select('role')
    .eq('household_id', householdId)
    .maybeSingle();

  if (!membership) {
    return fail('Нет доступа к этому дому', 403);
  }

  // 3. Дальше нужна служебная роль для проверки квот
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: settings } = await admin
    .from('ai_settings')
    .select('enabled')
    .eq('household_id', householdId)
    .maybeSingle();

  if (!settings?.enabled) {
    return fail('Сканирование выключено. Включите его в настройках семьи.', 403);
  }

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await admin
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', householdId)
    .gte('created_at', since);

  if ((count ?? 0) >= DAILY_LIMIT) {
    return fail('На сегодня лимит сканирований исчерпан', 429);
  }

  // 4. Кеш: один и тот же снимок не сканируется дважды
  const hash = await sha256(imageBase64);
  const { data: cached } = await admin
    .from('ai_cache')
    .select('result')
    .eq('input_hash', hash)
    .maybeSingle();

  if (cached) return json({ ...cached.result, cached: true });

  // 5. Собственно сканирование
  const hint = categories.length
    ? `\n\nДопустимые категории (используй id из списка, не выдумывай новые):\n${categories.map((c) => `${c.id} — ${c.name}`).join('\n')}`
    : '';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT + hint },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('OpenAI ответил ошибкой:', response.status, detail);
    return fail('Не получилось отсканировать комнату. Попробуйте другой снимок.', 502);
  }

  const completion = await response.json();
  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) return fail('Пустой ответ модели', 502);

  let extracted: Record<string, unknown>;
  try {
    extracted = JSON.parse(raw);
  } catch {
    return fail('Ответ модели не разобрался', 502);
  }

  // 6. Учёт расхода — до того, как ответить
  const usage = completion.usage ?? {};
  await admin.from('ai_usage').insert({
    household_id: householdId,
    user_id: auth.user.id,
    feature: 'room_scan',
    model: MODEL,
    tokens_in: usage.prompt_tokens ?? null,
    tokens_out: usage.completion_tokens ?? null,
    cost_usd:
      (usage.prompt_tokens ?? 0) * PRICE_IN + (usage.completion_tokens ?? 0) * PRICE_OUT,
  });

  await admin
    .from('ai_cache')
    .upsert({ input_hash: hash, feature: 'room_scan', model: MODEL, result: extracted });

  return json({ ...extracted, cached: false });
});

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
