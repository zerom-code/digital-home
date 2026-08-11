/**
 * Сжатие фото перед отправкой в ai-* функции.
 *
 * Общее для распознавания шильдика, комнаты и чека: больше 1024px модели не
 * нужно, а трафик и стоимость запроса это сокращает в разы. Раньше три места
 * держали одну и ту же функцию по отдельности — расхождение размера или
 * качества между ними было бы незаметной, но настоящей рассинхронизацией.
 */
const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.85;

/** Ужимает снимок и отдаёт голый base64 без префикса data:. */
export async function toCompactBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('Не удалось обработать снимок');
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
