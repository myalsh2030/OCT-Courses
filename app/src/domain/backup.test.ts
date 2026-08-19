import { describe, expect, it } from 'vitest';
import { backupFileName, readBackup, shortDate, specializationOf } from './backup';

/**
 * اسم ملف النسخة الاحتياطية هو ما يراه رئيس القسم في بريده قبل أن يفتحه:
 * `التخصص-رقم المدرب-الفصل-التاريخ`. تغيّره بلا قاعدة يفسد فرز مجلده.
 */

const AT = new Date(2026, 7, 19); // ١٩ أغسطس ٢٠٢٦ بالتوقيت المحلي

describe('التخصص من رموز المقررات', () => {
  it('رمزٌ واحد متكرر يعطي بادئته', () => {
    expect(specializationOf(['مصيم-141', 'مصيم-141', 'مصيم-261'])).toBe('مصيم');
  });

  it('عند التعدد تُؤخذ بادئة الأغلب', () => {
    expect(specializationOf(['مصيم-141', 'مصيم-261', 'منتج-101'])).toBe('مصيم');
  });

  it('وعند التساوي تُجمع البادئتان بـ+ بترتيب ثابت', () => {
    expect(specializationOf(['منتج-101', 'مصيم-141'])).toBe('مصيم+منتج');
    expect(specializationOf(['مصيم-141', 'منتج-101'])).toBe('مصيم+منتج');
  });

  it('رموزٌ بلا بادئة تعطي تسمية عامة لا اسماً مبتوراً', () => {
    expect(specializationOf([])).toBe('مقررات');
    expect(specializationOf(['101'])).toBe('مقررات');
  });
});

describe('التاريخ المختصر', () => {
  it('ست خانات سنة-شهر-يوم', () => {
    expect(shortDate(AT)).toBe('260819');
    expect(shortDate(new Date(2027, 0, 5))).toBe('270105');
  });
});

describe('اسم ملف النسخة', () => {
  it('التخصص فرقم المدرب فالفصل فالتاريخ', () => {
    expect(
      backupFileName({
        rayatCodes: ['مصيم-141', 'مصيم-141', 'مصيم-261'],
        trainerNo: '0013270',
        term: '144710',
        at: AT,
      }),
    ).toBe('مصيم-0013270-144710-260819.json');
  });

  it('تخصصان متساويان يظهران معاً في الاسم', () => {
    expect(
      backupFileName({
        rayatCodes: ['مصيم-141', 'منتج-101'],
        trainerNo: '0025887',
        term: '144720',
        at: AT,
      }),
    ).toBe('مصيم+منتج-0025887-144720-260819.json');
  });

  it('الفصل بأرقام هندية يُطبَّع لاتينياً في الاسم', () => {
    expect(
      backupFileName({ rayatCodes: ['مصيم-141'], trainerNo: '0013270', term: '١٤٤٧١٠', at: AT }),
    ).toBe('مصيم-0013270-144710-260819.json');
  });
});

describe('قراءة ملف مرفوع', () => {
  it('ملفٌ من نظام آخر يُرفض برسالة واضحة', () => {
    const result = readBackup({ hello: 'world' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('ليس ملف نسخة احتياطية');
  });

  it('ملفنا الناقص يُرفض بذكر موضع النقص', () => {
    const result = readBackup({ kind: 'oct-trainer-backup', formatVersion: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('تالف أو ناقص');
  });

  it('صيغةٌ أحدث لا تُقرأ بالتخمين', () => {
    const result = readBackup({
      kind: 'oct-trainer-backup',
      formatVersion: 99,
      term: '144710',
      trainerNo: '0013270',
      trainerName: 'x',
      savedAt: '2026-08-19T00:00:00.000Z',
      profile: {},
      courses: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('نسخة أحدث');
  });
});
