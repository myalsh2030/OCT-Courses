/**
 * الأرقام لاتينية في كل واجهات الموقع (قرار المالك ٢٠٢٦-٠٨-٢٠) — والوثيقة
 * المطبوعة وحدها تبقى بالأرقام الهندية، لأن ترقيمها «أسبوع ـ صف» يجاور
 * فاصلاً فتعكسه خوارزمية اتجاه النص.
 */

/** ختم زمني مختصر: «2026/08/20 — 14:40»، و«—» لتاريخ غائب أو تالف. */
export function stamp(iso: string): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  const two = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}/${two(at.getMonth() + 1)}/${two(at.getDate())} — ${two(at.getHours())}:${two(at.getMinutes())}`;
}
