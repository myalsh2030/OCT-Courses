import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
// نسخة مجمّدة مطابقة للوثيقة الورقية الأصلية — لا تُحدَّث بإعادة التوليد،
// لأن غرض هذا الاختبار إثبات أن المكوّنات تُخرج الوثيقة المرجعية حرفياً.
import courseJson from '../test/fixtures/MMIN-141.reference.json';
import trainerJson from '../data/trainers/0013270.json';
import { parseCourse } from '../domain/course.schema';
import { DEFAULT_DEPARTMENT, trainerProfileSchema } from '../domain/department';
import { FORM_TEMPLATE } from '../domain/template';
import referenceHtml from '../test/fixtures/reference.html?raw';
import { CourseDocument } from './CourseDocument';

/**
 * اختبار المطابقة مع النموذج المرجعي.
 *
 * النموذج المرجعي هو ملف HTML الذي أُقرّ تصميمه بصرياً مع المالك.
 * هذا الاختبار يقارن كل نص تُنتجه المكوّنات بنص النموذج، فيمنع أي انحراف
 * صامت في المحتوى عند تطوير المراحل التالية.
 *
 * الفرق الوحيد المقصود: سطر «لبدء سطر جديد اضغط على Alt + Enter» —
 * تعليمة خاصة بنموذج Word لا معنى لها في تطبيق ويب، فحُذفت عمداً.
 */

const WORD_ONLY_HINT = 'لبدء سطر جديد اضغط على Alt + Enter';

/** يستخلص النص المرئي من HTML بقواعد واحدة للطرفين. */
function visibleText(html: string): string {
  const body = html.includes('<body>') ? html.slice(html.indexOf('<body>')) : html;
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderDocument(): string {
  const parsed = parseCourse(courseJson);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues, null, 2));
  const trainer = trainerProfileSchema.parse(trainerJson);

  return renderToStaticMarkup(
    <CourseDocument
      course={parsed.course}
      department={DEFAULT_DEPARTMENT}
      trainer={trainer}
      signedAt="2026/01/31"
    />,
  );
}

describe('مطابقة المكوّنات للنموذج المرجعي', () => {
  it('تُنتج ست صفحات', () => {
    const markup = renderDocument();
    expect(markup.match(/class="page"/g)).toHaveLength(6);
  });

  it('تُنتج ٤٧ صفاً في جدولَي الخطة', () => {
    const markup = renderDocument();
    expect(markup.match(/<tr>/g)).toHaveLength(47 + 2); // + صفّا الرأس
  });

  it('نصّها مطابق حرفياً لنص النموذج المرجعي', () => {
    const mine = visibleText(renderDocument());
    const reference = visibleText(referenceHtml)
      .split(WORD_ONLY_HINT)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();

    // حارس ضد نجاح كاذب لو أعاد المستخلِص نصاً فارغاً للطرفين
    expect(mine.length).toBeGreaterThan(9000);
    expect(reference.length).toBeGreaterThan(9000);

    if (mine !== reference) {
      // أول موضع اختلاف مع سياقه، لأن مقارنة نصّين بطول ١١ ألف حرف بلا سياق عديمة الفائدة
      const n = Math.min(mine.length, reference.length);
      let at = n;
      for (let i = 0; i < n; i++) {
        if (mine[i] !== reference[i]) {
          at = i;
          break;
        }
      }
      throw new Error(
        `اختلاف عند الحرف ${at}:\n` +
          `المُنتَج : …${mine.slice(Math.max(0, at - 60), at + 90)}…\n` +
          `المرجعي  : …${reference.slice(Math.max(0, at - 60), at + 90)}…`,
      );
    }
    expect(mine).toBe(reference);
  });

  it('تحقن بيانات المدرب المختار لا بيانات مضمَّنة في ملف المقرر', () => {
    const markup = renderDocument();
    expect(markup).toContain('م/ محمد يوسف الشبيلي');
    expect(markup).toContain('myalsh@tvtc.gov.sa');
    expect(markup).toContain('0581163695');
    // ملف المقرر نفسه لا يحوي أياً من هذه
    expect(JSON.stringify(courseJson)).not.toContain('myalsh');
    expect(JSON.stringify(courseJson)).not.toContain('0581163695');
  });

  describe('آلية التواصل', () => {
    function renderWith(mutate: (t: ReturnType<typeof trainerProfileSchema.parse>) => void): string {
      const parsed = parseCourse(courseJson);
      if (!parsed.ok) throw new Error('fixture');
      const trainer = trainerProfileSchema.parse(trainerJson);
      mutate(trainer);
      return renderToStaticMarkup(
        <CourseDocument
          course={parsed.course}
          department={DEFAULT_DEPARTMENT}
          trainer={trainer}
          signedAt="2026/01/31"
        />,
      );
    }

    it('مكتب رئيس القسم في شريط ساعاته المكتبية مرة واحدة', () => {
      const markup = renderDocument();
      expect(markup).toContain(DEFAULT_DEPARTMENT.headOfDepartment.office);
      // بند واحد فقط، وموضعه شريط الساعات لا صف الوسائل — وضعه في الصف
      // يدفع جدول الأيام خارج عرض الورقة فيُقتطع يوم الخميس.
      expect(markup.match(/office-in-bar/g)).toHaveLength(1);
      const bar = markup.slice(markup.indexOf('office-in-bar'));
      expect(bar).toContain(DEFAULT_DEPARTMENT.headOfDepartment.office);
    });

    it('واتساب يظهر حين يُملأ رقمه', () => {
      const markup = renderWith(() => {});
      expect(markup).toContain('واتساب');
      expect(markup).toContain('0581163695');
    });

    it('واتساب يختفي كلياً حين يُترك فارغاً — الأصل الساعات والبريد', () => {
      const markup = renderWith((t) => {
        t.whatsapp = '';
      });
      expect(markup).not.toContain('واتساب');
      expect(markup).toContain('الساعات المكتبية');
      expect(markup).toContain('myalsh@tvtc.gov.sa');
    });

    it('رقم واتساب موجود مع قناة مطفأة لا يُعرض مؤشَّراً', () => {
      const markup = renderWith((t) => {
        t.channels.whatsapp = false;
      });
      const at = markup.indexOf('واتساب');
      expect(at).toBeGreaterThan(0);
      // مربع التأشير الذي يسبق «واتساب» فارغ لا يحمل علامة صح
      const before = markup.slice(Math.max(0, at - 60), at);
      expect(before).not.toContain('✓');
    });
  });

  it('«اضغط هنا» في التنويه رابطٌ فعلي لأدلة المؤسسة', () => {
    const markup = renderDocument();
    expect(markup).toContain(`href="${FORM_TEMPLATE.trainingMethodsUrl}"`);
    // النص نفسه لم يتغير — الرابط على الكلمتين فقط
    expect(markup).toContain('>اضغط هنا</a>');
  });

  it('ترث تعليمات السلامة من القسم حين يتركها المقرر فارغة', () => {
    const markup = renderDocument();
    expect(markup).toContain(DEFAULT_DEPARTMENT.safetyInstructions[0]);
    expect(markup).toContain(DEFAULT_DEPARTMENT.safetyInstructions.at(-1)!);
  });
});
