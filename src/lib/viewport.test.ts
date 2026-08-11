import { describe, it, expect } from 'vitest';

import { measureShell } from './viewport';
import type { ViewportReading } from './viewport';

/** iPhone 14 в браузере: слой разметки 844, видимая область меньше на панели. */
const inBrowser: ViewportReading = {
  innerHeight: 844,
  visualHeight: 764,
  visualOffsetTop: 0,
  isStandalone: false,
};

/** Оно же с домашнего экрана: панелей нет, видно всё. */
const installed: ViewportReading = {
  innerHeight: 844,
  visualHeight: 844,
  visualOffsetTop: 0,
  isStandalone: true,
};

describe('measureShell в браузере', () => {
  it('берёт видимую область, а не слой разметки', () => {
    // Ради этого всё и затевалось: 100vh дал бы 844 и увёл бы нижнюю
    // панель под панель Safari
    expect(measureShell(inBrowser, 844).appHeight).toBe(764);
  });

  it('округляет дробные размеры', () => {
    expect(measureShell({ ...inBrowser, visualHeight: 763.5 }, 844).appHeight).toBe(764);
  });

  it('не считает клавиатурой мелкий зазор', () => {
    // Панель Safari, строка «Найти на странице» — всё это низкое, и
    // оболочку из-за них дёргать нельзя
    expect(measureShell(inBrowser, 844).keyboardHeight).toBe(0);
  });

  it('видит поднятую клавиатуру', () => {
    expect(measureShell({ ...inBrowser, visualHeight: 508 }, 844).keyboardHeight).toBe(336);
  });

  it('не пересчитывает оболочку, пока клавиатура поднята', () => {
    expect(measureShell({ ...inBrowser, visualHeight: 508 }, 764).appHeight).toBe(764);
  });

  it('учитывает сдвиг видимой области к полю ввода', () => {
    // iOS подводит поле к клавиатуре, сдвигая видимую область вниз. Важно
    // не насколько высока клавиатура, а сколько не видно у низа окна
    const reading = { ...inBrowser, visualHeight: 508, visualOffsetTop: 100 };
    expect(measureShell(reading, 764)).toEqual({ appHeight: 764, keyboardHeight: 236 });
  });
});

describe('measureShell в установленном приложении', () => {
  it('без клавиатуры высота окна — вся высота', () => {
    expect(measureShell(installed, 844)).toEqual({ appHeight: 844, keyboardHeight: 0 });
  });

  // ── Ради этого случая логику и пришлось переделать ──────────────────────

  it('держит высоту, когда клавиатура проседает и innerHeight тоже', () => {
    // На iOS с домашнего экрана при поднятой клавиатуре проседают ОБА
    // размера. Раньше расхождения не находилось, клавиатура не опознавалась,
    // и оболочка ужималась до щели над ней: таббар уезжал на середину экрана
    const withKeyboard: ViewportReading = {
      innerHeight: 508,
      visualHeight: 508,
      visualOffsetTop: 0,
      isStandalone: true,
    };
    expect(measureShell(withKeyboard, 844)).toEqual({ appHeight: 844, keyboardHeight: 336 });
  });

  it('не раскладывается обратно меньше запомненного', () => {
    // Именно на этом всё и застревало: следующий замер приходил с той же
    // просевшей высотой, и оболочка оставалась сплющенной навсегда
    const shrunk: ViewportReading = {
      innerHeight: 508,
      visualHeight: 508,
      visualOffsetTop: 0,
      isStandalone: true,
    };
    expect(measureShell(shrunk, 844).appHeight).toBe(844);
    expect(measureShell(shrunk, measureShell(shrunk, 844).appHeight).appHeight).toBe(844);
  });

  it('чинит себя, если первый замер попал на поднятую клавиатуру', () => {
    // Запомнили маленькую высоту — но как только окно показало больше,
    // запомненное подрастает
    const learned = measureShell(installed, 508);
    expect(learned.appHeight).toBe(844);
  });

  it('клавиатуру меряет от запомненной высоты, а не от innerHeight', () => {
    // innerHeight здесь врёт вместе с видимой областью, и разница между
    // ними нулевая — считать надо от настоящей высоты окна
    const withKeyboard: ViewportReading = {
      innerHeight: 500,
      visualHeight: 500,
      visualOffsetTop: 0,
      isStandalone: true,
    };
    expect(measureShell(withKeyboard, 844).keyboardHeight).toBe(344);
  });

  it('обходится без visualViewport', () => {
    const reading: ViewportReading = {
      innerHeight: 640,
      visualHeight: null,
      visualOffsetTop: 0,
      isStandalone: true,
    };
    expect(measureShell(reading, 640)).toEqual({ appHeight: 640, keyboardHeight: 0 });
  });
});
