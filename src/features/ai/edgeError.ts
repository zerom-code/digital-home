/**
 * Текст ошибки, которую вернула Edge Function.
 *
 * supabase-js не кладёт тело ответа в `error.message` — там всегда общее
 * «Edge Function returned a non-2xx status code». Настоящий текст (`fail()`
 * в _shared/http.ts пишет `{ error: "..." }`) лежит в `error.context` — сыром
 * `Response`, который ещё нужно прочитать. Без этого разбора все три
 * ai-*-сценария не отличили бы «выключено в настройках» от любой другой
 * ошибки и всегда показывали бы общее «не получилось».
 *
 * Не завязываемся на класс `FunctionsHttpError` из supabase-js — версии
 * пакета отличаются тем, откуда он экспортируется. Форма объекта (`context`
 * с методом `.json()`) стабильнее конкретного экспорта.
 */
export async function edgeErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;

  if (context && typeof (context as Response).json === 'function') {
    try {
      const body: unknown = await (context as Response).json();
      if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
        return (body as { error: string }).error;
      }
    } catch {
      // тело не JSON или уже прочитано — используем то, что осталось ниже
    }
  }

  return error instanceof Error ? error.message : '';
}
