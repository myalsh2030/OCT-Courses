import { CircleAlert, LoaderCircle, RotateCcw, X } from 'lucide-react';
import type { BackupSummary } from '../domain/backup';
import { arabicCount, COUNT_COURSES, COUNT_DRAFTS } from '../domain/vocab';

/**
 * تأكيد استعادة نسخة احتياطية.
 *
 * الاستعادة تكتب فوق مسوّدات المدرب وملفه، فلا تُنفَّذ قبل أن يرى **ماذا
 * في الملف**: كم مقرراً، وأي فصل، ومتى حُفظ، ولمن. وملفٌ لفصلٍ آخر أو
 * لمدربٍ آخر يُنبَّه عليه صراحةً قبل الزر لا بعده.
 */

export interface RestoreDialogProps {
  summary: BackupSummary;
  /** الجلسة الجارية — للمقارنة والتنبيه على اختلاف الفصل أو المدرب. */
  currentTerm: string;
  currentTrainerNo: string;
  busy: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function RestoreDialog({
  summary,
  currentTerm,
  currentTrainerNo,
  busy,
  onConfirm,
  onCancel,
}: RestoreDialogProps) {
  const otherTerm = summary.term !== currentTerm;
  const otherTrainer = summary.trainerNo !== currentTrainerNo;
  const savedAt = summary.savedAt.slice(0, 16).replace('T', ' — ');

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="تأكيد استعادة نسخة">
      <div className="modal-card" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <span className="modal-title">
            <RotateCcw size={20} aria-hidden />
            استعادة نسخة احتياطية
          </span>
          <button className="modal-close" type="button" onClick={onCancel} title="إلغاء">
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="modal-body">
          <p className="hint">هذا ما يحويه الملف. لن يُكتب شيء قبل تأكيدك.</p>

          <table className="hours-table">
            <tbody>
              <tr>
                <th style={{ width: 150 }}>صاحب النسخة</th>
                <td>
                  {summary.trainerName} — <span className="num">{summary.trainerNo}</span>
                </td>
              </tr>
              <tr>
                <th>الفصل التدريبي</th>
                <td>{summary.termLabel}</td>
              </tr>
              <tr>
                <th>عدد المقررات</th>
                <td>
                  {arabicCount(summary.courses, COUNT_COURSES)}، منها{' '}
                  {arabicCount(summary.drafts, COUNT_DRAFTS)} بتعديلات محلية
                </td>
              </tr>
              <tr>
                <th>تاريخ الحفظ</th>
                <td>
                  <span className="num">{savedAt}</span>
                </td>
              </tr>
              <tr>
                <th>التخصص</th>
                <td>{summary.specialization}</td>
              </tr>
            </tbody>
          </table>

          {(otherTerm || otherTrainer) && (
            <div className="alert-banner warning" style={{ marginTop: 16, marginBottom: 0 }}>
              <CircleAlert size={20} aria-hidden />
              <div className="alert-content">
                <div className="alert-title">تنبّه قبل التأكيد</div>
                {otherTrainer && <p>النسخة محفوظة باسم مدرب آخر غير الداخل حالياً.</p>}
                {otherTerm && <p>النسخة من فصل تدريبي غير الفصل المعروض الآن.</p>}
              </div>
            </div>
          )}

          <div className="alert-banner info" style={{ marginTop: 16, marginBottom: 0 }}>
            <CircleAlert size={20} aria-hidden />
            <div className="alert-content">
              ستحلّ مسوّدات هذه النسخة وملفها الشخصي محل ما على هذا الجهاز الآن. المقررات المحفوظة
              بلا تعديل تبقى على نسختها الأصلية.
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            إلغاء
          </button>
          <button type="button" className="btn primary" onClick={onConfirm} disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle size={15} className="spin" aria-hidden />
                يستعيد…
              </>
            ) : (
              <>
                <RotateCcw size={15} aria-hidden />
                تأكيد الاستعادة
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
