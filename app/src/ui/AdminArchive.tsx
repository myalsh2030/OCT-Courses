import { Clock, LoaderCircle } from 'lucide-react';
import type { ArchivedTerm } from '../services/adminArchive';
import { stamp } from '../services/adminFormat';
import './admin.css';

/**
 * أرشيف الفصول المحفوظة على جهاز الأدمن.
 *
 * ما حُفظ يبقى قابلاً للعودة إليه: يفتح الأدمن فصلاً سابقاً فيرى ملخّصه
 * ويستطيع إعادة بناء حزمته بلا البحث عن ملف CSV قديم في قرصه.
 */

export interface AdminArchiveProps {
  terms: ArchivedTerm[];
  /** الفصل المعروض حالياً في الصفحة. */
  activeTerm: string;
  /** الفصل الذي يُفتح الآن — يُقفل زره ريثما تُقرأ لقطته. */
  busyTerm: string;
  onOpen: (term: string) => void;
}

export function AdminArchive({ terms, activeTerm, busyTerm, onOpen }: AdminArchiveProps) {
  return (
    <div className="admin-block divided">
      <h2 className="section-title">
        <Clock size={18} aria-hidden />
        أرشيف الفصول المحفوظة على هذا الجهاز
      </h2>
      <p className="section-note" style={{ marginBottom: 12 }}>
        لقطة تقرير الشعب لكل فصل رُفع هنا. لا تغادر هذا المتصفح — المنشور هو الحزمة المعمّاة لا
        هذه اللقطات.
      </p>

      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 130 }}>رمز الفصل</th>
              <th>مسمّى الفصل التدريبي</th>
              <th style={{ width: 190 }}>تاريخ آخر تحديث</th>
              <th style={{ width: 110 }}>عدد الشعب</th>
              <th style={{ width: 120 }}>عدد المدربين</th>
              <th className="center" style={{ width: 140 }}>
                الحالة
              </th>
              <th className="center" style={{ width: 170 }}>
                إجراءات
              </th>
            </tr>
          </thead>
          <tbody>
            {terms.map((entry) => {
              const active = entry.term === activeTerm;
              return (
                <tr key={entry.term} className={active ? 'active-row' : undefined}>
                  <td>
                    <strong className="num">{entry.term}</strong>
                  </td>
                  <td>{active ? <strong>{entry.termLabel}</strong> : entry.termLabel}</td>
                  <td title={`من ملف: ${entry.fileName}`}>{stamp(entry.savedAt)}</td>
                  <td>{entry.sections} شعبة</td>
                  <td>{entry.trainers} مدرباً</td>
                  <td className="center">
                    {active ? (
                      <span className="badge complete" title="هذا هو الفصل المعروض في الصفحة الآن">
                        الفصل المعروض
                      </span>
                    ) : (
                      <span className="badge" title="فصل محفوظ على هذا الجهاز">
                        مؤرشف
                      </span>
                    )}
                  </td>
                  <td className="center">
                    <div className="row-actions">
                      <button
                        type="button"
                        className={active ? 'btn' : 'btn primary'}
                        disabled={active || busyTerm !== ''}
                        onClick={() => onOpen(entry.term)}
                        title={
                          active
                            ? 'هذا الفصل معروض بالفعل'
                            : 'فتح لقطة هذا الفصل وعرض ملخّصها وبناء حزمتها'
                        }
                      >
                        {busyTerm === entry.term ? (
                          <LoaderCircle size={14} className="spin" aria-hidden />
                        ) : null}
                        {active ? 'معروض الآن' : 'العودة إلى هذا الفصل'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {terms.length === 0 && (
              <tr>
                <td colSpan={7} className="center row-note">
                  لا فصل محفوظاً بعد على هذا الجهاز — ارفع تقرير الشعب أعلاه ليُحفظ.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
