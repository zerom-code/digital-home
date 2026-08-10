/**
 * Коды приглашений в семью.
 *
 * Код генерируется на клиенте и вставляется в household_invites; уникальность
 * гарантирует ограничение в базе. Алфавит без похожих символов: код диктуют
 * вслух и переписывают с чужого экрана, поэтому 0/O и 1/I/L должны
 * различаться.
 */

/** Алфавит без 0, O, 1, I, L — их путают при переписывании. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Длина кода. 8 символов из 31 — примерно 40 бит, коллизий не будет. */
const CODE_LENGTH = 8;

/** Как код показывается человеку: DHKM-7PQR. */
const GROUP_SIZE = 4;

/**
 * Генерирует код приглашения.
 *
 * Использует crypto.getRandomValues: Math.random для того, что даёт доступ
 * к чужой квартире, не годится.
 */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);

  let code = '';
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}

/**
 * Приводит введённый или вставленный код к каноническому виду.
 *
 * Принимает всё, что человек может вставить: код с дефисами, в нижнем
 * регистре, с пробелами по краям и даже целиком ссылку-приглашение.
 * Возвращает null, если распознать не удалось.
 */
export function parseInviteCode(input: string): string | null {
  if (!input) return null;

  let raw = input.trim();

  // Вставили ссылку целиком: /#/join/DHKM7PQR (текущий формат, ADR-017),
  // /join/DHKM7PQR (старые ссылки без хэш-роутера) или ?code=DHKM7PQR
  const fromUrl = raw.match(/(?:code=|\/join\/)([^&/?#\s]+)/i);
  if (fromUrl?.[1]) raw = fromUrl[1];

  const cleaned = raw.toUpperCase().replace(/[\s\-—–_]/g, '');

  // Символов 0, O, 1, I, L в алфавите нет вовсе. Если они встретились —
  // код переписали с ошибкой, и угадать замену нельзя: молча выбрасывать
  // их опаснее, чем попросить проверить код.
  if (/[0O1IL]/.test(cleaned)) return null;

  const candidate = [...cleaned].filter((ch) => ALPHABET.includes(ch)).join('');

  return candidate.length === CODE_LENGTH ? candidate : null;
}

/** Формат для показа: DHKM-7PQR. */
export function formatInviteCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += GROUP_SIZE) {
    groups.push(code.slice(i, i + GROUP_SIZE));
  }
  return groups.join('-');
}

/**
 * Ссылка-приглашение, которую отправляют в мессенджере.
 *
 * С «/#/» — приложение живёт за хэш-роутером (ADR-017), чтобы прямые
 * ссылки работали и на GitHub Pages, который не умеет доигрывать пути на
 * сервере.
 */
export function inviteUrl(code: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, '')}/#/join/${code}`;
}
