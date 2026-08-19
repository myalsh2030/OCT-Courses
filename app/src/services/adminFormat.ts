/**
 * صيغ العرض المشتركة بين جداول صفحة الأدمن.
 *
 * الأرقام هندية لا لاتينية: الرقم اللاتيني وسط نص عربي تعكسه خوارزمية
 * اتجاه النص متى جاوره فاصل، فيُقرأ التاريخ مقلوباً (درسٌ مسجَّل في
 * `.agent/lessons-learned.md`).
 */

/**
 * أرقام هندية من نصٍّ لا من عدد — التحويل هنا يحفظ الأصفار البادئة
 * والفواصل (`٢٠٢٦/٠٨/٢٠`)، و`arabicDigits` في `domain/vocab.ts` يأخذ
 * عدداً فيبتلع صفر الشهر.
 */
function toArabicDigits(text: string): string {
  return text.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

/** ختم زمني مختصر: «٢٠٢٦/٠٨/٢٠ — ١٤:٤٠»، و«—» لتاريخ غائب أو تالف. */
export function stamp(iso: string): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  const two = (n: number) => String(n).padStart(2, '0');
  return toArabicDigits(
    `${at.getFullYear()}/${two(at.getMonth() + 1)}/${two(at.getDate())} — ${two(at.getHours())}:${two(at.getMinutes())}`,
  );
}
