import type { ReferenceRow } from './course.schema';
import type { TrainerProfile } from './department';
import { DEFAULT_REFERENCES } from './references';

/**
 * حساب «المعلومات الناقصة» في ملف المدرب ومقرراته.
 *
 * الغرض من الشريط أعلى لوحة المدرب أن يقول بالضبط **ما الناقص وأين**،
 * لا أن يُنبّه تنبيهاً عاماً. فكل نقيصة هنا بندٌ مسمّى له وجهةٌ يُقفز
 * إليها، ويختفي الشريط كله متى فرغت القائمة.
 *
 * الوحدة خالصة (لا تخزين ولا شبكة) كي تُختبر على حالات الملف مباشرة.
 */

export type MissingKind =
  | 'email'
  | 'office'
  | 'officeHours'
  | 'studentContact'
  | 'courseReferences';

export interface MissingItem {
  /** معرّف ثابت يُستعمل مفتاحاً وهدفاً للقفز: `profile:email` أو `course:MMIN-141`. */
  id: string;
  kind: MissingKind;
  /** اسم النقيصة كما تُذكر في الشريط. */
  label: string;
  /** جملة تشرح المطلوب — تظهر داخل منبثقة الإكمال. */
  detail: string;
  /** المقرر صاحب النقيصة إن كانت نقيصة مقرر. */
  courseId?: string;
  courseName?: string;
}

/** ما تحتاجه الحاسبة من المقرر — لا الوثيقة كاملة. */
export interface CourseCheck {
  courseId: string;
  rayatCode: string;
  name: string;
  /**
   * للمقرر توصيفٌ تفصيلي في بيانات التطبيق. المقرر المسند في رايات بلا
   * توصيف لا يُحاسب على مراجعه — لا وثيقة له تُملأ أصلاً.
   */
  hasDocument: boolean;
  /** مراجع النسخة المعروضة (المسودّة إن وُجدت، وإلا الأصل). */
  references: ReferenceRow[];
}

/** المرجع المؤسسي العام المولّد مع كل مقرر (لا يخصّ مقرراً بعينه). */
const SHARED_MAIN_REFERENCE = DEFAULT_REFERENCES[0].main;

/** يوم ساعات مكتبية مكتمل: له بداية ونهاية. */
function hasOfficeHours(profile: TrainerProfile): boolean {
  return profile.officeHours.some((d) => d.from.trim() !== '' && d.to.trim() !== '');
}

/**
 * وسيلة تواصل الطلاب — بندٌ عن **اتساق كتلة التواصل المطبوعة** لا عن
 * الواتساب: الواتساب قناة اختيارية بقرار المالك، فلا يُطالَب به من لم
 * يعلّمه. النقص هنا حالتان:
 *
 * 1. لا قناة مفعّلة أصلاً تحمل بياناً — فالوثيقة تُطبع بلا وسيلة تواصل.
 * 2. قناةٌ معلَّمة بلا بيانها (واتساب مؤشَّر بلا رقم، أو «أخرى» بلا ذكرها)
 *    — فالوثيقة تُطبع بمربّع مؤشَّر أمام فراغ.
 *
 * البريد والساعات المكتبية بندان مستقلان، فلا يُحسبان هنا مرتين.
 */
function studentContactIssue(profile: TrainerProfile): string {
  const { channels } = profile;
  if (channels.whatsapp && !profile.whatsapp.trim()) {
    return 'أشّرت على الواتساب وسيلةً للتواصل ولم تُدخل رقمه.';
  }
  if (channels.other && !channels.otherValue.trim()) {
    return 'أشّرت على «وسيلة أخرى» ولم تذكرها.';
  }
  const usable =
    (channels.email && profile.email.trim() !== '') ||
    (channels.officeHours && hasOfficeHours(profile)) ||
    (channels.whatsapp && profile.whatsapp.trim() !== '') ||
    (channels.other && channels.otherValue.trim() !== '');
  return usable ? '' : 'لم تُحدَّد أي وسيلة يتواصل بها المتدربون معك.';
}

/**
 * للمقرر مرجعٌ خاص به: صفٌّ مرجعه الرئيس ليس المرجع المؤسسي العام
 * المولّد مع كل المقررات. الروابط المؤسسية تبقى في الوثيقة كما اعتمدها
 * المالك، لكنها لا تُغني عن كتاب المقرر أو حقيبته.
 */
export function hasOwnReference(references: ReferenceRow[]): boolean {
  return references.some((r) => {
    const main = r.main.trim();
    return main !== '' && main !== SHARED_MAIN_REFERENCE;
  });
}

/** ما يُدخله المدرب مرجعاً خاصاً بمقرره. */
export interface OwnReference {
  main: string;
  site: string;
  platform: string;
}

/** المرجع الخاص المحفوظ في مقرر (أو حقول فارغة إن لم يُدخل بعد). */
export function readOwnReference(references: ReferenceRow[]): OwnReference {
  const row = references.find((r) => {
    const main = r.main.trim();
    return main !== '' && main !== SHARED_MAIN_REFERENCE;
  });
  return { main: row?.main ?? '', site: row?.site ?? '', platform: row?.platform ?? '' };
}

/**
 * يكتب المرجع الخاص في صفوف المراجع بلا مساس بالصف المؤسسي المعتمد:
 * يُعدَّل صفُّ المدرب إن وُجد، وإلا يُضاف صفٌّ جديد بعده. وإفراغ الحقول
 * الثلاثة يحذف الصف — لا يُطبع صفٌّ فارغ في جدول الوثيقة.
 */
export function applyOwnReference(
  references: ReferenceRow[],
  patch: OwnReference,
): ReferenceRow[] {
  const rows = references.map((r) => ({ ...r }));
  const at = rows.findIndex((r) => {
    const main = r.main.trim();
    return main !== '' && main !== SHARED_MAIN_REFERENCE;
  });
  const empty = !patch.main.trim() && !patch.site.trim() && !patch.platform.trim();

  if (at === -1) {
    if (empty) return rows;
    rows.push({ main: patch.main, site: patch.site, platform: patch.platform });
    return rows;
  }
  if (empty) {
    rows.splice(at, 1);
    return rows;
  }
  rows[at] = { ...rows[at], main: patch.main, site: patch.site, platform: patch.platform };
  return rows;
}

/** نواقص ملف المدرب وحده (بلا مقرراته). */
export function findProfileMissing(profile: TrainerProfile): MissingItem[] {
  const items: MissingItem[] = [];

  if (!profile.email.trim()) {
    items.push({
      id: 'profile:email',
      kind: 'email',
      label: 'البريد الإلكتروني الرسمي',
      detail: 'بريدك الرسمي في المؤسسة — يظهر في كتلة التواصل بكل وثائق مقرراتك.',
    });
  }

  if (!profile.office.trim()) {
    items.push({
      id: 'profile:office',
      kind: 'office',
      label: 'رقم المكتب',
      detail: 'رقم مكتبك كاملاً؛ ورقم المبنى يُشتق منه تلقائياً فلا تُدخله.',
    });
  }

  if (!hasOfficeHours(profile)) {
    items.push({
      id: 'profile:officeHours',
      kind: 'officeHours',
      label: 'الساعات المكتبية',
      detail: 'يومٌ واحد على الأقل ببداية ونهاية — هي موعد المتدربين لمراجعتك.',
    });
  }

  const contact = studentContactIssue(profile);
  if (contact) {
    items.push({
      id: 'profile:studentContact',
      kind: 'studentContact',
      label: 'وسيلة تواصل الطلاب',
      detail: contact,
    });
  }

  return items;
}

/** نواقص مقرر واحد (مراجعه الخاصة). */
export function findCourseMissing(course: CourseCheck): MissingItem[] {
  if (!course.hasDocument) return [];
  if (hasOwnReference(course.references)) return [];
  return [
    {
      id: `course:${course.courseId}`,
      kind: 'courseReferences',
      label: `مراجع مقرر ${course.name}`,
      detail: 'الكتاب أو الحقيبة المعتمدة لهذا المقرر تحديداً — الروابط المؤسسية العامة لا تُغني عنها.',
      courseId: course.courseId,
      courseName: course.name,
    },
  ];
}

/** كل النواقص: ملف المدرب أولاً ثم مقرراته بترتيبها. */
export function findMissing(profile: TrainerProfile, courses: CourseCheck[]): MissingItem[] {
  return [...findProfileMissing(profile), ...courses.flatMap(findCourseMissing)];
}

export interface CourseCompletion {
  done: number;
  total: number;
  /** نسبة مئوية صحيحة (٠–١٠٠). */
  percent: number;
  missing: MissingItem[];
}

/**
 * اكتمال وثيقة مقرر واحد: مراجعه الخاصة، وأربعة بنود من ملف المدرب
 * تُطبع في كتلة تواصله على غلاف هذا المقرر نفسه. فالبطاقة تقول «ما ينقص
 * هذه الوثيقة» لا «ما ينقص المقرر مجرداً».
 *
 * المقرر بلا توصيف تفصيلي لا نسبة له — بطاقته حالةٌ أخرى في الواجهة.
 */
export function courseCompletion(profile: TrainerProfile, course: CourseCheck): CourseCompletion {
  const missing = [...findProfileMissing(profile), ...findCourseMissing(course)];
  const total = course.hasDocument ? 5 : 4;
  const done = total - missing.length;
  return { done, total, percent: Math.round((done / total) * 100), missing };
}

/** عبارة الشريط: تُسمّي النواقص بالعربية بفواصلها وواو الأخيرة. */
export function missingSummary(items: MissingItem[]): string {
  const names = items.map((i) => i.label);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join('، ')}، و${names[names.length - 1]}`;
}
