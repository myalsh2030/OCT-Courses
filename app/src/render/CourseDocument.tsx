import { Fragment } from 'react';
import type { Course } from '../domain/course.schema';
import type { Department, TrainerProfile } from '../domain/department';
import { FORM_TEMPLATE as T } from '../domain/template';
import { useDocumentEdit } from '../ui/EditContext';
import { ContactBlockView, DocHeader, Field, Page, Panel, Strip } from './parts';
import { PlanTable } from './PlanTable';
import './document.css';

export interface DocumentInput {
  course: Course;
  department: Department;
  /** المدرب المختار — تُحقن بياناته في الصفحة الأولى وصفحة التوقيع. */
  trainer: TrainerProfile;
  /** تاريخ التوقيع بصيغة yyyy/mm/dd. */
  signedAt: string;
  /** عدد الأسابيع في صفحة الخطة الأولى؛ الباقي في الثانية. */
  planSplit?: number;
}

export function CourseDocument({
  course,
  department,
  trainer,
  signedAt,
  planSplit = 10,
}: DocumentInput) {
  const edit = useDocumentEdit();
  const safety =
    course.safetyInstructions.length > 0
      ? course.safetyInstructions
      : department.safetyInstructions;

  /** حقل من ملف المدرب يصير قابلاً للتحرير متى حضر السياق. */
  const trainerField = (
    field: 'trainerNo' | 'name' | 'building' | 'office' | 'email',
  ): ((v: string) => void) | undefined =>
    edit
      ? (v) =>
          edit.updateTrainer((t) => {
            t[field] = v;
          })
      : undefined;

  return (
    <div className="doc-root">
      {/* ═════════ ١ — بيانات المدرب ووسيلة التواصل ═════════ */}
      <Page>
        <DocHeader college={department.college} />

        <Panel title={T.panels.trainer}>
          <div className="fields">
            <Field side="a" label="رقم المدرب" value={trainer.trainerNo} ltr onEdit={trainerField('trainerNo')} />
            <Field side="b" label="اسم/رقم المبنى" value={trainer.building} ltr onEdit={trainerField('building')} />
            <Field side="a" label="اسم المدرب" value={trainer.name} onEdit={trainerField('name')} />
            <Field side="b" label="اسم/رقم المكتب" value={trainer.office} ltr onEdit={trainerField('office')} />
            <Field side="a" label="القسم التدريبي" value={department.department} />
            <Field side="b" label="البريد الالكتروني" value={trainer.email} ltr onEdit={trainerField('email')} />
          </div>
        </Panel>

        <Panel title={T.panels.contact} bodyClass="contact-body">
          <Strip />
          <ContactBlockView
            contact={trainer}
            side={[...T.contactChannels.withCourseTrainer]}
            thirdChannel="whatsapp"
            onEdit={edit ? edit.updateTrainer : undefined}
          />
          <Strip />
          <ContactBlockView
            contact={department.headOfDepartment}
            side={[...T.contactChannels.withHeadOfDepartment]}
            thirdChannel="other"
            showOffice
            onEdit={edit ? edit.updateHead : undefined}
          />
          <Strip />
          <div className="note">
            {T.contactNotice} ( <span className="mailx">{T.traineeEmailPattern}</span> ).
          </div>
          <Strip />
        </Panel>
      </Page>

      {/* ═════════ ٢ — بيانات المقرر والأهداف ═════════ */}
      <Page>
        <DocHeader college={department.college} />

        <Panel title={T.panels.course}>
          <div className="fields f2">
            <Field side="a" label="القسم التدريبي" value={department.department} />
            <Field side="b" label="ساعات الاتصال" value={String(course.contactHours)} ltr />
            <Field side="a" label="التخصص" value={department.specialization} />
            <Field side="b" label="الساعات المعتمدة" value={String(course.creditHours)} ltr />
            <Field side="a" label="رمز المقرر" value={course.displayCode} />
            <Field side="b" label="نمط التدريب" value={course.trainingMode} />
            <Field side="a" label="اسم المقرر" value={course.name} />
            <Field side="b" label="مستوى المقرر" value={String(course.level)} ltr />
            <Field side="a" label="نوع التدريب" value={course.trainingType} />
            <Field side="b" label="المتطلب السابق" value={course.prerequisite} />
          </div>

          <div className="subhead">{T.panels.description}</div>
          <div className="textbox just" style={{ minHeight: 56 }}>
            {course.description}
          </div>

          <div className="subhead">{T.panels.generalObjective}</div>
          <div className="textbox" style={{ minHeight: 56 }}>
            {course.generalObjective}
          </div>

          <div className="subhead">{T.panels.detailedObjectives}</div>
          <div className="textbox" style={{ minHeight: 318 }}>
            <p>أولاً: الأهداف المعرفية:</p>
            <p>أن يكون المتدرب قادراً على:</p>
            {course.objectives.knowledge.map((line, i) => (
              <p key={line}>{`${i + 1}. ${line}`}</p>
            ))}
            <div className="gap" />
            <p>ثانياً: الأهداف الإجرائية:</p>
            <p>أن يكون المتدرب قادراً على:</p>
            {course.objectives.procedural.map((line, i) => (
              <p key={line}>{`${i + 1}. ${line}`}</p>
            ))}
          </div>
        </Panel>
      </Page>

      {/* ═════════ ٣ — متطلبات التدريب ═════════ */}
      <Page>
        <DocHeader college={department.college} />

        <Panel title={T.panels.requirements}>
          <div className="subhead" style={{ marginTop: 2 }}>
            {T.panels.equipment}
          </div>
          <div className="textbox" style={{ minHeight: 236 }}>
            {edit ? (
              <>
                <p>
                  الموارد:{' '}
                  <textarea
                    className="cell-edit obj-edit"
                    rows={3}
                    value={course.resources}
                    title="الموارد النظرية العامة — نص حر"
                    onChange={(e) => edit.setResources(e.target.value)}
                  />
                </p>
                <p>{T.panels.equipment}: (بند في كل سطر)</p>
                <textarea
                  className="cell-edit obj-edit"
                  rows={Math.max(course.equipment.length + 1, 4)}
                  value={course.equipment.join('\n')}
                  title="تجهيزات المقرر — بند في كل سطر"
                  onChange={(e) => edit.setEquipment(e.target.value)}
                />
              </>
            ) : (
              <>
                <p>الموارد: {course.resources}</p>
                <div className="gap" />
                <p>{T.panels.equipment}:</p>
                {course.equipment.map((item, i) => (
                  <p key={item}>{`${i + 1}) ${item}`}</p>
                ))}
              </>
            )}
          </div>

          <div className="subhead">{T.panels.safety}</div>
          <div className="textbox" style={{ minHeight: 400 }}>
            {edit ? (
              <textarea
                className="cell-edit obj-edit"
                rows={safety.length + 1}
                value={safety.join('\n')}
                title="تعليمات السلامة — سطر لكل بند؛ إفراغها كلها يعيد النص الموحّد للقسم"
                onChange={(e) => edit.setSafety(e.target.value)}
              />
            ) : (
              safety.map((line) => <p key={line}>{line}</p>)
            )}
          </div>
        </Panel>
      </Page>

      {/* ═════════ ٤ و ٥ — الخطة التدريبية ═════════ */}
      <Page>
        <DocHeader college={department.college} />
        <Panel title={T.panels.plan} bodyStyle={{ padding: 10 }}>
          <PlanTable weeks={course.plan.slice(0, planSplit)} />
        </Panel>
      </Page>

      <Page>
        <DocHeader college={department.college} />
        <Panel title={T.panels.plan} bodyStyle={{ padding: 10 }}>
          <PlanTable weeks={course.plan.slice(planSplit)} offset={planSplit} />

          <div className="totals">
            <div className="cellrow">
              <div className="t">مجموع درجات التقييمات من ( {course.declaredTotalGrades} ) درجة</div>
              <div className="n">{course.declaredTotalGrades}</div>
            </div>
            <div className="cellrow">
              <div className="t">
                مجموع ساعات التدريب الفصلية من ( {course.declaredTotalHours} ) ساعة
              </div>
              <div className="n">{course.declaredTotalHours}</div>
            </div>
          </div>

          <div className="grades">
            <div className="gbox red">
              <TrainingMethodsNotice />
            </div>
            <GradeBox
              caption={`درجة الأعمال الفصلية من ( ${department.gradeScale.coursework} ) درجة`}
              value={department.gradeScale.coursework}
            />
            <GradeBox
              caption={`درجة الاختبار النهائي من ( ${department.gradeScale.finalExam} ) درجة`}
              value={department.gradeScale.finalExam}
            />
            <GradeBox
              caption={`مجموع الدرجات من ( ${department.gradeScale.total} ) درجة`}
              value={department.gradeScale.total}
            />
          </div>
        </Panel>
      </Page>

      {/* ═════════ ٦ — المراجع والتقييم والتوقيع ═════════ */}
      <Page>
        <DocHeader college={department.college} />

        <Panel title={T.panels.references}>
          <ReferencesGrid references={course.references} />
        </Panel>

        <Panel title={T.panels.quality}>
          <div className="grid3">
            <div className="h">{T.qualityEvaluation.columns.area}</div>
            <div className="h">{T.qualityEvaluation.columns.evaluators}</div>
            <div className="h">{T.qualityEvaluation.columns.link}</div>
            {T.qualityEvaluation.rows.map((row) => (
              <ThreeCells key={row.link} a={row.area} b={row.evaluators} c={row.link} />
            ))}
          </div>
        </Panel>

        <Panel title={T.panels.links}>
          <div className="links">
            {T.importantLinks.map((label) => (
              <div className="lk" key={label}>
                {label}
              </div>
            ))}
          </div>
        </Panel>

        <div className="sign">
          <SignRow
            label={T.signatureLabels.courseTrainer}
            name={trainer.name}
            email={trainer.email}
            date={signedAt}
          />
          <SignRow
            label={T.signatureLabels.headOfDepartment}
            name={department.headOfDepartment.name}
            email={department.headOfDepartment.email}
            date={signedAt}
          />
        </div>

        <div className="foot">
          <div className="em">{T.footer.email}</div>
          <div>
            {T.edition} &nbsp;-&nbsp; {T.editionDate}
          </div>
          <div>{T.footer.authority}</div>
        </div>
        <div className="footnote">{T.footer.note}</div>
      </Page>
    </div>
  );
}

function GradeBox({ caption, value }: { caption: string; value: number }) {
  return (
    <div className="gbox">
      <div className="cap">{caption}</div>
      <div className="row">
        <div className="b">{value}</div>
        <div className="mid">من</div>
        <div className="b">{value}</div>
      </div>
    </div>
  );
}

function ThreeCells({ a, b, c }: { a: string; b: string; c: string }) {
  return (
    <>
      <div className="c">{a}</div>
      <div className="c">{b}</div>
      <div className="c">{c}</div>
    </>
  );
}

/**
 * شبكة المراجع: عرضٌ صرف افتراضاً، وحقول (عنوان + رابط) في وضع التحرير.
 * الروابط تُعرض نصاً في الوثيقة المطبوعة وتبقى في الملف للنسخة التفاعلية.
 */
function ReferencesGrid({ references }: { references: Course['references'] }) {
  const edit = useDocumentEdit();
  return (
    <div className="grid3">
      <div className="h">{T.referenceColumns.main}</div>
      <div className="h">{T.referenceColumns.sites}</div>
      <div className="h">{T.referenceColumns.platforms}</div>
      {references.map((row, i) =>
        edit ? (
          <Fragment key={i}>
            <div className="c refedit">
              <input value={row.main} placeholder="العنوان الظاهر"
                onChange={(e) => edit.setReference(i, 'main', e.target.value)} />
              <input className="ltr" value={row.mainUrl ?? ''} placeholder="https://…"
                onChange={(e) => edit.setReference(i, 'mainUrl', e.target.value)} />
            </div>
            <div className="c refedit">
              <input value={row.site} placeholder="العنوان الظاهر"
                onChange={(e) => edit.setReference(i, 'site', e.target.value)} />
              <input className="ltr" value={row.siteUrl ?? ''} placeholder="https://…"
                onChange={(e) => edit.setReference(i, 'siteUrl', e.target.value)} />
            </div>
            <div className="c refedit">
              <input value={row.platform} placeholder="العنوان الظاهر"
                onChange={(e) => edit.setReference(i, 'platform', e.target.value)} />
              <input className="ltr" value={row.platformUrl ?? ''} placeholder="https://…"
                onChange={(e) => edit.setReference(i, 'platformUrl', e.target.value)} />
              <button type="button" className="ref-del" title="حذف هذا الصف"
                onClick={() => edit.removeReference(i)}>حذف الصف</button>
            </div>
          </Fragment>
        ) : (
          <RefRow key={i} row={row} />
        ),
      )}
      {edit && (
        <button type="button" className="ref-add" title="إضافة صف مراجع جديد"
          onClick={() => edit.addReference()}>+ صف جديد</button>
      )}
    </div>
  );
}

/**
 * تنويه طرق ووسائل التدريب: النص كما في النموذج المعتمد حرفياً، و«اضغط
 * هنا» وحدها رابطٌ لأدلة المؤسسة الإجرائية.
 */
function TrainingMethodsNotice() {
  const [before, after] = T.trainingMethodsNotice.split(T.trainingMethodsLinkText);
  return (
    <span>
      {before}
      <a
        href={T.trainingMethodsUrl}
        target="_blank"
        rel="noreferrer noopener"
        title="أدلة طرق ووسائل التدريب — المؤسسة العامة للتدريب التقني والمهني"
      >
        {T.trainingMethodsLinkText}
      </a>
      {after}
    </span>
  );
}

/**
 * خلية مرجع: نصٌّ ظاهر يحمل رابطه إن وُجد. العنوان العربي يبقى بمحاذاة
 * الوثيقة، وعنوان URL مكتوباً كما هو يُعرض بترتيب لاتيني كي لا ينكسر.
 */
function RefCell({ text, url, blank }: { text: string; url?: string; blank?: boolean }) {
  const isRawUrl = /^https?:/i.test(text);
  const className = `c${blank && !text ? ' blank' : ''}${isRawUrl ? ' url' : ''}`;
  return (
    <div className={className}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer noopener" title={url}>
          {text}
        </a>
      ) : (
        text
      )}
    </div>
  );
}

function RefRow({ row }: { row: Course['references'][number] }) {
  return (
    <>
      <RefCell text={row.main} url={row.mainUrl} blank />
      <RefCell text={row.site} url={row.siteUrl} />
      <RefCell text={row.platform} url={row.platformUrl} />
    </>
  );
}

function SignRow({
  label,
  name,
  email,
  date,
}: {
  label: string;
  name: string;
  email: string;
  date: string;
}) {
  return (
    <div className="signrow">
      <div className="l">{label}</div>
      <div className="v">{name}</div>
      <div className="l">{T.signatureLabels.email}</div>
      <div className="v ltr">{email}</div>
      <div className="l">{T.signatureLabels.date}</div>
      <div className="v ltr">{date}</div>
    </div>
  );
}
