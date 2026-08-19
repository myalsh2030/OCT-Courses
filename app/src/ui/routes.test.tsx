import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { SESSION_KEY, type TrainerSession } from '../services/session';
import { installSessionStorage } from '../test/sessionStorage';

/**
 * حماية المسارات: بلا جلسة لا تُعرض لوحة المدرب ولا وثيقة مقرر.
 *
 * تُختبر شجرة المسارات المشحونة نفسها (`AppRoutes`) لا وصفٌ مكرر لها،
 * تحت موجّه ذاكرة؛ فلو نُقل مسارٌ من تحت البوابة سقط الاختبار.
 */

const SESSION: TrainerSession = {
  term: '144710',
  trainerNo: '0013270',
  trainerName: 'محمد الشبيلي',
  department: 'التقنية الميكانيكية',
  at: '2026-08-19T10:00:00.000Z',
  record: {
    term: '144710',
    trainerNo: '0013270',
    trainerName: 'محمد الشبيلي',
    department: 'التقنية الميكانيكية',
    sections: [
      {
        rayatCode: 'مصيم-141',
        courseName: 'أساسيات ميكانيكا الموائع',
        ref: '10630',
        type: 'نظري صباحي',
        meetings: [],
        capacity: 24,
        enrolled: 20,
        remaining: 4,
      },
    ],
  },
};

function render(path: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

const PROTECTED = ['/home', '/course/MMIN-141', '/print-all'];

beforeEach(() => {
  installSessionStorage();
});

describe('بلا جلسة', () => {
  it('شاشة الدخول تُعرض على الجذر', () => {
    const html = render('/');
    expect(html).toContain('دخول إلى لوحة المدرب');
    expect(html).toContain('رقم المدرب الوظيفي');
  });

  for (const path of PROTECTED) {
    it(`لا يُعرض شيء من ${path} — يُعاد إلى الدخول`, () => {
      const html = render(path);
      expect(html).not.toContain('لوحتي');
      expect(html).not.toContain('تُحمَّل مقرراتك');
      expect(html).not.toContain('طباعة شاملة للمقررات');
    });
  }

  it('شاشة الدخول لا تكشف بيانات مدرب', () => {
    expect(render('/')).not.toContain('محمد الشبيلي');
  });
});

describe('مع جلسة', () => {
  beforeEach(() => {
    globalThis.sessionStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
  });

  it('لوحة المدرب تُعرض بقشرتها', () => {
    const html = render('/home');
    expect(html).toContain('لوحتي');
    expect(html).toContain('خروج');
    expect(html).toContain('الفصل التدريبي الأول ١٤٤٧هـ');
  });

  it('وثيقة المقرر تُعرض تحت القشرة نفسها', () => {
    expect(render('/course/MMIN-141')).toContain('لوحتي');
  });

  it('الطباعة الجماعية محميّة كذلك وتُعرض بعد الدخول', () => {
    expect(render('/print-all')).toContain('لوحتي');
  });
});

describe('مسارات أخرى', () => {
  it('صفحة الأدمن تُعرض على مسارها بأدواتها', () => {
    const html = render('/admin');
    expect(html).toContain('مركز إدارة الجداول والبيانات الأكاديمية');
    expect(html).toContain('اسحب تقرير جدول الشعب');
    expect(html).toContain('استقبال نسخ المدربين الاحتياطية');
  });

  it('صفحة الأدمن لا تعرض بيانات أحد قبل أن يرفع الأدمن تقريراً', () => {
    const html = render('/admin');
    expect(html).toContain('لا فصل معروض');
    expect(html).not.toContain('محمد الشبيلي');
    // زر إنتاج الحزمة لا يظهر بلا تقرير معروض — فلا حزمة تُبنى من فراغ
    expect(html).not.toContain('إنتاج حزمة البيانات');
  });

  it('المسار المجهول لا يعرض شيئاً من المحمي', () => {
    const html = render('/لا-يوجد');
    expect(html).not.toContain('تُحمَّل مقرراتك');
  });
});
