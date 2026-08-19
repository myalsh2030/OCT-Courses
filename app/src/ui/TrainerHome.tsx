import {
  ChevronLeft,
  CircleAlert,
  Info,
  Library,
  LoaderCircle,
  Printer,
  RotateCcw,
  Save,
  Sheet,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { readBackup, trainerFileStem, type BackupSummary } from '../domain/backup';
import { DEFAULT_DEPARTMENT } from '../domain/department';
import { missingSummary } from '../domain/missing';
import { termLabel } from '../domain/term';
import { arabicCount, COUNT_COURSES, COUNT_DRAFTS, COUNT_MISSING } from '../domain/vocab';
import { applyBackup, buildBackupFile } from '../services/backupService';
import { getCourseService } from '../services/courseService';
import { loadHomeData, type HomeData } from '../services/trainerHome';
import { CourseCard } from './CourseCard';
import { MissingDataModal } from './MissingDataModal';
import { RestoreDialog } from './RestoreDialog';
import { useSession } from './sessionContext';
import './trainer.css';

/**
 * لوحة المدرب: مقرراته المسندة هذا الفصل، وما ينقص ملفه، وأدوات إخراجه.
 *
 * القاعدة المعلنة في الشاشة نفسها: التعديلات تعيش على جهازه وحده، فالنسخة
 * الاحتياطية هي طريق الحفظ الدائم — لذلك لا تُخفى الرسالة ولا تُصغَّر.
 */

/** ينزّل ملفاً من المتصفح باسمٍ مقترح. */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

type Busy = '' | 'excel' | 'backup' | 'restore';

/**
 * رسالة إجراء. اسم الملف يُفصل عن النص لا يُدمج فيه: اسمٌ يخلط عربيةً
 * بأرقامٍ ولاحقةٍ لاتينية تعكسه خوارزمية اتجاه النص داخل جملة عربية،
 * فيقرأه المدرب مقلوباً — و`<bdi>` يعزله فيظهر كما يُكتب في القرص.
 */
interface Notice {
  kind: 'ok' | 'error';
  text: string;
  file?: string;
}

export function TrainerHome() {
  const session = useSession();
  const navigate = useNavigate();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<Busy>('');
  const [modalAt, setModalAt] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<
    { summary: BackupSummary; raw: unknown } | null
  >(null);
  const restoreInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setData(await loadHomeData(session));
  }, [session]);

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [reload]);

  const rayatCodes = useMemo(
    () => session.record.sections.map((s) => s.rayatCode),
    [session.record.sections],
  );

  /* ───────── تنزيل Excel — الحزمة كسولة، لا تُحمَّل لمن لا يصدّر ───────── */
  const exportExcel = useCallback(async () => {
    if (!data) return;
    setBusy('excel');
    setNotice(null);
    try {
      const courses = data.courses.flatMap((c) => (c.course ? [c.course] : []));
      if (courses.length === 0) {
        setNotice({ kind: 'error', text: 'لا مقرر موصَّف لتصديره في هذا الفصل.' });
        return;
      }
      const service = await getCourseService();
      const head = await service.getDepartmentHead();
      const { buildWorkbookAll } = await import('../export/workbook');
      const now = new Date();
      const signedAt = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
      const workbook = buildWorkbookAll(
        courses,
        { ...DEFAULT_DEPARTMENT, headOfDepartment: head },
        data.profile,
        signedAt,
      );
      const buffer = await workbook.xlsx.writeBuffer();
      download(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `${trainerFileStem({ rayatCodes, trainerNo: session.trainerNo, term: session.term, at: now })}.xlsx`,
      );
      setNotice({
        kind: 'ok',
        text: `نُزّل ملف Excel فيه ${arabicCount(courses.length, COUNT_COURSES)}.`,
      });
    } catch (e) {
      setNotice({ kind: 'error', text: `تعذّر إنشاء ملف Excel: ${String(e)}` });
    } finally {
      setBusy('');
    }
  }, [data, rayatCodes, session.term, session.trainerNo]);

  /* ───────── النسخة الاحتياطية ───────── */
  const saveBackup = useCallback(async () => {
    setBusy('backup');
    setNotice(null);
    try {
      const { file, fileName } = await buildBackupFile(session);
      download(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }), fileName);
      setNotice({
        kind: 'ok',
        text: `حُفظت نسختك وفيها ${arabicCount(file.courses.length, COUNT_COURSES)} — أرسلها لرئيس القسم لتُحفظ حفظاً دائماً. اسم الملف:`,
        file: fileName,
      });
    } catch (e) {
      setNotice({ kind: 'error', text: `تعذّر حفظ النسخة: ${String(e)}` });
    } finally {
      setBusy('');
    }
  }, [session]);

  const openBackup = useCallback(async (file: File) => {
    setNotice(null);
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setNotice({ kind: 'error', text: 'الملف ليس JSON صالحاً.' });
      return;
    }
    const read = readBackup(raw);
    if (!read.ok) {
      setNotice({ kind: 'error', text: read.message });
      return;
    }
    setPendingRestore({ summary: read.summary, raw });
  }, []);

  const confirmRestore = useCallback(async () => {
    if (!pendingRestore) return;
    setBusy('restore');
    try {
      const read = readBackup(pendingRestore.raw);
      if (!read.ok) {
        setNotice({ kind: 'error', text: read.message });
        return;
      }
      const outcome = await applyBackup(read.file);
      const parts = [`استُعيد ملفك و${arabicCount(outcome.drafts, COUNT_DRAFTS)}`];
      if (outcome.skipped.length > 0) {
        parts.push(`تُخطّيت مقررات لا توصيف لها هنا: ${outcome.skipped.join('، ')}`);
      }
      if (outcome.rejected.length > 0) {
        parts.push(`ورُفضت لعدم صحتها: ${outcome.rejected.join(' • ')}`);
      }
      setNotice({ kind: outcome.rejected.length > 0 ? 'error' : 'ok', text: `${parts.join('. ')}.` });
      setPendingRestore(null);
      await reload();
    } catch (e) {
      setNotice({ kind: 'error', text: `تعذّرت الاستعادة: ${String(e)}` });
    } finally {
      setBusy('');
    }
  }, [pendingRestore, reload]);

  if (error) return <p className="stack-note">تعذّر تحميل لوحتك: {error}</p>;
  if (!data) return <p className="stack-note">تُحمَّل مقرراتك…</p>;

  const described = data.courses.filter((c) => c.hasDocument).length;

  return (
    <div className="trainer-home">
      {data.missing.length > 0 && (
        <aside className="missing-info-bar" role="alert">
          <span className="badge-count" title="عدد البيانات الناقصة في ملفك ومقرراتك">
            <CircleAlert size={14} aria-hidden />
            {arabicCount(data.missing.length, COUNT_MISSING)}
          </span>
          <div className="missing-text">
            <strong>لديك {arabicCount(data.missing.length, COUNT_MISSING)} في ملفك:</strong>
            <span>{missingSummary(data.missing)}.</span>
          </div>
          <button
            className="btn-action"
            type="button"
            onClick={() => setModalAt(data.missing[0].id)}
            title="فتح نافذة إكمال البيانات الناقصة"
          >
            <span>إكمال البيانات الآن</span>
            <ChevronLeft size={15} aria-hidden />
          </button>
        </aside>
      )}

      <div className="trainer-profile-card">
        <div className="profile-info">
          <div className="profile-avatar" title="أول حرف من اسمك">
            {session.trainerName.trim().at(0) ?? '؟'}
          </div>
          <div>
            <h1 className="profile-name">{session.trainerName}</h1>
            <div className="profile-meta">
              <span className="profile-meta-item" title="رقمك الوظيفي كما في رايات">
                رقم المدرب: <strong className="num">{session.trainerNo}</strong>
              </span>
              {session.department && (
                <span className="profile-meta-item" title="القسم الأكاديمي في التقرير">
                  {session.department}
                </span>
              )}
              <span className="profile-meta-item" title="الفصل التدريبي المعروض">
                {termLabel(session.term)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="alert-banner info">
        <Info size={22} aria-hidden />
        <div className="alert-content">
          <div className="alert-title">حفظ بياناتك — اقرأ هذا مرة واحدة</div>
          <p>
            تعديلاتك تُحفظ على جهازك فقط؛ ولحفظها بشكل دائم احفظ نسخة احتياطية وأرسلها لرئيس
            القسم.
          </p>
        </div>
      </div>

      <div className="actions-bar">
        <button
          className="btn primary"
          type="button"
          onClick={() => navigate('/print-all')}
          title="عرض خطط مقرراتك متتابعة وطباعتها ملف PDF واحداً"
        >
          <Printer size={16} aria-hidden />
          طباعة شاملة للمقررات
        </button>

        <button
          className="btn"
          type="button"
          onClick={exportExcel}
          disabled={busy !== ''}
          title="تنزيل مقرراتك مصنّف Excel — ورقة لكل مقرر بفواصل صفحاتها"
        >
          {busy === 'excel' ? (
            <LoaderCircle size={16} className="spin" aria-hidden />
          ) : (
            <Sheet size={16} aria-hidden />
          )}
          تنزيل Excel
        </button>

        <button
          className="btn"
          type="button"
          onClick={saveBackup}
          disabled={busy !== ''}
          title="تنزيل نسخة احتياطية (JSON) بكل مقرراتك وملفك — تُرسَل لرئيس القسم"
        >
          {busy === 'backup' ? (
            <LoaderCircle size={16} className="spin" aria-hidden />
          ) : (
            <Save size={16} aria-hidden />
          )}
          حفظ نسخة احتياطية
        </button>

        <button
          className="btn"
          type="button"
          onClick={() => restoreInput.current?.click()}
          disabled={busy !== ''}
          title="استعادة بياناتك من ملف نسخة احتياطية — يُعرض ملخّصها قبل التطبيق"
        >
          <RotateCcw size={16} aria-hidden />
          استعادة نسخة
        </button>
        <input
          ref={restoreInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) openBackup(file);
            e.target.value = '';
          }}
        />
      </div>

      {notice && (
        <div
          className={notice.kind === 'ok' ? 'alert-banner success' : 'alert-banner danger'}
          role="status"
        >
          <CircleAlert size={20} aria-hidden />
          <div className="alert-content">
            {notice.text}
            {notice.file && <bdi className="file-name"> {notice.file}</bdi>}
          </div>
        </div>
      )}

      <section className="ui-panel">
        <header>
          <Library size={20} aria-hidden />
          المقررات التدريبية المسندة
          <span className="counter" title="عدد مقرراتك المسندة في هذا الفصل، وكم منها بلا توصيف">
            {arabicCount(data.courses.length, COUNT_COURSES)}
            {data.courses.length > described &&
              ` — ${arabicCount(data.courses.length - described, COUNT_COURSES)} بلا توصيف`}
          </span>
        </header>
        <div className="body">
          {data.courses.length === 0 && (
            <p className="stack-note">
              لا شعب مسندة إليك في {termLabel(session.term)} حسب تقرير رايات المنشور.
            </p>
          )}
          <div className="course-grid">
            {data.courses.map((course) => (
              <CourseCard
                key={course.courseId || course.rayatCode}
                course={course}
                profile={data.profile}
                onComplete={setModalAt}
              />
            ))}
          </div>
        </div>
      </section>

      {modalAt !== null && (
        <MissingDataModal
          profile={data.profile}
          courses={data.courses}
          missing={data.missing}
          startAt={modalAt}
          onClose={() => {
            setModalAt(null);
            reload().catch((e) => setError(String(e)));
          }}
        />
      )}

      {pendingRestore && (
        <RestoreDialog
          summary={pendingRestore.summary}
          currentTerm={session.term}
          currentTrainerNo={session.trainerNo}
          busy={busy === 'restore'}
          onConfirm={confirmRestore}
          onCancel={() => setPendingRestore(null)}
        />
      )}
    </div>
  );
}
