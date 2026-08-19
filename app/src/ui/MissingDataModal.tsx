import { Check, ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, SquarePen, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildingFromOffice, type TrainerProfile } from '../domain/department';
import {
  applyOwnReference,
  readOwnReference,
  type MissingItem,
  type OwnReference,
} from '../domain/missing';
import { getCourseService } from '../services/courseService';
import type { AssignedCourse } from '../services/trainerHome';
import { ContactStep, CourseStep, HoursStep } from './MissingSteps';

/**
 * منبثقة إكمال البيانات الناقصة.
 *
 * لا زرّ حفظ: كل تعديل يُكتب بعد سكوتٍ قصير ومؤشرٌ يقول «يحفظ…» ثم
 * «حُفظ». والخطوات هي النواقص نفسها — تُلتقط لحظة الفتح وتبقى ثابتة حتى
 * الإغلاق، فلا تختفي خطوةٌ تحت يد المدرب وهو يملؤها.
 */

const SAVE_DELAY_MS = 600;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Step {
  /** معرّف يطابق `MissingItem.id` كي يُفتح عندها. */
  id: string;
  title: string;
  kind: 'contact' | 'officeHours' | 'course';
  courseId?: string;
}

export interface MissingDataModalProps {
  profile: TrainerProfile;
  courses: AssignedCourse[];
  missing: MissingItem[];
  /** النقيصة التي تُفتح عندها المنبثقة (من الشريط أو من بطاقة مقرر). */
  startAt?: string;
  onClose(): void;
}

/** يبني خطوات المنبثقة من النواقص: بيانات التواصل، الساعات، ثم كل مقرر. */
function buildSteps(missing: MissingItem[], courses: AssignedCourse[]): Step[] {
  const steps: Step[] = [];
  const contactIds = new Set(['profile:email', 'profile:office', 'profile:studentContact']);
  if (missing.some((m) => contactIds.has(m.id))) {
    steps.push({ id: 'profile:email', title: 'بيانات التواصل والمكتب', kind: 'contact' });
  }
  if (missing.some((m) => m.id === 'profile:officeHours')) {
    steps.push({ id: 'profile:officeHours', title: 'الساعات المكتبية', kind: 'officeHours' });
  }
  for (const item of missing) {
    if (item.kind !== 'courseReferences' || !item.courseId) continue;
    const course = courses.find((c) => c.courseId === item.courseId);
    steps.push({
      id: item.id,
      title: `مراجع ${course?.name ?? item.courseName ?? ''}`,
      kind: 'course',
      courseId: item.courseId,
    });
  }
  return steps;
}

export function MissingDataModal({
  profile,
  courses,
  missing,
  startAt,
  onClose,
}: MissingDataModalProps) {
  const steps = useMemo(() => buildSteps(missing, courses), [missing, courses]);
  const [at, setAt] = useState(() => {
    const index = steps.findIndex((s) => s.id === startAt);
    return index >= 0 ? index : 0;
  });
  const [draft, setDraft] = useState<TrainerProfile>(profile);
  const [refs, setRefs] = useState<Record<string, OwnReference>>(() =>
    Object.fromEntries(
      courses
        .filter((c) => c.hasDocument)
        .map((c) => [c.courseId, readOwnReference(c.references)]),
    ),
  );
  const [save, setSave] = useState<SaveState>('idle');
  const [problem, setProblem] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<(() => Promise<void>) | null>(null);

  /** يجدول كتابةً مؤجّلة؛ آخر تعديل يلغي ما قبله فلا تتزاحم الكتابات. */
  const schedule = useCallback((write: () => Promise<void>) => {
    setSave('saving');
    pending.current = write;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const job = pending.current;
      pending.current = null;
      if (!job) return;
      try {
        await job();
        setSave('saved');
        setProblem('');
      } catch (e) {
        setSave('error');
        setProblem(String(e));
      }
    }, SAVE_DELAY_MS);
  }, []);

  /** الإغلاق يكتب ما لم يُكتب بعد — لا يضيع آخر حرف كُتب قبل الإغلاق. */
  const close = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const job = pending.current;
    pending.current = null;
    if (job) {
      try {
        await job();
      } catch {
        // فشل الكتابة الأخيرة يظهر في مؤشر اللوحة بعد إعادة التحميل
      }
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const editProfile = useCallback(
    (mutate: (p: TrainerProfile) => void) => {
      setDraft((current) => {
        const next = structuredClone(current);
        mutate(next);
        // المبنى مشتق من المكتب فيتبعه، ولا يُدخل يدوياً
        if (next.office !== current.office) {
          next.building = buildingFromOffice(next.office) || next.building;
        }
        schedule(async () => {
          const service = await getCourseService();
          const result = await service.saveTrainer(next);
          if (!result.ok) throw new Error(result.message);
        });
        return next;
      });
    },
    [schedule],
  );

  const editReference = useCallback(
    (courseId: string, patch: Partial<OwnReference>) => {
      setRefs((current) => {
        const next = { ...current, [courseId]: { ...current[courseId], ...patch } };
        schedule(async () => {
          const service = await getCourseService();
          const view = await service.view(courseId);
          if (!view) throw new Error('المقرر غير موجود.');
          const course = structuredClone(view.draft?.course ?? view.effective);
          course.references = applyOwnReference(course.references, next[courseId]);
          const result = await service.saveDraft(courseId, course);
          if (!result.ok) throw new Error(result.message);
        });
        return next;
      });
    },
    [schedule],
  );

  if (steps.length === 0) return null;
  const step = steps[Math.min(at, steps.length - 1)];
  const last = at >= steps.length - 1;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="إكمال البيانات الناقصة">
      <div className="modal-card">
        <div className="modal-header">
          <span className="modal-title">
            <SquarePen size={20} aria-hidden />
            إكمال البيانات والمعلومات الناقصة
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SaveBadge state={save} problem={problem} />
            <button className="modal-close" onClick={close} title="إغلاق النافذة" type="button">
              <X size={20} aria-hidden />
            </button>
          </span>
        </div>

        <div className="modal-stepper">
          <span style={{ fontWeight: 600, color: '#475569' }}>
            النقيصة {at + 1} من {steps.length}
          </span>
          <div className="stepper-nav">
            {steps.map((s, index) => (
              <button
                key={s.id}
                type="button"
                className={index === at ? 'step-pill active' : 'step-pill'}
                onClick={() => setAt(index)}
                title={`الانتقال إلى: ${s.title}`}
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-body">
          {step.kind === 'contact' && <ContactStep draft={draft} onEdit={editProfile} />}
          {step.kind === 'officeHours' && <HoursStep draft={draft} onEdit={editProfile} />}
          {step.kind === 'course' && step.courseId && (
            <CourseStep
              course={courses.find((c) => c.courseId === step.courseId)}
              value={refs[step.courseId] ?? { main: '', site: '', platform: '' }}
              onEdit={(patch) => editReference(step.courseId!, patch)}
            />
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn"
            style={{ visibility: at === 0 ? 'hidden' : 'visible' }}
            onClick={() => setAt((n) => Math.max(0, n - 1))}
          >
            <ChevronRight size={15} aria-hidden />
            السابق
          </button>
          <span className="note">كل تعديل يُحفظ تلقائياً على جهازك دون زرّ حفظ</span>
          {last ? (
            <button type="button" className="btn primary" onClick={close}>
              إنهاء وإغلاق
              <Check size={15} aria-hidden />
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => setAt((n) => n + 1)}>
              التالي
              <ChevronLeft size={15} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveBadge({ state, problem }: { state: SaveState; problem: string }) {
  if (state === 'idle') return null;
  if (state === 'saving') {
    return (
      <span className="save-state saving" style={{ background: '#fff', padding: '2px 8px', borderRadius: 999 }}>
        <LoaderCircle size={13} className="spin" aria-hidden /> يحفظ…
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="save-state saved" style={{ background: '#fff', padding: '2px 8px', borderRadius: 999 }}>
        <Check size={13} aria-hidden /> حُفظ تلقائياً
      </span>
    );
  }
  return (
    <span
      className="save-state error"
      title={problem}
      style={{ background: '#fff', padding: '2px 8px', borderRadius: 999 }}
    >
      <CircleAlert size={13} aria-hidden /> تعذّر الحفظ
    </span>
  );
}
