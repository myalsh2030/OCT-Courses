import {
  ArrowRight,
  CalendarRange,
  Check,
  CircleAlert,
  Download,
  FileUp,
  History,
  LoaderCircle,
  Pencil,
  Printer,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Course } from '../domain/course.schema';
import {
  buildingFromOffice,
  DEFAULT_DEPARTMENT,
  type ContactBlock,
  type TrainerProfile,
} from '../domain/department';
import { addUnitRow, removeUnitRow, setUnitTopic } from '../domain/planEdit';
import { adaptCourseLength } from '../domain/planLength';
import { SEMESTER_LENGTHS, type SemesterLength } from '../domain/semester';
import { CourseDocument } from '../render/CourseDocument';
import { getCourseService, type VersionMeta } from '../services/courseService';
import type { DefaultVersionPointer } from '../domain/versionFile';
import { EditContext, type DocumentEditApi } from './EditContext';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string };

const AUTOSAVE_DELAY_MS = 800;

/**
 * شاشة المقرر: الوثيقة نفسها بطول الفصل المختار، مع وضع تحرير يحفظ
 * تلقائياً في مسودّة محلية (المخزَّن قانوني بطول ١٩ دائماً؛ الطول تحويل
 * عرضٍ فلا يمسّ تعديلات أسابيع التدريس).
 */
export function CourseView() {
  const { id = '' } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [trainer, setTrainer] = useState<TrainerProfile | null>(null);
  const [head, setHead] = useState<ContactBlock | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [defaultVersion, setDefaultVersion] = useState<DefaultVersionPointer>('latest');
  const [effectiveSource, setEffectiveSource] = useState<'draft' | 'version' | 'original'>('original');
  const [notFound, setNotFound] = useState(false);
  const [length, setLength] = useState<SemesterLength>(19);
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trainerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionFileRef = useRef<HTMLInputElement>(null);

  const loadView = useCallback(async () => {
    const service = await getCourseService();
    const view = await service.view(id);
    if (!view) {
      setNotFound(true);
      return;
    }
    setCourse(view.effective);
    setHasDraft(view.draft !== null);
    setVersions(view.versions);
    setDefaultVersion(view.defaultVersion);
    setEffectiveSource(view.effectiveSource);
  }, [id]);

  useEffect(() => {
    let alive = true;
    // الانتقال لمقرر آخر يبدأ عرضاً نظيفاً — لا يورث وضع تحرير المقرر السابق
    setEditing(false);
    setSaveState({ kind: 'idle' });
    (async () => {
      const service = await getCourseService();
      const [storedLength, storedTrainer, storedHead] = await Promise.all([
        service.getSemesterLength(),
        service.getTrainer(),
        service.getDepartmentHead(),
      ]);
      if (!alive) return;
      await loadView();
      setLength(storedLength);
      setTrainer(storedTrainer);
      setHead(storedHead);
    })();
    return () => {
      alive = false;
    };
  }, [id, loadView]);

  /** يعدّل المقرر القانوني ويجدول الحفظ التلقائي المتفائل. */
  const applyEdit = useCallback(
    (mutate: (draft: Course) => void) => {
      setCourse((current) => {
        if (!current) return current;
        const next = structuredClone(current);
        mutate(next);
        setSaveState({ kind: 'saving' });
        setHasDraft(true);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
          const service = await getCourseService();
          const result = await service.saveDraft(id, next);
          setSaveState(
            result.ok ? { kind: 'saved' } : { kind: 'error', message: result.message },
          );
        }, AUTOSAVE_DELAY_MS);
        return next;
      });
    },
    [id],
  );

  /** تعديل ملف المدرب أو رئيس القسم: تفاؤلي + حفظ مؤجّل في مخزنه المستقل. */
  const applyTrainerEdit = useCallback((mutate: (t: TrainerProfile) => void) => {
    setTrainer((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      mutate(next);
      // المبنى مشتق من المكتب (الخانتان الرابعة والخامسة) — يتبعه تلقائياً
      // متى غُيّر المكتب، فلا يتناقض الحقلان في الوثيقة.
      if (next.office !== current.office) {
        const derived = buildingFromOffice(next.office);
        if (derived) next.building = derived;
      }
      setSaveState({ kind: 'saving' });
      if (trainerTimer.current) clearTimeout(trainerTimer.current);
      trainerTimer.current = setTimeout(async () => {
        const service = await getCourseService();
        const result = await service.saveTrainer(next);
        setSaveState(result.ok ? { kind: 'saved' } : { kind: 'error', message: result.message });
      }, AUTOSAVE_DELAY_MS);
      return next;
    });
  }, []);

  const applyHeadEdit = useCallback((mutate: (h: ContactBlock) => void) => {
    setHead((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      mutate(next);
      setSaveState({ kind: 'saving' });
      if (headTimer.current) clearTimeout(headTimer.current);
      headTimer.current = setTimeout(async () => {
        const service = await getCourseService();
        const result = await service.saveDepartmentHead(next);
        setSaveState(result.ok ? { kind: 'saved' } : { kind: 'error', message: result.message });
      }, AUTOSAVE_DELAY_MS);
      return next;
    });
  }, []);

  const editApi = useMemo<DocumentEditApi>(
    () => ({
      setObjectives: (weekIndex, text) =>
        applyEdit((c) => {
          const week = c.plan[weekIndex];
          if (week) week.objectives = [{ lines: text.split('\n'), span: week.rowCount }];
        }),
      setStrategy: (weekIndex, cellIndex, value) =>
        applyEdit((c) => {
          const cell = c.plan[weekIndex]?.strategies[cellIndex];
          if (cell) cell.text = value;
        }),
      setTool: (weekIndex, cellIndex, value) =>
        applyEdit((c) => {
          const cell = c.plan[weekIndex]?.tools[cellIndex];
          if (cell) cell.text = value;
        }),
      setUnitTopic: (weekIndex, rowIndex, text) =>
        applyEdit((c) => {
          const week = c.plan[weekIndex];
          if (week) setUnitTopic(week, rowIndex, text);
        }),
      addUnitRow: (weekIndex) =>
        applyEdit((c) => {
          const week = c.plan[weekIndex];
          if (week) addUnitRow(week);
        }),
      removeUnitRow: (weekIndex, rowIndex) =>
        applyEdit((c) => {
          const week = c.plan[weekIndex];
          if (week) removeUnitRow(week, rowIndex);
        }),
      setReference: (rowIndex, field, value) =>
        applyEdit((c) => {
          const row = c.references[rowIndex];
          if (row) row[field] = value;
        }),
      addReference: () =>
        applyEdit((c) => {
          c.references.push({ main: '', site: '', platform: '' });
        }),
      removeReference: (rowIndex) =>
        applyEdit((c) => {
          c.references.splice(rowIndex, 1);
        }),
      setResources: (text) =>
        applyEdit((c) => {
          c.resources = text;
        }),
      setEquipment: (text) =>
        applyEdit((c) => {
          c.equipment = text.split('\n').map((l) => l.trim()).filter(Boolean);
        }),
      setSafety: (text) =>
        applyEdit((c) => {
          // إفراغ كل الأسطر يعيد وراثة نص القسم الموحّد
          c.safetyInstructions = text.split('\n').map((l) => l.trim()).filter(Boolean);
        }),
      updateTrainer: applyTrainerEdit,
      updateHead: applyHeadEdit,
    }),
    [applyEdit, applyTrainerEdit, applyHeadEdit],
  );

  const changeLength = useCallback(async (next: SemesterLength) => {
    setLength(next);
    const service = await getCourseService();
    await service.setSemesterLength(next);
  }, []);

  const discardDraft = useCallback(async () => {
    if (!window.confirm('إسقاط مسودّتك المحلية؟ سيُعرض الإصدار المعتمد (أو الأصل) بدلاً منها.')) {
      return;
    }
    const service = await getCourseService();
    await service.discardDraft(id);
    setSaveState({ kind: 'idle' });
    setEditing(false);
    await loadView();
  }, [id, loadView]);

  /** تنزيل ملف الإصدار الموقّع باسم المدرب — الوسيط نحو الحفظ المركزي. */
  const exportVersion = useCallback(async () => {
    const service = await getCourseService();
    const result = await service.exportVersionFile(id);
    if (!result.ok) {
      setSaveState({ kind: 'error', message: result.message });
      return;
    }
    const blob = new Blob([JSON.stringify(result.file, null, 1)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.suggestedName;
    a.click();
    URL.revokeObjectURL(url);
  }, [id]);

  /** رفع ملف إصدار مُصدَّر → يصير الإصدار المعتمد المعروض افتراضاً. */
  const importVersion = useCallback(
    async (file: File) => {
      const service = await getCourseService();
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        setSaveState({ kind: 'error', message: 'الملف ليس JSON صالحاً.' });
        return;
      }
      const result = await service.importVersionFile(raw);
      if (!result.ok) {
        setSaveState({ kind: 'error', message: result.message });
        return;
      }
      setSaveState({ kind: 'idle' });
      await loadView();
    },
    [loadView],
  );

  /** الرجوع لإصدار محدد أو للأصل أو للأحدث. */
  const chooseVersion = useCallback(
    async (pointer: DefaultVersionPointer) => {
      const service = await getCourseService();
      await service.setDefaultVersion(id, pointer);
      await loadView();
    },
    [id, loadView],
  );

  const signedAt = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const department = useMemo(
    () => (head ? { ...DEFAULT_DEPARTMENT, headOfDepartment: head } : DEFAULT_DEPARTMENT),
    [head],
  );

  if (notFound) {
    return (
      <p className="center-note">
        لا يوجد مقرر بهذا المعرّف. <Link to="/home">عودة إلى لوحتي</Link>
      </p>
    );
  }
  if (!course || !trainer) return <p className="center-note">يُحمّل…</p>;

  const displayed = length === 19 ? course : adaptCourseLength(course, length);

  return (
    <>
      <div className="course-toolbar">
        <Link to="/home" className="tb-btn" title="عودة إلى لوحة مقرراتي">
          <ArrowRight size={16} aria-hidden />
          لوحتي
        </Link>
        <span className="tb-title">
          {course.name}
          <span className="badge" title="رمز المقرر في الخطة">{course.displayCode}</span>
          {effectiveSource === 'draft' && (
            <span className="badge draft" title="تُعرض مسودّتك المحلية — تعلو الإصدار المعتمد حتى تسقطها">
              مسودّتي
            </span>
          )}
          {effectiveSource === 'version' && (
            <span className="badge version" title="يُعرض إصدار معتمد مرفوع لا الأصل">
              إصدار معتمد
            </span>
          )}
        </span>
        <span className="grow" />

        <span title="عدد أسابيع الفصل التدريبي — يغيّر أسابيع الاختبار النهائي فقط">
          <CalendarRange size={17} aria-hidden style={{ verticalAlign: -3, marginLeft: 4 }} />
        </span>
        <div className="seg" role="group" aria-label="طول الفصل">
          {SEMESTER_LENGTHS.map((n) => (
            <button
              key={n}
              className={n === length ? 'on' : ''}
              onClick={() => changeLength(n)}
              title={`فصل من ${n} أسبوعاً`}
            >
              {n} أسبوعاً
            </button>
          ))}
        </div>

        <button
          className={editing ? 'tb-btn on' : 'tb-btn'}
          onClick={() => setEditing((v) => !v)}
          title="تحرير المواضيع (تعديلاً وإضافةً وحذفاً) والأهداف والاستراتيجيات وأدوات التقييم والمراجع — يُحفظ تلقائياً"
        >
          <Pencil size={16} aria-hidden />
          {editing ? 'إنهاء التحرير' : 'تحرير'}
        </button>

        {hasDraft && (
          <button className="tb-btn danger" onClick={discardDraft} title="حذف مسودّتي المحلية والرجوع للمعتمد أو الأصل">
            <RotateCcw size={16} aria-hidden />
            إسقاط مسودّتي
          </button>
        )}

        <button
          className="tb-btn"
          onClick={exportVersion}
          title="تنزيل ملف إصدار موقّعاً باسمك — يُرفع لاحقاً للصفحة المركزية ليصير إصداراً معتمداً"
        >
          <Download size={16} aria-hidden />
          تصدير
        </button>

        <button
          className="tb-btn"
          onClick={() => versionFileRef.current?.click()}
          title="رفع ملف إصدار مُصدَّر — يصير الإصدار المعتمد المعروض افتراضاً"
        >
          <FileUp size={16} aria-hidden />
          رفع إصدار
        </button>
        <input
          ref={versionFileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importVersion(file);
            e.target.value = '';
          }}
        />

        <button
          className="tb-btn"
          onClick={() => {
            // تُطبع الوثيقة النظيفة دائماً: يُنهى التحرير أولاً ثم تفتح الطباعة
            setEditing(false);
            setTimeout(() => window.print(), 120);
          }}
          title="طباعة الوثيقة (A4)"
        >
          <Printer size={16} aria-hidden />
          طباعة
        </button>

        <SaveIndicator state={saveState} />
      </div>

      {versions.length > 0 && (
        <div className="version-bar">
          <span title="سجل إصدارات هذا المقرر — اختر ما يُعرض ويُطبع">
            <History size={15} aria-hidden style={{ verticalAlign: -2, marginLeft: 4 }} />
            الإصدار المعروض:
          </span>
          <div className="seg">
            <button
              className={defaultVersion === 'original' ? 'on' : ''}
              onClick={() => chooseVersion('original')}
              title="النسخة الأصلية المولّدة من الخطة — محفوظة دائماً"
            >
              الأصل
            </button>
            {versions.map((v, i) => {
              const isLatest = i === versions.length - 1;
              const active =
                defaultVersion === v.seq || (defaultVersion === 'latest' && isLatest);
              return (
                <button
                  key={v.seq}
                  className={active ? 'on' : ''}
                  onClick={() => chooseVersion(isLatest ? 'latest' : v.seq)}
                  title={`رفعه ${v.author.name} (${v.author.trainerNo}) في ${v.createdAt.slice(0, 10)}`}
                >
                  إصدار {v.seq} — {v.author.name}
                  {isLatest ? ' (الأحدث)' : ''}
                </button>
              );
            })}
          </div>
          {hasDraft && (
            <span className="muted-note" title="مسودّتك تعلو أي إصدار — أسقطها لرؤية المختار">
              (مسودّتك المحلية تعلو المعروض)
            </span>
          )}
        </div>
      )}

      <EditContext.Provider value={editing ? editApi : null}>
        <CourseDocument
          course={displayed}
          department={department}
          trainer={trainer}
          signedAt={signedAt}
        />
      </EditContext.Provider>
    </>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'saving') {
    return (
      <span className="save-state saving">
        <LoaderCircle size={15} className="spin" aria-hidden /> يحفظ…
      </span>
    );
  }
  if (state.kind === 'saved') {
    return (
      <span className="save-state saved">
        <Check size={15} aria-hidden /> محفوظ
      </span>
    );
  }
  return (
    <span className="save-state error" title={state.message}>
      <CircleAlert size={15} aria-hidden /> رُفض الحفظ — {state.message}
    </span>
  );
}
