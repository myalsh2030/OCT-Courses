import { type TrainerProfile } from '../domain/department';
import type { OwnReference } from '../domain/missing';
import type { AssignedCourse } from '../services/trainerHome';

/**
 * خطوات منبثقة إكمال البيانات — كلٌّ منها نموذجُ عرضٍ صرف: يقرأ القيم
 * ويبلّغ بالتعديل، ولا يعرف شيئاً عن الحفظ ولا عن ترتيب الخطوات.
 * فُصلت عن المنبثقة كي يبقى كلٌّ في حدّه.
 */

export interface ProfileStepProps {
  draft: TrainerProfile;
  onEdit: (mutate: (profile: TrainerProfile) => void) => void;
}

export function ContactStep({
  draft,
  onEdit,
}: ProfileStepProps) {
  return (
    <>
      <h3>بيانات التواصل وقنوات الاتصال بالمتدربين</h3>
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label" htmlFor="officeInput">
            رقم المكتب
          </label>
          <input
            id="officeInput"
            className="form-input ltr"
            value={draft.office}
            placeholder="مثال: 1350610108"
            onChange={(e) => onEdit((p) => void (p.office = e.target.value))}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="buildingInput">
            رقم المبنى
          </label>
          <input
            id="buildingInput"
            className="form-input ltr"
            value={draft.building}
            disabled
            title="المبنى يُشتق من الخانتين الرابعة والخامسة من رقم المكتب فلا يُدخل يدوياً"
          />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="emailInput">
          البريد الإلكتروني الرسمي
        </label>
        <input
          id="emailInput"
          className="form-input ltr"
          type="email"
          value={draft.email}
          placeholder="name@tvtc.gov.sa"
          onChange={(e) => onEdit((p) => void (p.email = e.target.value))}
        />
      </div>

      <div className="form-group">
        <label className="form-check" htmlFor="whatsappOn">
          <input
            id="whatsappOn"
            type="checkbox"
            checked={draft.channels.whatsapp}
            onChange={(e) => onEdit((p) => void (p.channels.whatsapp = e.target.checked))}
          />
          واتساب وسيلةً للتواصل (اختياري)
        </label>
        {draft.channels.whatsapp && (
          <input
            className="form-input ltr"
            type="tel"
            style={{ marginTop: 6 }}
            value={draft.whatsapp}
            placeholder="05xxxxxxxx"
            onChange={(e) => onEdit((p) => void (p.whatsapp = e.target.value))}
          />
        )}
      </div>

      <div className="form-group">
        <label className="form-check" htmlFor="otherOn">
          <input
            id="otherOn"
            type="checkbox"
            checked={draft.channels.other}
            onChange={(e) => onEdit((p) => void (p.channels.other = e.target.checked))}
          />
          وسيلة أخرى (تُذكر)
        </label>
        {draft.channels.other && (
          <input
            className="form-input"
            style={{ marginTop: 6 }}
            value={draft.channels.otherValue}
            placeholder="مثال: قناة تليجرام للمقرر"
            onChange={(e) => onEdit((p) => void (p.channels.otherValue = e.target.value))}
          />
        )}
      </div>
    </>
  );
}

export function HoursStep({
  draft,
  onEdit,
}: ProfileStepProps) {
  return (
    <>
      <h3>تحديد مواعيد الساعات المكتبية الأسبوعية</h3>
      <p className="hint">
        حدّد فترات الساعات المكتبية المتاحة للمتدربين — يومٌ واحد ببداية ونهاية يكفي لرفع النقص،
        واليوم الفارغ يعني لا ساعات فيه.
      </p>
      <table className="hours-table">
        <thead>
          <tr>
            <th style={{ width: 120 }}>اليوم</th>
            <th>من الساعة</th>
            <th>إلى الساعة</th>
          </tr>
        </thead>
        <tbody>
          {draft.officeHours.map((day, index) => (
            <tr key={day.day}>
              <td>
                <strong>{day.day}</strong>
              </td>
              <td>
                <input
                  className="form-input ltr"
                  value={day.from}
                  placeholder="09 : 00"
                  aria-label={`بداية ${day.day}`}
                  onChange={(e) => onEdit((p) => void (p.officeHours[index].from = e.target.value))}
                />
              </td>
              <td>
                <input
                  className="form-input ltr"
                  value={day.to}
                  placeholder="10 : 00"
                  aria-label={`نهاية ${day.day}`}
                  onChange={(e) => onEdit((p) => void (p.officeHours[index].to = e.target.value))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function CourseStep({
  course,
  value,
  onEdit,
}: {
  course?: AssignedCourse;
  value: OwnReference;
  onEdit: (patch: Partial<OwnReference>) => void;
}) {
  return (
    <>
      <h3>
        مراجع ومصادر تعلّم مقرر: {course?.name ?? ''} ({course?.rayatCode ?? ''})
      </h3>
      <p className="hint">
        الروابط المؤسسية العامة (الحقيبة التدريبية وبلاكبورد والمكتبات الرقمية) مثبتة في الوثيقة،
        وهذه إضافتك الخاصة بهذا المقرر.
      </p>

      <div className="form-group">
        <label className="form-label" htmlFor="refMain">
          الكتاب أو المرجع الرئيس المعتمد للمقرر
        </label>
        <input
          id="refMain"
          className="form-input"
          value={value.main}
          placeholder="مثال: أساسيات ميكانيكا الموائع وتطبيقاتها"
          onChange={(e) => onEdit({ main: e.target.value })}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="refSite">
          موقع إلكتروني مساند
        </label>
        <input
          id="refSite"
          className="form-input"
          value={value.site}
          placeholder="اسم الموقع كما يُكتب في الوثيقة"
          onChange={(e) => onEdit({ site: e.target.value })}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="refPlatform">
          منصة إلكترونية مساندة
        </label>
        <input
          id="refPlatform"
          className="form-input"
          value={value.platform}
          placeholder="اسم المنصة كما تُكتب في الوثيقة"
          onChange={(e) => onEdit({ platform: e.target.value })}
        />
      </div>
    </>
  );
}
