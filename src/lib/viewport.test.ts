import { describe, it, expect } from 'vitest';

import { measureShell } from './viewport';

/** iPhone 14: слой разметки 844, видимая область меньше на панели Safari. */
const inBrowser = { innerHeight: 844, visualHeight: 764, visualOffsetTop: 0 };

/** Она же на домашнем экране: панелей нет, видно всё. */
const standalone = { innerHeight: 844, visualHeight: 844, visualOffsetTop: 0 };

describe('measureShell', () => {
  it('берёт видимую область, а не слой разметки', () => {
    // Ради этого всё и затевалось: 100vh дал бы 844 и увёл бы нижнюю
    // панель под панель Safari
    expect(measureShell(inBrowser, 844).appHeight).toBe(764);
  });

  it('на домашнем экране обе высоты совпадают', () => {
    expect(measureShell(standalone, 844)).toEqual({ appHeight: 844, keyboardHeight: 0 });
  });

  it('округляет дробные размеры', () => {
    const reading = { innerHeight: 844, visualHeight: 763.5, visualOffsetTop: 0 };
    expect(measureShell(reading, 844).appHeight).toBe(764);
  });

  it('не считает клавиатурой мелкий зазор', () => {
    // Строка статуса, панель Safari, полоска «Найти на странице» — всё это
    // низкое, и оболочку из-за них дёргать нельзя
    const reading = { innerHeight: 844, visualHeight: 764, visualOffsetTop: 0 };
    expect(measureShell(reading, 844).keyboardHeight).toBe(0);
  });

  it('видит поднятую клавиатуру', () => {
    const reading = { innerHeight: 844, visualHeight: 508, visualOffsetTop: 0 };
    expect(measureShell(reading, 844).keyboardHeight).toBe(336);
  });

  it('не пересчитывает оболочку, пока клавиатура поднята', () => {
    // Иначе интерфейс сплющивался бы на время ввода и раскладывался обратно
    const reading = { innerHeight: 844, visualHeight: 508, visualOffsetTop: 0 };
    expect(measureShell(reading, 764).appHeight).toBe(764);
  });

  it('учитывает сдвиг видимой области к полю ввода', () => {
    // iOS подводит поле к клавиатуре, сдвигая видимую область вниз. Нам
    // важно не насколько высока сама клавиатура, а сколько не видно у низа
    // слоя разметки — от него отсчитываются всплывающие листы
    const reading = { innerHeight: 844, visualHeight: 508, visualOffsetTop: 100 };
    expect(measureShell(reading, 764)).toEqual({ appHeight: 764, keyboardHeight: 236 });
  });

  it('обходится без visualViewport', () => {
    const reading = { innerHeight: 640, visualHeight: null, visualOffsetTop: 0 };
    expect(measureShell(reading, 640)).toEqual({ appHeight: 640, keyboardHeight: 0 });
  });
});
