import { GitCompareArrows } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import type { BundleDiff, SectionChange } from '../domain/bundle';
import {
  countDiff,
  DIFF_ORDER,
  DIFF_VIEW,
  flattenDiff,
  groupBySpecialty,
} from '../services/adminDiff';
import { stamp } from '../services/adminFormat';
import './admin.css';

/**
 * جدول فروق الرفعة عن آخر نسخة محفوظة للفصل نفسه.
 *
 * **غرضه**: التقرير يُرفع مراراً في الفصل الواحد كلما تغيّرت الإسنادات،
 * وقبل أن يُنشر تحديثٌ يحتاج الأدمن أن يعرف ماذا سيتغيّر على المدربين:
 * من أُسندت له شعبة جديدة، ومن نُزعت منه، وأي شعبة أُلغيت. بلا هذا الجدول
 * يكون النشر على العمياء — ملفٌّ يحلّ محلّ ملف بلا بيان أثره.
 *
 * التقرير الحقيقي ٦٦٩ شعبة، وأغلبها مطابق. فالصفوف تُعرض بترتيب الحالات
 * (الجديد أولاً والمطابق آخراً)، ويُكتفى بأول ثلاثمئة صف مع تصريحٍ بذلك —
 * إخفاءٌ صامت للباقي أسوأ من إخفاءٍ مُعلن، والشرائح تحصر العرض في حالة
 * واحدة فلا يضيع شيء.
 */

const MAX_ROWS = 300;

export interface AdminDiffProps {
  diff: BundleDiff;
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

export function AdminDiff({ diff, previousSavedAt }: AdminDiffProps) {
  const [filter, setFilter] = useState<SectionChange | 'all'>('all');
  const [specialty, setSpecialty] = useState<string>('all');
  const counts = useMemo(() => countDiff(diff), [diff]);
  const all = useMemo(() => flattenDiff(diff, filter), [diff, filter]);
  const groups = useMemo(() => groupBySpecialty(all), [all]);
  const rows = useMemo(
    () => (specialty === 'all' ? all : all.filter((r) => r.rayatCode.startsWith(`${specialty}-`))),
    [all, specialty, ],
  );
  const shown = rows.slice(0, MAX_ROWS);
  const shownGroups = useMemo(() => groupBySpecialty(shown), [shown]);

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
              ? `مقارنة التقرير المرفوع بآخر نسخة محفوظة لهذا الفصل (${stamp(previousSavedAt)}).`
              : 'لا نسخة محفوظة لهذا الفصل على هذا الجهاز — فكل شعبة في التقرير جديدة.'}
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
          <span className="chip-count">{counts.total}</span>
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
            <span className="chip-count">{counts[kind]}</span>
          </button>
        ))}
      </div>

      <div className="filter-bar specialty-bar" role="tablist" aria-label="تصفية حسب التخصص">
        <span className="filter-bar-label">التخصص</span>
        <button
          type="button"
          role="tab"
          aria-selected={specialty === 'all'}
          className={specialty === 'all' ? 'chip on' : 'chip'}
          onClick={() => setSpecialty('all')}
          title="كل التخصصات، مجمَّعةً تحت عناوينها"
        >
          <span>الكل</span>
          <span className="chip-count">{all.length}</span>
        </button>
        {groups.map((group) => (
          <button
            key={group.specialty}
            type="button"
            role="tab"
            aria-selected={specialty === group.specialty}
            className={specialty === group.specialty ? 'chip on' : 'chip'}
            onClick={() => setSpecialty(group.specialty)}
            title={
              group.changed
                ? `${group.specialty}: ${group.changed} شعبة متغيّرة من ${group.rows.length}`
                : `${group.specialty}: لا تغيير — ${group.rows.length} شعبة مطابقة`
            }
          >
            <span>{group.specialty}</span>
            <span className="chip-count">{group.rows.length}</span>
            {group.changed > 0 && <span className="chip-dot" aria-hidden />}
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
            {shownGroups.map((group, groupIndex) => (
              <Fragment key={group.specialty}>
                <tr className={groupIndex % 2 ? 'group-row alt' : 'group-row'}>
                  <th colSpan={7} scope="colgroup">
                    <span className="group-name">{group.specialty}</span>
                    <span className="group-meta">
                      {group.rows.length} شعبة
                      {group.changed > 0 ? ` — منها ${group.changed} متغيّرة` : ' — بلا تغيير'}
                    </span>
                  </th>
                </tr>
                {group.rows.map((row) => {
                  const view = DIFF_VIEW[row.change];
                  return (
                    <tr
                      key={`${row.change}-${row.ref}`}
                      className={
                        groupIndex % 2 ? `${view.rowClass ?? ''} group-alt` : (view.rowClass ?? '')
                      }
                    >
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
              </Fragment>
            ))}
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
          يُعرض أول {shown.length} صفاً من {rows.length}. الشرائح أعلاه
          تحصر العرض في حالة واحدة.
        </p>
      )}
    </div>
  );
}
