/**
 * Локальный поиск по уже загруженным данным.
 *
 * Основной поиск делает база (RPC search_items), но офлайн и при вводе
 * по буквам искать надо мгновенно и без сети — по тому, что уже лежит в
 * кеше TanStack Query.
 */

/**
 * Приводит строку к виду, по которому сравниваем.
 *
 * Русский язык здесь требует внимания: «ё» и «е» человек набирает как
 * придётся, а серийники и модели пишутся вперемешку латиницей и кириллицей.
 */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s\-_.,/\\]+/g, ' ')
    .trim();
}

/**
 * Раскладка: набрал «[jkjlbkmybr», не переключив язык.
 *
 * Ошибка настолько частая, что игнорировать её — значит показывать
 * «ничего не найдено» человеку, который всё ввёл правильно.
 */
const QWERTY_TO_JCUKEN: Record<string, string> = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ',
  p: 'з', '[': 'х', ']': 'ъ', a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п',
  h: 'р', j: 'о', k: 'л', l: 'д', ';': 'ж', "'": 'э', z: 'я', x: 'ч',
  c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь', ',': 'б', '.': 'ю',
};

export function fromWrongLayout(input: string): string {
  let out = '';
  for (const ch of input.toLowerCase()) {
    out += QWERTY_TO_JCUKEN[ch] ?? ch;
  }
  return out;
}

/** Поля вещи, по которым имеет смысл искать. */
export interface Searchable {
  name: string;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  notes?: string | null;
}

function haystack(item: Searchable): string {
  return normalize(
    [item.name, item.brand, item.model, item.serial_number, item.notes]
      .filter(Boolean)
      .join(' ')
  );
}

/**
 * Совпадает ли вещь с запросом.
 *
 * Все слова запроса должны найтись, но в любом порядке и в любом поле:
 * «самсунг холодильник» находит «Холодильник Samsung».
 */
export function matches(item: Searchable, query: string): boolean {
  const target = haystack(item);
  if (!target) return false;

  const variants = [normalize(query), normalize(fromWrongLayout(query))];

  return variants.some((variant) => {
    const words = variant.split(' ').filter(Boolean);
    return words.length > 0 && words.every((word) => target.includes(word));
  });
}

/**
 * Фильтрует и ранжирует список.
 *
 * Совпадение в начале названия важнее совпадения в заметках: человек ищет
 * «холод» и ждёт сверху холодильник, а не заметку про холодную воду.
 */
export function searchItems<T extends Searchable>(items: T[], query: string): T[] {
  const q = normalize(query);
  if (!q) return [];

  return items
    .filter((item) => matches(item, query))
    .map((item) => {
      const name = normalize(item.name);
      let score = 0;
      if (name.startsWith(q)) score = 3;
      else if (name.includes(q)) score = 2;
      else if (normalize(item.model ?? '').includes(q)) score = 1;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'ru'))
    .map(({ item }) => item);
}
