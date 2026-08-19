import { CircleAlert, FileSpreadsheet, GraduationCap, LogIn, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { diffBundle, type BundleDiff } from '../domain/bundle';
import { readSS01Rows, type SS01Row } from '../domain/ss01';
import { readTerm, termLabel } from '../domain/term';
import {
  listArchivedTerms,
  readTermSnapshot,
  saveTermSnapshot,
  summarizeRows,
  trainerNumbersOf,
  type ArchivedTerm,
} from '../services/adminArchive';
import {
  classifyBackups,
  parseBackupText,
  type ParsedBackup,
} from '../services/adminBackups';
import { AdminArchive } from './AdminArchive';
import { AdminBackups } from './AdminBackups';
import { AdminDiff } from './AdminDiff';
import { AdminDropzone } from './AdminDropzone';
import { AdminPackage } from './AdminPackage';
import { AdminSummary, SaveBadge, type SaveState } from './AdminSummary';
import './admin.css';
import './shell.css';
import './trainer.css';

/**
 * صفحة الأدمن — الحلقة الأولى من دورة البيانات (`.agent/architecture-oct.md`):
 * يرفع الأدمن تقرير رايات، فتُقرأ صفوفه في متصفحه، وتظهر فروقه عن آخر
 * لقطة محفوظة، ثم يُنتَج منه ملفٌ معمّى يُسلَّم لمن ينشره.
 *
 * الصفحة **أداةٌ محلية**: لا تعرض من بيانات المنسوبين إلا ما رفعه الأدمن
 * بنفسه، ولا يخرج منها إلى المستودع إلا الملف المعمّى بعد حارس الحرف
 * العربي. والحفظ تلقائي: لقطة الفصل تُكتب فور قراءة الملف بلا زر حفظ.
 */

interface ActiveTerm {
  term: string;
  rows: SS01Row[];
  savedAt: string;
  fileName: string;
  /** من أين جاء المعروض: رفعٌ الآن أم لقطة من الأرشيف. */
  source: 'upload' | 'archive';
}

interface DiffState {
  diff: BundleDiff;
  previousSavedAt: string;
}

export function AdminPage() {
  const mainRef = useRef<HTMLElement>(null);
  const [archive, setArchive] = useState<ArchivedTerm[]>([]);
  const [active, setActive] = useState<ActiveTerm | null>(null);
  const [diff, setDiff] = useState<DiffState | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const [busyTerm, setBusyTerm] = useState('');
  const [parsed, setParsed] = useState<ParsedBackup[]>([]);

  /** آخر فصلٍ محفوظ يُفتح تلقائياً كي لا تُستقبل الصفحة فارغة بلا سبب. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const terms = await listArchivedTerms();
        if (!alive) return;
        setArchive(terms);
        if (terms.length === 0) return;
        const snapshot = await readTermSnapshot(terms[0].term);
        if (!alive || !snapshot) return;
        setActive({
          term: snapshot.term,
          rows: snapshot.rows,
          savedAt: snapshot.savedAt,
          fileName: snapshot.fileName,
          source: 'archive',
        });
      } catch (e) {
        if (alive) setError(`تعذّر فتح أرشيف الفصول على هذا الجهاز: ${String(e)}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ───────── رفع تقرير الشعب: قراءة ← فروق ← حفظ تلقائي ───────── */
  const takeReport = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError('');
    setSave('saving');
    try {
      const read = readSS01Rows(await file.text());
      if (!read.ok) {
        setError(read.message ?? 'تعذّر تحليل الملف.');
        setSave('error');
        return;
      }
      const term = readTerm(read.term).code;
      if (!term) {
        setError('لم يُعثر على رقم الفصل التدريبي في التقرير — تأكّد أنه تقرير SS01 كامل.');
        setSave('error');
        return;
      }

      // الفروق تُحسب قبل الكتابة: بعدها يصير المحفوظ هو المرفوع نفسه
      const previous = await readTermSnapshot(term);
      const computed = diffBundle(previous?.rows ?? [], read.rows);
      const snapshot = await saveTermSnapshot(read.rows, file.name);

      setActive({
        term,
        rows: read.rows,
        savedAt: snapshot.savedAt,
        fileName: file.name,
        source: 'upload',
      });
      setDiff({ diff: computed, previousSavedAt: previous?.savedAt ?? '' });
      setSave('saved');
      setArchive(await listArchivedTerms());
    } catch (e) {
      setError(`تعذّرت قراءة التقرير أو حفظه: ${String(e)}`);
      setSave('error');
    }
  }, []);

  /* ───────── العودة إلى فصل مؤرشف ───────── */
  const openArchived = useCallback(async (term: string) => {
    setBusyTerm(term);
    setError('');
    try {
      const snapshot = await readTermSnapshot(term);
      if (!snapshot) {
        setError(`لم تُوجد لقطة محفوظة للفصل ${term} على هذا الجهاز.`);
        return;
      }
      setActive({
        term: snapshot.term,
        rows: snapshot.rows,
        savedAt: snapshot.savedAt,
        fileName: snapshot.fileName,
        source: 'archive',
      });
      setDiff(null);
      setSave('idle');
      mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(`تعذّر فتح لقطة الفصل: ${String(e)}`);
    } finally {
      setBusyTerm('');
    }
  }, []);

  /* ───────── نسخ المدربين ───────── */
  const takeBackups = useCallback(async (files: File[]) => {
    const read = await Promise.all(
      files.map(async (file) => {
        try {
          return parseBackupText(file.name, await file.text());
        } catch (e) {
          return { fileName: file.name, file: null, summary: null, error: String(e) };
        }
      }),
    );
    setParsed((previous) => [...previous, ...read]);
  }, []);

  const removeBackup = useCallback((id: string) => {
    setParsed((previous) => previous.filter((item, index) => `${item.fileName}#${index}` !== id));
  }, []);

  const backups = useMemo(
    () =>
      classifyBackups(parsed, {
        term: active?.term ?? '',
        trainerNumbers: trainerNumbersOf(active?.rows ?? []),
      }),
    [parsed, active],
  );

  const summary = useMemo(() => (active ? summarizeRows(active.rows) : null), [active]);

  return (
    <div className="shell admin-page">
      <div className="topbar">
        <span className="title">
          <GraduationCap size={22} aria-hidden />
          إدارة الخطط والشعب
        </span>
        <span className="topbar-badge" title="صلاحية مدير النظام: رفع التقارير وإنتاج الحزم">
          مدير النظام
        </span>
        <span className="grow" />
        <Link to="/" title="الانتقال إلى شاشة دخول المدرب">
          <LogIn size={18} aria-hidden />
          شاشة دخول المدرب
        </Link>
      </div>

      <main ref={mainRef}>
        <div className="admin-main">
          <div className="admin-head">
            <div>
              <h1>مركز إدارة الجداول والبيانات الأكاديمية</h1>
              <p>
                تحديث تقرير الشعب (SS01)، ومقارنة فروقه، واستقبال نسخ المدربين، وإنتاج حزمة النشر
                المعمّاة.
              </p>
            </div>
            <SaveBadge state={save} at={active?.savedAt ?? ''} term={active?.term ?? ''} />
          </div>

          <section className="ui-panel">
            <header>
              <FileSpreadsheet size={20} aria-hidden />
              <span className="header-title">
                تحديث تقرير الشعب التدريبية (SS01)
                <span className="header-subtitle">— قراءة تقرير رايات ومقارنة فروقه تلقائياً</span>
              </span>
              <span className="counter" title="الفصل التدريبي المعروض الآن">
                {active ? termLabel(active.term) : 'لا فصل معروض'}
              </span>
            </header>

            <div className="panel-body">
              <AdminDropzone
                accept=".csv,text/csv"
                disabled={save === 'saving'}
                icon={<Upload size={26} aria-hidden />}
                title="اسحب تقرير جدول الشعب (SS01) بصيغة CSV هنا، أو انقر للاستعراض"
                hint="التقرير المعتمد من رايات يحوي أعمدة: الفصل التدريبي، القسم، المقرر، اسم المقرر، الرقم المرجعي، نوع الشعبة، رقم المدرب، اسم المدرب. يُقرأ في متصفحك ولا يُرسل إلى أي خادم."
                buttonLabel="اختيار ملف CSV من الجهاز"
                buttonIcon={<FileSpreadsheet size={16} aria-hidden />}
                onFiles={takeReport}
              />

              {error && (
                <div className="alert-banner danger" role="alert" style={{ marginTop: 20 }}>
                  <CircleAlert size={20} aria-hidden />
                  <div className="alert-content">
                    <div className="alert-title">تعذّر قبول الملف</div>
                    <p>{error}</p>
                  </div>
                </div>
              )}

              {summary && active && (
                <AdminSummary
                  summary={summary}
                  source={active.source}
                  fileName={active.fileName}
                  savedAt={active.savedAt}
                />
              )}

              {diff && active && (
                <AdminDiff
                  diff={diff.diff}
                  term={active.term}
                  previousSavedAt={diff.previousSavedAt}
                />
              )}

              <AdminArchive
                terms={archive}
                activeTerm={active?.term ?? ''}
                busyTerm={busyTerm}
                onOpen={openArchived}
              />
            </div>
          </section>

          <AdminBackups backups={backups} onFiles={takeBackups} onRemove={removeBackup} />

          {active && <AdminPackage rows={active.rows} term={active.term} />}
        </div>
      </main>
    </div>
  );
}
