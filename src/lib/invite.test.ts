import { describe, it, expect } from 'vitest';

import {
  generateInviteCode,
  parseInviteCode,
  formatInviteCode,
  inviteUrl,
} from './invite';

describe('generateInviteCode', () => {
  it('делает код из 8 символов', () => {
    expect(generateInviteCode()).toHaveLength(8);
  });

  it('не использует символы, которые путают при переписывании', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateInviteCode()).not.toMatch(/[0O1IL]/);
    }
  });

  it('не повторяется', () => {
    const codes = new Set(Array.from({ length: 500 }, generateInviteCode));
    expect(codes.size).toBe(500);
  });

  it('порождает коды, которые сам же и разбирает', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode();
      expect(parseInviteCode(formatInviteCode(code))).toBe(code);
    }
  });
});

describe('parseInviteCode', () => {
  it('принимает код как есть', () => {
    expect(parseInviteCode('DHKM7PQR')).toBe('DHKM7PQR');
  });

  it('принимает код с дефисом — так он показан на экране', () => {
    expect(parseInviteCode('DHKM-7PQR')).toBe('DHKM7PQR');
  });

  it('не придирается к регистру и пробелам', () => {
    expect(parseInviteCode('  dhkm 7pqr ')).toBe('DHKM7PQR');
  });

  it('достаёт код из вставленной ссылки', () => {
    expect(parseInviteCode('https://domovoy.app/join/DHKM7PQR')).toBe('DHKM7PQR');
    expect(parseInviteCode('https://domovoy.app/j?code=DHKM7PQR&utm=tg')).toBe('DHKM7PQR');
  });

  it('отказывается угадывать при спутанных символах', () => {
    // O вместо Q, l вместо 1 — замену не угадать, лучше попросить проверить
    expect(parseInviteCode('DHKM7POR')).toBeNull();
    expect(parseInviteCode('DHKM7PQl')).toBeNull();
  });

  it('отвергает код неверной длины', () => {
    expect(parseInviteCode('DHKM')).toBeNull();
    expect(parseInviteCode('DHKM7PQRS')).toBeNull();
  });

  it('отвергает пустой ввод', () => {
    expect(parseInviteCode('')).toBeNull();
    expect(parseInviteCode('   ')).toBeNull();
  });
});

describe('formatInviteCode', () => {
  it('разбивает на группы по четыре', () => {
    expect(formatInviteCode('DHKM7PQR')).toBe('DHKM-7PQR');
  });
});

describe('inviteUrl', () => {
  it('склеивает ссылку', () => {
    expect(inviteUrl('DHKM7PQR', 'https://domovoy.app')).toBe(
      'https://domovoy.app/join/DHKM7PQR'
    );
  });

  it('не удваивает слэш', () => {
    expect(inviteUrl('DHKM7PQR', 'https://domovoy.app/')).toBe(
      'https://domovoy.app/join/DHKM7PQR'
    );
  });
});
