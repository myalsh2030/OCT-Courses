import { Clock, FilePenLine, Mail, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DEFAULT_DEPARTMENT } from '../domain/department';
import { courseCompletion } from '../domain/missing';
import type { TrainerProfile } from '../domain/department';
import { arabicCount, COUNT_ITEMS } from '../domain/vocab';
import type { AssignedCourse } from '../services/trainerHome';

/**
 * بطاقة مقرر مسند.
 *
 * حالتان لا ثالثة: مقرر له توصيف تفصيلي فتظهر نسبة اكتماله وما ينقصه،
 * ومقرر مسند في رايات بلا توصيف — يظهر ببطاقةٍ معلَّمة تقول ذلك صراحةً.
 * لا يُخفى ولا يُترك فراغاً: المدرب يراه في جدوله فيجب أن يرى مصيره هنا.
 */

export interface CourseCardProps {
  course: AssignedCourse;
  profile: TrainerProfile;
  /** يفتح منبثقة الإكمال عند نقيصة هذا المقرر. */
  onComplete(missingId: string): void;
}

function sectionLabel(index: number): string {
  return `ش${index + 1}`;
}

export function CourseCard({ course, profile, onComplete }: CourseCardProps) {
  const sections = (
    <div className="sections-info">
      <span className="label">الشعب المسندة:</span>
      <div className="crn-list">
        {course.sections.map((section, index) => (
          <span
            key={section.ref}
            className="crn-tag"
            title={`${section.type || 'شعبة'} — الرقم المرجعي ${section.ref}`}
          >
            {sectionLabel(index)}: <strong className="num">{section.ref}</strong>
          </span>
        ))}
        {course.sections.length === 0 && <span className="crn-tag">لا شعب في هذا الفصل</span>}
      </div>
    </div>
  );

  if (!course.hasDocument) {
    const head = DEFAULT_DEPARTMENT.headOfDepartment;
    const mail = `mailto:${head.email}?subject=${encodeURIComponent(
      `طلب توصيف مقرر ${course.rayatCode}`,
    )}&body=${encodeURIComponent(
      `السلام عليكم،\n\nالمقرر ${course.rayatCode} (${course.name}) مسند إليّ هذا الفصل ولا يوجد له توصيف تفصيلي في موقع القسم.\nأرجو تزويدي به أو اعتماد إنشائه.\n\n${profile.name} — ${profile.trainerNo}`,
    )}`;
    return (
      <div className="course-card unplanned">
        <div className="course-card-header">
          <span className="code" title="رمز المقرر في نظام رايات">
            {course.rayatCode}
          </span>
          <span className="badge danger" title="لا يوجد ملف توصيف معتمد لهذا المقرر في الموقع">
            لا توصيف تفصيلي بعد
          </span>
        </div>
        <div className="name">{course.name}</div>
        {sections}
        <div className="unplanned-notice">
          <span className="head">
            <TriangleAlert size={15} aria-hidden />
            لم يُنشأ توصيف تفصيلي لهذا المقرر بعد
          </span>
          <p>
            المقرر مسند إليك في تقرير رايات، ولم يُرفع له توصيف معتمد في بيانات القسم — فلا خطة
            أسبوعية له تُطبع أو تُصدَّر.
          </p>
        </div>
        <div className="card-actions" style={{ marginTop: 'auto', paddingTop: 8 }}>
          <a className="btn" href={mail} title="مراسلة رئيس القسم لطلب توصيف هذا المقرر">
            <Mail size={14} aria-hidden />
            طلب التوصيف من رئيس القسم
          </a>
        </div>
      </div>
    );
  }

  const { percent, missing } = courseCompletion(profile, course);
  const complete = missing.length === 0;
  const badge = complete
    ? { className: 'badge complete', text: 'مكتمل ١٠٠٪' }
    : {
        className: 'badge warning',
        text: `ينقص ${arabicCount(missing.length, COUNT_ITEMS)} — ${percent}٪`,
      };
  const fill = complete ? 'complete' : course.hasDraft ? 'draft' : 'warning';

  return (
    <div className={complete ? 'course-card' : 'course-card needs-work'}>
      <div className="course-card-header">
        <span className="code" title="رمز المقرر في نظام رايات">
          {course.rayatCode}
        </span>
        <span
          className={badge.className}
          title={complete ? 'كل ما تحتاجه هذه الوثيقة مكتمل' : missing.map((m) => m.label).join('، ')}
        >
          {badge.text}
        </span>
      </div>

      <div className="name">{course.name}</div>
      {sections}

      <div className="completion-progress">
        <div className="progress-track">
          <div className={`progress-fill ${fill}`} style={{ width: `${percent}%` }} />
        </div>
        <div className="progress-meta">
          <span className={complete ? '' : 'lack'} title="ما ينقص وثيقة هذا المقرر">
            {complete ? 'جاهز للطباعة والاعتماد' : `ينقص: ${missing.map((m) => m.label).join('، ')}`}
          </span>
          <span className="num" title="نسبة اكتمال وثيقة هذا المقرر">
            {percent}٪
          </span>
        </div>
      </div>

      <div className="meta-badges">
        <span className="badge level" title="المستوى في الخطة التدريبية">
          المستوى {course.level}
        </span>
        <span className="badge" title="ساعات الاتصال الأسبوعية">
          <Clock size={12} aria-hidden style={{ verticalAlign: -1.5, marginLeft: 3 }} />
          {course.contactHours} س/أسبوع
        </span>
        <span className="badge" title="نوع التدريب في الخطة">
          {course.trainingType}
        </span>
        {course.hasDraft && (
          <span className="badge draft" title="لهذا المقرر تعديلات محلية محفوظة على جهازك">
            <FilePenLine size={12} aria-hidden style={{ verticalAlign: -1.5, marginLeft: 3 }} />
            مسودّة معدّلة
          </span>
        )}
      </div>

      <div className="card-actions">
        <Link
          className="btn primary"
          to={`/course/${course.courseId}`}
          title="فتح وثيقة المقرر لعرضها وتحريرها وطباعتها"
        >
          فتح الوثيقة
        </Link>
        {!complete && (
          <button
            type="button"
            className="btn warn narrow"
            onClick={() => onComplete(missing[0].id)}
            title={`إكمال: ${missing.map((m) => m.label).join('، ')}`}
          >
            إكمال النواقص
          </button>
        )}
      </div>
    </div>
  );
}
