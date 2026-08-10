#!/usr/bin/env node
// ============================================================================
// make-icons.mjs — иконки приложения
//
// PWA нельзя поставить на домашний экран без PNG нужных размеров, а
// библиотеки для картинок ставить ради трёх файлов не хочется. Пишем PNG
// сами: формат простой, а zlib есть во встроенных модулях Node.
//
//   node scripts/make-icons.mjs
// ============================================================================

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ACCENT = [0x1b, 0x6e, 0x4a];
const PAPER = [0xf4, 0xf6, 0xf2];

/* ─── Минимальный кодировщик PNG ─────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** rgba — функция (x, y) → [r, g, b, a]. */
function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;

  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // фильтр строки: None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = rgba(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // бит на канал
  ihdr[9] = 6;  // цветовой тип: RGBA
  ihdr[10] = 0; // сжатие
  ihdr[11] = 0; // фильтрация
  ihdr[12] = 0; // без интерлейса

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ─── Рисунок: домик ─────────────────────────────────────────────────────── */

/**
 * Силуэт дома: треугольная крыша и корпус с дверью.
 *
 * maskable-иконка обрезается системой по кругу, поэтому рисунок ужимается
 * к центру — иначе Android срежет крышу.
 */
function house(size, { maskable }) {
  const pad = maskable ? 0.28 : 0.16;
  const inner = 1 - pad * 2;

  return (px, py) => {
    const x = (px + 0.5) / size;
    const y = (py + 0.5) / size;

    const bg = maskable ? ACCENT : PAPER;
    const fg = maskable ? PAPER : ACCENT;

    // Фон: у обычной иконки — скруглённый квадрат, у maskable — заливка
    if (!maskable) {
      const r = 0.22;
      const dx = Math.max(r - x, x - (1 - r), 0);
      const dy = Math.max(r - y, y - (1 - r), 0);
      if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
    }

    const u = (x - pad) / inner;
    const v = (y - pad) / inner;

    let inside = false;

    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      const roofBase = 0.46;
      if (v <= roofBase) {
        // Крыша: треугольник от конька вниз
        const half = (v / roofBase) * 0.5;
        inside = u >= 0.5 - half && u <= 0.5 + half;
      } else {
        // Корпус
        inside = u >= 0.14 && u <= 0.86 && v <= 0.97;
        // Дверной проём
        if (inside && v >= 0.66 && u >= 0.4 && u <= 0.6) inside = false;
      }
    }

    return inside ? [...fg, 255] : [...bg, 255];
  };
}

/* ─── Запись файлов ──────────────────────────────────────────────────────── */

const targets = [
  { file: 'public/icons/icon-192.png', size: 192, maskable: false },
  { file: 'public/icons/icon-512.png', size: 512, maskable: false },
  { file: 'public/icons/icon-maskable-512.png', size: 512, maskable: true },
  { file: 'public/apple-touch-icon.png', size: 180, maskable: true },
];

for (const target of targets) {
  const png = encodePng(target.size, house(target.size, { maskable: target.maskable }));
  const path = join(root, target.file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  console.log(`${target.file}  ${target.size}×${target.size}  ${(png.length / 1024).toFixed(1)} КБ`);
}

// Векторный favicon: в браузере он чётче любого PNG
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="#f4f6f2"/>
  <path d="M50 18 L82 55 L68 55 L68 82 L58 82 L58 64 L42 64 L42 82 L32 82 L32 55 L18 55 Z" fill="#1b6e4a"/>
</svg>
`;
writeFileSync(join(root, 'public', 'favicon.svg'), favicon);
console.log('public/favicon.svg');
