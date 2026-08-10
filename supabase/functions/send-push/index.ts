/**
 * send-push — разбирает очередь уведомлений.
 *
 * Вызывается по расписанию (pg_cron через pg_net) или вручную. Читает
 * notifications со статусом queued, шлёт на все живые подписки пользователя,
 * помечает результат.
 *
 * Развёртывание:
 *   supabase functions deploy send-push --no-verify-jwt
 *   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
 *                        VAPID_SUBJECT=mailto:you@example.com \
 *                        CRON_SECRET=...
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

import { corsHeaders, fail, json, preflight } from '../_shared/http.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
const CRON_SECRET = Deno.env.get('CRON_SECRET');

/** За один заход берём не всё: функция ограничена по времени выполнения. */
const BATCH = 100;
/** Сколько раз пробуем, прежде чем признать уведомление недоставленным. */
const MAX_ATTEMPTS = 3;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async (request) => {
  const cors = preflight(request);
  if (cors) return cors;

  // Функция ходит под service role, поэтому снаружи её должен звать только
  // тот, кто знает секрет расписания
  if (CRON_SECRET && request.headers.get('x-cron-secret') !== CRON_SECRET) {
    return fail('Нет доступа', 401);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const { data: pending, error } = await supabase
    .from('notifications')
    .select('id, user_id, title, body, url, attempts')
    .eq('status', 'queued')
    .lte('send_after', new Date().toISOString())
    .limit(BATCH);

  if (error) return fail(error.message, 500);
  if (!pending?.length) return json({ sent: 0, failed: 0 });

  const userIds = [...new Set(pending.map((n) => n.user_id).filter(Boolean))];

  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth_key')
    .in('user_id', userIds)
    .is('failed_at', null);

  const byUser = new Map<string, typeof subscriptions>();
  for (const sub of subscriptions ?? []) {
    const list = byUser.get(sub.user_id) ?? [];
    list.push(sub);
    byUser.set(sub.user_id, list);
  }

  let sent = 0;
  let failed = 0;
  const deadSubscriptions: string[] = [];

  for (const notification of pending) {
    const targets = byUser.get(notification.user_id ?? '') ?? [];

    // Подписок нет — человек не разрешил уведомления. Это не ошибка,
    // просто пропускаем, чтобы очередь не забивалась навсегда
    if (targets.length === 0) {
      await supabase
        .from('notifications')
        .update({ status: 'skipped', error: 'нет активных подписок' })
        .eq('id', notification.id);
      continue;
    }

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body ?? '',
      url: notification.url ?? '/',
      tag: notification.id,
    });

    let delivered = false;

    for (const target of targets) {
      try {
        await webpush.sendNotification(
          {
            endpoint: target.endpoint,
            keys: { p256dh: target.p256dh, auth: target.auth_key },
          },
          payload
        );
        delivered = true;
      } catch (pushError) {
        const status = (pushError as { statusCode?: number }).statusCode;
        // 404 и 410 означают, что подписка мертва: браузер удалён,
        // приложение снесено. Больше в неё не стучимся
        if (status === 404 || status === 410) deadSubscriptions.push(target.id);
      }
    }

    if (delivered) {
      sent++;
      await supabase
        .from('notifications')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', notification.id);
    } else {
      failed++;
      const attempts = (notification.attempts ?? 0) + 1;
      await supabase
        .from('notifications')
        .update({
          attempts,
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
          send_after: new Date(Date.now() + attempts * 3600_000).toISOString(),
          error: 'не удалось доставить',
        })
        .eq('id', notification.id);
    }
  }

  if (deadSubscriptions.length > 0) {
    await supabase
      .from('push_subscriptions')
      .update({ failed_at: new Date().toISOString() })
      .in('id', deadSubscriptions);
  }

  return new Response(
    JSON.stringify({ sent, failed, dead: deadSubscriptions.length }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
