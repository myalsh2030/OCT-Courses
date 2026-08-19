import { ArrowRight, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Course } from '../domain/course.schema';
import {
  DEFAULT_DEPARTMENT,
  type ContactBlock,
  type TrainerProfile,
} from '../domain/department';
import { adaptCourseLength } from '../domain/planLength';
import type { SemesterLength } from '../domain/semester';
import { CourseDocument } from '../render/CourseDocument';
import { getCourseService } from '../services/courseService';

interface Loaded {
  courses: Course[];
  trainer: TrainerProfile;
  head: ContactBlock;
  length: SemesterLength;
  scopeName: string | null;
}

/**
 * الطباعة الجماعية: كل الخطط (أو خطط المدرب المختار) متتابعة في صفحة
 * واحدة — طباعة متصفح واحدة تُنتج ملف PDF واحداً يضم الجميع، كل خطة
 * تبدأ صفحة جديدة. لملفات PDF منفصلة مضغوطة: `npm run export:zip` محلياً.
 */
export function PrintAll() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const service = await getCourseService();
      const trainerNo = await service.getActiveTrainerNo();
      const [list, trainer, head, length, trainers] = await Promise.all([
        service.list(trainerNo ?? undefined),
        service.getTrainer(),
        service.getDepartmentHead(),
        service.getSemesterLength(),
        service.listTrainers(),
      ]);
      const courses: Course[] = [];
      for (const item of list) {
        const view = await service.view(item.id);
        if (view) courses.push(view.effective);
      }
      if (!alive) return;
      setData({
        courses,
        trainer,
        head,
        length,
        scopeName: trainers.find((t) => t.trainerNo === trainerNo)?.name ?? null,
      });
    })().catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p className="center-note">تعذّر التحميل: {error}</p>;
  if (!data) return <p className="center-note">تُحمّل الخطط…</p>;

  const department = { ...DEFAULT_DEPARTMENT, headOfDepartment: data.head };
  const signedAt = (() => {
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  })();

  return (
    <>
      <div className="course-toolbar">
        <Link to="/" className="tb-btn" title="عودة إلى فهرس المقررات">
          <ArrowRight size={16} aria-hidden />
          الفهرس
        </Link>
        <span className="tb-title">
          طباعة جماعية {data.scopeName ? `— خطط ${data.scopeName}` : '— كل خطط القسم'}
          <span className="badge" title="عدد الخطط في هذا الملف">{data.courses.length} خطط</span>
        </span>
        <span className="grow" />
        <button
          className="tb-btn on"
          onClick={() => window.print()}
          title="طباعة واحدة تُنتج ملف PDF واحداً يضم كل الخطط المعروضة"
        >
          <Printer size={16} aria-hidden />
          طباعة الكل
        </button>
      </div>

      {data.courses.map((course) => (
        <CourseDocument
          key={course.id}
          course={data.length === 19 ? course : adaptCourseLength(course, data.length)}
          department={department}
          trainer={data.trainer}
          signedAt={signedAt}
        />
      ))}
    </>
  );
}
