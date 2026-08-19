import type { BundleDiff, SectionChange, SectionDiff } from '../domain/bundle';

/**
 * عرض فروق الرفعة — تسميات الحالات الخمس وترتيبها، مفصولةً عن المكوّن
 * كي تُختبر بلا متصفح.
 *
 * التصنيف نفسه ليس هنا: `diffBundle` في `domain/bundle.ts` هو من يقرّر
 * أن الشعبة جديدة أو أُسند لها مدرب أو تغيّر مدربها. هذا الملف يجيب عن
 * سؤالين فقط: **بأي ترتيب تُعرض**، و**بأي تسمية ولون**.
 *
 * الترتيب مقصود: ما تغيّر أولاً وما لم يتغيّر آخراً. تقرير ٦٦٩ شعبة
 * أغلبه مطابق، فعرضه بترتيب الأرقام المرجعية يدفن العشرات المتغيّرة
 * تحت المئات الساكنة.
 */

/** ترتيب العرض: الجديد فالمُسنَد فالمتغيّر فالمحذوف، والمطابق آخراً. */
export const DIFF_ORDER: SectionChange[] = ['added', 'assigned', 'changed', 'removed', 'same'];

export interface DiffView {
  /** رمز الحالة كما في النماذج المعتمدة: + ✓ ⇄ ✕ = */
  sign: string;
  /** تسمية شريحة التصفية. */
  chip: string;
  /** نص الشارة في خلية «حالة الفرق». */
  badge: string;
  /** لاحقة صنف الشارة (`badge success`…)، وفارغة للمطابقة. */
  badgeClass: string;
  /** صنف الصف الملوّن. */
  rowClass: string;
  /** شرحٌ يظهر عند المرور — لا شارة بلا تفسير. */
  title: string;
}

export const DIFF_VIEW: Record<SectionChange, DiffView> = {
  added: {
    sign: '+',
    chip: 'شعب جديدة',
    badge: 'شعبة جديدة',
    badgeClass: 'success',
    rowClass: 'diff-add',
    title: 'شعبة لم تكن في النسخة المحفوظة لهذا الفصل',
  },
  assigned: {
    sign: '✓',
    chip: 'إسناد مدرب',
    badge: 'إسناد مدرب',
    badgeClass: 'info',
    rowClass: 'diff-assign',
    title: 'شعبة كانت شاغرة بلا مدرب فأُسند لها مدرب',
  },
  changed: {
    sign: '⇄',
    chip: 'تغيير مدرب',
    badge: 'تغيير مدرب',
    badgeClass: 'warning',
    rowClass: 'diff-change',
    title: 'انتقلت الشعبة من مدرب إلى آخر (أو رُفع عنها مدربها)',
  },
  removed: {
    sign: '✕',
    chip: 'شعب محذوفة',
    badge: 'شعبة محذوفة',
    badgeClass: 'danger',
    rowClass: 'diff-del',
    title: 'الشعبة لم تعد موجودة في التقرير المرفوع',
  },
  same: {
    sign: '=',
    chip: 'مطابقة دون تغيير',
    badge: 'مطابقة',
    badgeClass: '',
    rowClass: 'diff-same',
    title: 'الشعبة ومدربها مطابقان للنسخة المحفوظة',
  },
};

/** عدّاد كل حالة، والمجموع — أعداد شرائح التصفية. */
export type DiffCounts = Record<SectionChange, number> & { total: number };

export function countDiff(diff: BundleDiff): DiffCounts {
  const counts = { total: 0 } as DiffCounts;
  for (const kind of DIFF_ORDER) {
    counts[kind] = diff[kind].length;
    counts.total += diff[kind].length;
  }
  return counts;
}

/** هل في الرفعة ما يستحق نظر الأدمن — أي فرقٍ غير المطابقة. */
export function hasChanges(diff: BundleDiff): boolean {
  return countDiff(diff).total > diff.same.length;
}

/**
 * صفوف الجدول بترتيب العرض. كل حالة مرتّبة أصلاً برقمها المرجعي من
 * `diffBundle`، فلا يُعاد ترتيبها داخلها.
 */
export function flattenDiff(diff: BundleDiff, only: SectionChange | 'all' = 'all'): SectionDiff[] {
  if (only !== 'all') return diff[only];
  return DIFF_ORDER.flatMap((kind) => diff[kind]);
}

/* ───────────────────── التصنيف حسب التخصص ───────────────────── */

/**
 * التخصص = بادئة رمز المقرر في رايات (`مصيم-141` ← `مصيم`).
 *
 * التقرير الحقيقي ٥٦٦ شعبة في خمسة أقسام، وسردها في قائمة واحدة متعب
 * بلا فائدة: من يراجع إسنادات الميكانيكية لا يعنيه صف واحد من المدنية.
 * فالعرض يُصنَّف بالتخصص دائماً (قرار المالك ٢٠٢٦-٠٨-٢٠).
 */
export function specialtyOf(rayatCode: string): string {
  const code = (rayatCode ?? '').trim();
  const dash = code.indexOf('-');
  return dash > 0 ? code.slice(0, dash) : code || '—';
}

export interface SpecialtyGroup {
  specialty: string;
  rows: SectionDiff[];
  /** عدد الصفوف المتغيّرة (غير المطابقة) في هذا التخصص. */
  changed: number;
}

/**
 * يجمع الصفوف في مجموعات تخصص مرتّبة: الأكثر تغيّراً أولاً، فالأكبر عدداً —
 * لأن الأدمن يفتح الصفحة ليرى ما تغيّر لا ليتصفح ما ثبت.
 */
export function groupBySpecialty(rows: SectionDiff[]): SpecialtyGroup[] {
  const groups = new Map<string, SpecialtyGroup>();
  for (const row of rows) {
    const specialty = specialtyOf(row.rayatCode);
    let group = groups.get(specialty);
    if (!group) {
      group = { specialty, rows: [], changed: 0 };
      groups.set(specialty, group);
    }
    group.rows.push(row);
    if (row.change !== 'same') group.changed += 1;
  }
  return [...groups.values()].sort(
    (a, b) => b.changed - a.changed || b.rows.length - a.rows.length || a.specialty.localeCompare(b.specialty, 'ar'),
  );
}
