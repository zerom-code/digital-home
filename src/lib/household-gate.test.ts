import { describe, it, expect } from 'vitest';

import { decideScreen } from './household-gate';
import type { HouseholdGate } from './household-gate';

/** Всё спокойно: сервер ответил, дом есть. */
const base: HouseholdGate = {
  isConfirmed: true,
  hasHousehold: true,
  isLoading: false,
  hasError: false,
  isJoining: false,
};

const gate = (patch: Partial<HouseholdGate>): HouseholdGate => ({ ...base, ...patch });

describe('decideScreen', () => {
  it('дом есть — показываем приложение', () => {
    expect(decideScreen(base)).toBe('app');
  });

  it('сервер ответил, семей нет — только тогда онбординг', () => {
    expect(decideScreen(gate({ hasHousehold: false }))).toBe('onboarding');
  });

  // ── Ради этих четырёх случаев всё и вынесено в отдельную функцию:
  // каждый из них раньше уводил в онбординг и заводил второй дом ──────────

  it('ответа ещё нет — ждём, а не предлагаем создать дом', () => {
    // Запрос стоит на паузе, пока не восстановлена сессия: под RLS запрос
    // без токена вернул бы честное «семей нет»
    expect(decideScreen(gate({ hasHousehold: false, isConfirmed: false }))).toBe('loading');
  });

  it('запрос ещё идёт — ждём', () => {
    expect(
      decideScreen(gate({ hasHousehold: false, isConfirmed: false, isLoading: true }))
    ).toBe('loading');
  });

  it('сеть отвалилась и кеша нет — ошибка, а не онбординг', () => {
    expect(
      decideScreen(gate({ hasHousehold: false, isConfirmed: false, hasError: true }))
    ).toBe('error');
  });

  it('ошибка не важна, пока дом есть в кеше', () => {
    // Офлайн: показать сохранённую квартиру правильнее, чем экран ошибки
    expect(decideScreen(gate({ hasError: true, isConfirmed: false }))).toBe('app');
  });

  it('кеш показываем, не дожидаясь ответа сервера', () => {
    expect(decideScreen(gate({ isConfirmed: false }))).toBe('app');
  });

  it('пришедшего по приглашению в онбординг не уводим', () => {
    // Дом у него будет чужой, создавать свой не нужно
    expect(decideScreen(gate({ hasHousehold: false, isJoining: true }))).toBe('app');
  });

  it('ошибка важнее приглашения: без ответа код не проверить', () => {
    expect(
      decideScreen(gate({ hasHousehold: false, isJoining: true, hasError: true, isConfirmed: false }))
    ).toBe('error');
  });
});
