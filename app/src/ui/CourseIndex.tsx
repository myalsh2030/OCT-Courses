import {
  BookOpen,
  Clock,
  FilePenLine,
  FileUp,
  History,
  Library,
  Printer,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getCourseService,
  type CourseListItem,
  type TrainerListItem,
} from '../services/courseService';

interface SS01Meta {
  term: string;
  importedAt: string;
  assignmentCount: number;
}

/**
 * فهرس المقررات مع لوحة المدربين:
 * رفع تقرير SS01 يربط المدربين بمقرراتهم، وكل مدرب يختار اسمه فيُقصر
 * الفهرس على مقرراته (ومن دون اختيار تُعرض مقررات القسم كلها).
 */
export function CourseIndex() {
  const [items, setItems] = useState<CourseListItem[] | null>(null);
  const [trainers, setTrainers] = useState<TrainerListItem[]>([]);
  const [activeTrainer, setActive] = useState<string | null>(null);
  const [meta, setMeta] = useState<SS01Meta | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const service = await getCourseService();
    const trainerNo = await service.getActiveTrainerNo();
    const [list, trainerList, ss01Meta] = await Promise.all([
      service.list(trainerNo ?? undefined),
      service.listTrainers(),
      service.getSS01Meta(),
    ]);
    setItems(list);
    setTrainers(trainerList);
    setActive(trainerNo);
    setMeta(ss01Meta);
  }, []);

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [reload]);

  const chooseTrainer = useCallback(
    async (trainerNo: string | null) => {
      const service = await getCourseService();
      await service.setActiveTrainer(trainerNo);
      await reload();
    },
    [reload],
  );

  const uploadSS01 = useCallback(
    async (file: File) => {
      const service = await getCourseService();
      const result = await service.importSS01(await file.text());
      if (result.ok) {
        setNotice({
          kind: 'ok',
          text: `استُورد تقرير الفصل ${result.term}: ${result.assignmentCount} رابط مقرر↔مدرب لـ ${result.trainerCount} مدرباً.`,
        });
      } else {
        setNotice({ kind: 'error', text: result.message });
      }
      await reload();
    },
    [reload],
  );

  if (error) return <p className="center-note">تعذّر تحميل المقررات: {error}</p>;
  if (!items) return <p className="center-note">يُحمّل…</p>;

  const activeName = trainers.find((t) => t.trainerNo === activeTrainer)?.name;

  return (
    <>
      {/* ═════ المدربون وربط رايات ═════ */}
      <section className="ui-panel">
        <header>
          <Users size={20} aria-hidden />
          مدربو القسم
          <span className="counter" title="عدد المدربين من تقرير رايات">
            {trainers.length} مدرباً
          </span>
        </header>
        <div className="body">
          <div className="trainer-row">
            <button
              className={activeTrainer === null ? 'chip on' : 'chip'}
              onClick={() => chooseTrainer(null)}
              title="عرض مقررات القسم كلها دون تقييد"
            >
              الكل
            </button>
            {trainers.map((t) => (
              <button
                key={t.trainerNo}
                className={t.trainerNo === activeTrainer ? 'chip on' : 'chip'}
                onClick={() => chooseTrainer(t.trainerNo)}
                title={`${t.courseIds.length} مقررات مسندة — رقم المدرب ${t.trainerNo}`}
              >
                {t.name}
                <span className="chip-count">{t.courseIds.length}</span>
              </button>
            ))}
            {trainers.length === 0 && (
              <span className="muted-note">
                لا مدربين بعد — ارفع تقرير SS01 من رايات لربط المدربين بمقرراتهم.
              </span>
            )}
          </div>

          <div className="ss01-row">
            <button
              className="tb-btn"
              onClick={() => fileRef.current?.click()}
              title="رفع تقرير جدولة الشعب SS01 (CSV) — يُحدَّث مرة أو مرتين في الفصل ويستبدل الروابط السابقة"
            >
              <FileUp size={16} aria-hidden />
              رفع تقرير SS01
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadSS01(file);
                e.target.value = '';
              }}
            />
            {meta && (
              <span className="muted-note" title="بيان آخر استيراد لتقرير رايات">
                آخر ربط: الفصل {meta.term} — {meta.importedAt.slice(0, 10)} (
                {meta.assignmentCount} رابطاً)
              </span>
            )}
            <span className="grow" />
            <Link
              className="tb-btn"
              to="/print-all"
              title={
                activeTrainer
                  ? `عرض خطط ${activeName} متتابعة وطباعتها ملف PDF واحداً`
                  : 'عرض كل الخطط متتابعة وطباعتها ملف PDF واحداً'
              }
            >
              <Printer size={16} aria-hidden />
              طباعة جماعية
            </Link>
          </div>

          {notice && (
            <p className={notice.kind === 'ok' ? 'flash ok' : 'flash error'}>{notice.text}</p>
          )}
        </div>
      </section>

      {/* ═════ المقررات ═════ */}
      <section className="ui-panel">
        <header>
          <Library size={20} aria-hidden />
          {activeName ? `مقررات ${activeName}` : 'مقررات القسم'}
          <span className="counter" title="عدد المقررات المعروضة">
            {items.length} مقررات
          </span>
        </header>
        <div className="body">
          {items.length === 0 && (
            <p className="center-note">لا مقررات مسندة لهذا المدرب في تقرير رايات الحالي.</p>
          )}
          <div className="course-grid">
            {items.map((c) => (
              <Link className="course-card" to={`/course/${c.id}`} key={c.id}>
                <span className="code">
                  {/* الرمز كما في الخطة: حروف عربية وأرقام لاتينية («101 منتج») */}
                  <span title={`رمز المقرر في نظام رايات: ${c.rayatCode}`}>{c.displayCode}</span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    {c.versionCount > 0 && (
                      <span title={`${c.versionCount} إصداراً معتمداً مرفوعاً`}>
                        <History size={15} color="#1f7d76" aria-hidden />
                      </span>
                    )}
                    {c.hasDraft && (
                      <span title="لهذا المقرر مسودّة معدّلة محلياً">
                        <FilePenLine size={15} color="#b7791f" aria-hidden />
                      </span>
                    )}
                  </span>
                </span>
                <span className="name">
                  <BookOpen size={16} aria-hidden style={{ marginLeft: 6, verticalAlign: -2 }} />
                  {c.name}
                </span>
                {c.trainers.length > 0 && (
                  <span className="card-trainers" title="مدربو المقرر من تقرير رايات">
                    <Users size={13} aria-hidden style={{ verticalAlign: -2, marginLeft: 4 }} />
                    {c.trainers.join('، ')}
                  </span>
                )}
                <span className="meta">
                  <span className="badge level" title="الفصل التدريبي في الخطة">
                    المستوى {c.level}
                  </span>
                  <span className="badge" title="ساعات الاتصال الأسبوعية">
                    <Clock size={12} aria-hidden style={{ verticalAlign: -1.5, marginLeft: 3 }} />
                    {c.contactHours} س/أسبوع
                  </span>
                  <span className="badge" title="نوع التدريب">{c.trainingType}</span>
                  {c.hasDraft && <span className="badge draft">مسودّة معدّلة</span>}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
