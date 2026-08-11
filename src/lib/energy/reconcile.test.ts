import { describe, it, expect } from 'vitest';

import { reconcile, CLOSE_ENOUGH } from './reconcile';

describe('reconcile', () => {
  it('сверять не с чем без расчёта', () => {
    expect(reconcile(null, 300).verdict).toBe('no_data');
  });

  it('сверять не с чем без показаний', () => {
    expect(reconcile(250, null).verdict).toBe('no_data');
  });

  it('нулевой расход не повод делить на ноль', () => {
    expect(reconcile(250, 0).verdict).toBe('no_data');
  });

  it('совпадение в пределах погрешности модели', () => {
    const result = reconcile(280, 300);
    expect(result.verdict).toBe('close');
    expect(result.diffKwh).toBe(20);
    expect(result.diffShare).toBeCloseTo(20 / 300, 6);
  });

  it('ровно на границе ещё считается совпадением', () => {
    // 15 % от 300 — это 45; строгое неравенство отправило бы в «under»
    // случай, который мы сами объявили допустимым
    const result = reconcile(300 - 300 * CLOSE_ENOUGH, 300);
    expect(result.verdict).toBe('close');
  });

  it('расчёт заметно меньше факта — что-то не внесено', () => {
    const result = reconcile(150, 300);
    expect(result.verdict).toBe('under');
    expect(result.diffKwh).toBe(150);
    expect(result.diffShare).toBeCloseTo(0.5, 6);
  });

  it('расчёт заметно больше факта — параметры завышены', () => {
    const result = reconcile(400, 200);
    expect(result.verdict).toBe('over');
    expect(result.diffKwh).toBe(-200);
    expect(result.diffShare).toBeCloseTo(1, 6);
  });

  it('доля считается от факта, а не от расчёта', () => {
    // От расчёта та же разница дала бы другую долю, и «сошлось» зависело бы
    // от того, с какой стороны смотреть
    expect(reconcile(100, 200).diffShare).toBeCloseTo(0.5, 6);
    expect(reconcile(200, 100).diffShare).toBeCloseTo(1, 6);
  });
});
