import { GitCompareArrows } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BundleDiff, SectionChange } from '../domain/bundle';
import { termLabel } from '../domain/term';
import { arabicDigits } from '../domain/vocab';
import { countDiff, DIFF_ORDER, DIFF_VIEW, flattenDiff } from '../services/adminDiff';
import { stamp } from '../services/adminFormat';
import './admin.css';

/**
 * جدول فروق الرفعة عن آخر نسخة محفوظة للفصل نفسه.
 *
 * التقرير الحقيقي ٦٦٩ شعبة، وأغلبها مطابق. فالصفوف تُعرض بترتيب الحالات
 * (الجديد أولاً والمطابق آخراً)، ويُكتفى بأول ثلاثمئة صف مع تصريحٍ بذلك —
 * إخفاءٌ صامت للباقي أسوأ من إخفاءٍ مُعلن، والشرائح تحصر العرض في حالة
 * واحدة فلا يضيع شيء.
 */

const MAX_ROWS = 300;

export interface AdminDiffProps {
  diff: BundleDiff;
  term: string;
  /** وقت حفظ النسخة التي قُورن بها (ISO)، وفارغ إن لم تكن هناك نسخة. */
  previousSavedAt: string;
}

const signClass: Record<SectionChange, string> = {
  added: 'diff-sign sign-add',
  assigned: 'diff-sign sign-assign',
  changed: 'diff-sign sign-change',
  removed: 'diff-sign sign-del',
  same: 'diff-sign sign-same',
};

export function AdminDiff({ diff, term, previousSavedAt }: AdminDiffProps) {
  const [filter, setFilter] = useState<SectionChange | 'all'>('all');
  const counts = useMemo(() => countDiff(diff), [diff]);
  const rows = useMemo(() => flattenDiff(diff, filter), [diff, filter]);
  const shown = rows.slice(0, MAX_ROWS);

  return (
    <div className="admin-block">
      <div className="section-head">
        <div>
          <h2 className="section-title">
            <GitCompareArrows size={18} aria-hidden />
            جدول فروق التحديث
          </h2>
          <p className="section-note">
            {previousSavedAt
              ? `مقارنة التقرير المرفوع بآخر نسخة محفوظة لـ${termLabel(term)} (${stamp(previousSavedAt)}).`
              : `لا نسخة محفوظة لـ${termLabel(term)} على هذا الجهاز — فكل شعبة في التقرير جديدة.`}
          </p>
        </div>
      </div>

      <div className="filter-bar" role="tablist" aria-label="تصفية نوع الفروق">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={filter === 'all' ? 'chip on' : 'chip'}
          onClick={() => setFilter('all')}
          title="عرض كل الشعب: المتغيّرة أولاً ثم المطابقة"
        >
          <span>الكل</span>
          <span className="chip-count">{arabicDigits(counts.total)}</span>
        </button>
        {DIFF_ORDER.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={filter === kind}
            className={filter === kind ? 'chip on' : 'chip'}
            disabled={counts[kind] === 0}
            onClick={() => setFilter(kind)}
            title={DIFF_VIEW[kind].title}
          >
            <span className={signClass[kind]}>{DIFF_VIEW[kind].sign}</span>
            <span>{DIFF_VIEW[kind].chip}</span>
            <span className="chip-count">{arabicDigits(counts[kind])}</span>
          </button>
        ))}
      </div>

      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 110 }} title="الرقم المرجعي للشعبة في رايات">
                الرقم المرجعي
              </th>
              <th style={{ width: 110 }} title="رمز المقرر كما في رايات">
                رمز المقرر
              </th>
              <th title="اسم المقرر كما ورد في التقرير">اسم المقرر</th>
              <th style={{ width: 130 }} title="نوع الشعبة كما ورد في التقرير">
                نوع الشعبة
              </th>
              <th title="مدرب الشعبة في النسخة المحفوظة">المدرب السابق</th>
              <th title="مدرب الشعبة في التقرير المرفوع">المدرب في التقرير الجديد</th>
              <th className="center" style={{ width: 150 }} title="نوع التغيير المكتشف">
                حالة الفرق
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const view = DIFF_VIEW[row.change];
              return (
                <tr key={`${row.change}-${row.ref}`} className={view.rowClass}>
                  <td>
                    <strong className="num">{row.ref}</strong>
                  </td>
                  <td>
                    <span className="badge">{row.rayatCode}</span>
                  </td>
                  <td>{row.courseName}</td>
                  <td>{row.type}</td>
                  <td>
                    {row.previousTrainerName ? (
                      <span className={row.change === 'same' ? '' : 'old-val'}>
                        {row.previousTrainerName}
                      </span>
                    ) : (
                      <span className="row-note">
                        {row.change === 'added' ? '— لم تكن موجودة' : 'غير مسندة (شاغرة)'}
                      </span>
                    )}
                  </td>
                  <td>
                    {row.change === 'removed' ? (
                      <span className="gone">✕ لم تعد في التقرير</span>
                    ) : row.trainerName ? (
                      <span className={row.change === 'same' ? '' : 'new-val'}>
                        {row.trainerName}
                      </span>
                    ) : (
                      <span className="row-note">غير مسندة (شاغرة)</span>
                    )}
                  </td>
                  <td className="center">
                    <span
                      className={view.badgeClass ? `badge ${view.badgeClass}` : 'badge'}
                      title={view.title}
                    >
                      {view.sign} {view.badge}
                    </span>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="center row-note">
                  لا شعبة في هذه الحالة.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && (
        <p className="table-foot">
          يُعرض أول {arabicDigits(shown.length)} صفاً من {arabicDigits(rows.length)}. الشرائح أعلاه
          تحصر العرض في حالة واحدة.
        </p>
      )}
    </div>
  );
}
