/**
 * تسمية الفصل التدريبي من رمزه — **الموضع الوحيد** الذي يعرف القاعدة.
 *
 * رمز الفصل في رايات ست خانات: أربعٌ للسنة الهجرية وخانتان لجزء السنة،
 * والخانتان الأخيرتان هما التسمية: `10` الأول، و`20` الثاني، و`30` الصيفي.
 * فـ`144710` = «الفصل التدريبي الأول ١٤٤٧هـ».
 *
 * نماذج التصميم الساكنة سمّت `144710` مرةً «الثاني» ومرةً «الثاني 1447»
 * في صفحتين مختلفتين — تناقضٌ سببه أن كل صفحة كتبت النص يدوياً. لذلك
 * لا تُكتب تسمية فصلٍ في أي مكوّن: تُطلب من هنا.
 *
 * الأرقام هندية لا لاتينية: الرقم اللاتيني وسط نص عربي تعكسه خوارزمية
 * اتجاه النص متى جاوره فاصل، والهندي يتبع اتجاه السطر (درسٌ مسجّل في
 * `.agent/lessons-learned.md`).
 */

export type TermPart = 'first' | 'second' | 'summer' | 'unknown';

export interface TermInfo {
  /** الرمز كما ورد في التقرير، مطبَّعاً بأرقام لاتينية. */
  code: string;
  /** السنة الهجرية (أربع خانات) أو فارغة إن لم يُقرأ الرمز. */
  year: string;
  part: TermPart;
  /** «الفصل التدريبي الأول ١٤٤٧هـ». */
  label: string;
  /** «الأول» / «الثاني» / «الصيفي» — فارغة للمجهول. */
  partLabel: string;
}

const PART_LABELS: Record<string, { part: TermPart; label: string }> = {
  '10': { part: 'first', label: 'الأول' },
  '20': { part: 'second', label: 'الثاني' },
  '30': { part: 'summer', label: 'الصيفي' },
};

/** توحيد الأرقام العربية-الهندية والفارسية إلى لاتينية قبل القراءة. */
function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    const zero = code <= 0x0669 ? 0x0660 : 0x06f0;
    return String(code - zero);
  });
}

/**
 * أرقام هندية من نصٍّ رقمي — لا من عدد: `Number('0144')` يبتلع الصفر
 * البادئ، ورموز الفصول تُعرض كما وردت لا كما تُحسب.
 */
function toArabicDigits(text: string): string {
  return text.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

/** يقرأ رمز الفصل ويعيد سنته وجزأه وتسميته الكاملة. */
export function readTerm(code: string): TermInfo {
  const digits = toLatinDigits(code ?? '').replace(/\D/g, '');
  if (!digits) {
    return { code: '', year: '', part: 'unknown', label: 'فصل تدريبي غير محدَّد', partLabel: '' };
  }

  const year = digits.length >= 6 ? digits.slice(0, 4) : '';
  const suffix = digits.length >= 6 ? digits.slice(4, 6) : '';
  const known = PART_LABELS[suffix];

  if (!known || !year) {
    // رمزٌ لا يتبع القاعدة: يُعرض كما هو بلا تخمين تسمية.
    return {
      code: digits,
      year,
      part: 'unknown',
      label: `الفصل التدريبي ${toArabicDigits(digits)}`,
      partLabel: '',
    };
  }

  return {
    code: digits,
    year,
    part: known.part,
    label: `الفصل التدريبي ${known.label} ${toArabicDigits(year)}هـ`,
    partLabel: known.label,
  };
}

/** تسمية الفصل جاهزةً للعرض — المختصر الذي تستعمله الواجهات. */
export function termLabel(code: string): string {
  return readTerm(code).label;
}
