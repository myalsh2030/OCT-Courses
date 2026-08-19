/**
 * المفردات المضبوطة للقوائم المنسدلة في الخطة التدريبية.
 *
 * الاستراتيجيات مأخوذة من وثيقة «ملف المدرب» المعتمدة (وردت كلها فيها)،
 * والأدوات من الوثيقة ومن «المنهج التفصيلي» في الخطة. المستخدم يختار
 * منها فقط — النص الحر مرفوض هنا حفاظاً على اتساق الوثائق المطبوعة.
 */

export const TRAINING_STRATEGIES = [
  'المحاضرة النظرية',
  'التطبيق العملي',
  'العصف الذهني',
  'التدريب بالاكتشاف',
  'حل المشكلات',
  'العمل الجماعي',
  'التدريب بالمحاكاة',
  'التدريب البنائي',
  'دراسة الحالة',
] as const;

export const ASSESSMENT_TOOLS = [
  'واجب',
  'اختبار قصير',
  'تقييم نظري',
  'تقييم عملي',
  'تقرير عملي',
  'مشروع',
  'اختبار ( 1 )',
  'اختبار ( 2 )',
  'اختبار نهائي',
] as const;

export type TrainingStrategy = (typeof TRAINING_STRATEGIES)[number];
export type AssessmentTool = (typeof ASSESSMENT_TOOLS)[number];

/**
 * خيارات خلية الاستراتيجية الأسبوعية الواحدة (بعد دمج صفوف الأسبوع):
 * الاستراتيجيات المفردة، ثم صيغ مركّبة «… والتطبيق العملي» للمقرر المختلط
 * الذي يجمع الأسبوع فيه جانباً نظرياً وتطبيقاً عملياً معاً.
 */
export const STRATEGY_OPTIONS = [
  ...TRAINING_STRATEGIES,
  ...TRAINING_STRATEGIES.filter((s) => s !== 'التطبيق العملي').map(
    (s) => `${s} والتطبيق العملي`,
  ),
] as const;

/** أسماء الأسابيع بالترتيب: الأسبوع ١ = «الأول» … ١٩ = «التاسع عشر». */
export const WEEK_ORDINALS = [
  'الأول',
  'الثاني',
  'الثالث',
  'الرابع',
  'الخامس',
  'السادس',
  'السابع',
  'الثامن',
  'التاسع',
  'العاشر',
  'الحادي عشر',
  'الثاني عشر',
  'الثالث عشر',
  'الرابع عشر',
  'الخامس عشر',
  'السادس عشر',
  'السابع عشر',
  'الثامن عشر',
  'التاسع عشر',
] as const;

export function weekOrdinal(n: number): string {
  const name = WEEK_ORDINALS[n - 1];
  if (!name) throw new RangeError(`رقم أسبوع خارج المدى: ${n}`);
  return name;
}

/** الأرقام الهندية للعرض داخل النصوص العربية: اختبار الفترة (١). */
export function arabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

/**
 * ترقيم صف الموضوع «أسبوع ـ صف» بأرقام هندية: «٤ ـ ١».
 * الأرقام اللاتينية وسط نص عربي تعكسها خوارزمية اتجاه النص في المتصفح
 * (4 ـ 1 تُعرض مقلوبة)، والأرقام الهندية تتبع اتجاه السطر فتظهر صحيحة.
 */
export function unitCode(weekNo: number, row: number): string {
  return `${arabicDigits(weekNo)} ـ ${arabicDigits(row)}`;
}

/** صيغ التمييز العربي لعدٍّ معدود: مفرد ومثنى وجمع قلة وتمييز مفرد. */
export interface ArabicCountForms {
  /** الواحد: «مقرر واحد». */
  one: string;
  /** الاثنان: «مقرران». */
  two: string;
  /** من ٣ إلى ١٠، يسبقه العدد: «٣ مقررات». */
  few: string;
  /** ١١ فأكثر، تمييزٌ مفرد يسبقه العدد: «١١ مقرراً». */
  many: string;
  /** الصفر إن أُريد نصٌّ خاص؛ وإلا «لا مقررات». */
  none?: string;
}

/**
 * عددٌ بمعدوده على قواعد العربية، لا رقمٌ ملصوقٌ بجمعٍ دائماً.
 * «١ نواقص» و«٢ مقررات» عربيةٌ مكسورة تظهر في كل عدّاد إن لم تُعالج.
 */
export function arabicCount(n: number, forms: ArabicCountForms): string {
  if (n === 0) return forms.none ?? `لا ${forms.few}`;
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  // أرقام لاتينية: هذه معدودات الواجهة، والوثيقة المطبوعة وحدها هندية
  // لأن ترقيمها يجاور فاصلاً فتعكسه خوارزمية اتجاه النص.
  if (n <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}

/** معدودات الواجهة المتكررة — تُعرَّف مرة ولا تُكتب في كل شاشة. */
export const COUNT_COURSES: ArabicCountForms = {
  one: 'مقرر واحد',
  two: 'مقرران',
  few: 'مقررات',
  many: 'مقرراً',
};

export const COUNT_MISSING: ArabicCountForms = {
  one: 'نقيصة واحدة',
  two: 'نقيصتان',
  few: 'نواقص',
  many: 'نقيصة',
};

export const COUNT_ITEMS: ArabicCountForms = {
  one: 'بند واحد',
  two: 'بندان',
  few: 'بنود',
  many: 'بنداً',
};

export const COUNT_PLANS: ArabicCountForms = {
  one: 'خطة واحدة',
  two: 'خطتان',
  few: 'خطط',
  many: 'خطة',
};

export const COUNT_DRAFTS: ArabicCountForms = {
  one: 'مسودّة واحدة',
  two: 'مسودّتان',
  few: 'مسودّات',
  many: 'مسودّة',
};
