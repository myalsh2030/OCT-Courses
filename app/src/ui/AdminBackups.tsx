import { CloudUpload, FileText, Info, Trash2, Upload } from 'lucide-react';
import { arabicDigits } from '../domain/vocab';
import {
  BACKUP_STATUS_CLASS,
  BACKUP_STATUS_LABEL,
  type ReceivedBackup,
} from '../services/adminBackups';
import { stamp } from '../services/adminFormat';
import { AdminDropzone } from './AdminDropzone';
import './admin.css';

/**
 * استقبال نسخ المدربين الاحتياطية.
 *
 * الشاشة لا تدمج شيئاً ولا تدّعي أنها دمجت: تقرأ الملف، وتقول من صاحبه
 * وأي فصلٍ هو ومتى حُفظ، ثم تحكم عليه — «جاهز للدمج» أو تضاربٌ مُعلَن
 * بسببه. النسخة المتضاربة تبقى في القائمة ظاهرةً، لأن ابتلاعها صامتةً
 * يضيّع عمل مدربٍ بلا أن يعلم أحد.
 */

export interface AdminBackupsProps {
  backups: ReceivedBackup[];
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
}

export function AdminBackups({ backups, onFiles, onRemove }: AdminBackupsProps) {
  const ready = backups.filter((b) => b.status === 'ready').length;

  return (
    <section className="ui-panel">
      <header>
        <CloudUpload size={20} aria-hidden />
        <span className="header-title">
          استقبال نسخ المدربين الاحتياطية
          <span className="header-subtitle">— فحص ملفات المدربين وبيان ما يصحّ دمجه</span>
        </span>
        <span className="counter" title="النسخ المرفوعة في هذه الجلسة، وكم منها جاهز للدمج">
          {backups.length === 0
            ? 'لا نسخة بعد'
            : `${arabicDigits(backups.length)} نسخة — ${arabicDigits(ready)} جاهزة`}
        </span>
      </header>

      <div className="panel-body">
        <div className="alert-banner info">
          <Info size={20} aria-hidden />
          <div className="alert-content">
            <div className="alert-title">ما تفعله هذه اللوحة وما لا تفعله</div>
            <p>
              يحفظ المدرب نسخته الاحتياطية (ملف JSON) ويرسلها لرئيس القسم. ارفعها هنا ليُفحص
              محتواها ويُعرض ملخّصها وحال دمجها. الملفات تبقى في هذه الجلسة على جهازك: لا تُحفظ
              ولا تدخل حزمة النشر — حزمة الفصل تحمل شعب رايات لا مسوّدات المدربين.
            </p>
          </div>
        </div>

        <AdminDropzone
          accept=".json,application/json"
          multiple
          compact
          icon={<FileText size={20} aria-hidden />}
          title="رفع ملفات النسخ الاحتياطية للمدربين (.json)"
          hint="يمكن اختيار عدة ملفات دفعة واحدة؛ ويُقارن بينها فتُعرف أحدث نسخة لكل مدرب."
          buttonLabel="استعراض ملفات النسخ"
          buttonIcon={<Upload size={15} aria-hidden />}
          onFiles={onFiles}
        />

        <div className="admin-block">
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>رقم المدرب</th>
                  <th>اسم المدرب</th>
                  <th style={{ width: 120 }}>التخصص</th>
                  <th style={{ width: 120 }}>الفصل التدريبي</th>
                  <th style={{ width: 180 }}>تاريخ النسخة</th>
                  <th style={{ width: 120 }}>المحتوى</th>
                  <th className="center" style={{ width: 230 }}>
                    حالة الدمج
                  </th>
                  <th className="center" style={{ width: 90 }}>
                    إجراء
                  </th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.id}>
                    <td>
                      <span className="num">{backup.trainerNo || '—'}</span>
                    </td>
                    <td>
                      <strong>{backup.trainerName || '—'}</strong>
                      <div className="row-note">
                        <bdi className="file-name">{backup.fileName}</bdi>
                      </div>
                    </td>
                    <td>{backup.specialization || '—'}</td>
                    <td>
                      <span className="num">{backup.term || '—'}</span>
                    </td>
                    <td>{stamp(backup.savedAt)}</td>
                    <td>
                      {backup.file
                        ? `${arabicDigits(backup.courses)} مقرراً — ${arabicDigits(backup.drafts)} مسودّة`
                        : '—'}
                    </td>
                    <td className="center">
                      <span
                        className={`badge ${BACKUP_STATUS_CLASS[backup.status]}`}
                        title={backup.message}
                      >
                        {BACKUP_STATUS_LABEL[backup.status]}
                      </span>
                      <div className="row-note">{backup.message}</div>
                    </td>
                    <td className="center">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => onRemove(backup.id)}
                          title="إزالة هذه النسخة من قائمة الجلسة"
                        >
                          <Trash2 size={14} aria-hidden />
                          إزالة
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {backups.length === 0 && (
                  <tr>
                    <td colSpan={8} className="center row-note">
                      لم تُرفع نسخة بعد في هذه الجلسة.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
