import { describe, expect, it } from 'vitest';
import { readTerm, termLabel } from './term';

/**
 * تسمية الفصل كانت متناقضة بين نموذجَي التصميم (صفحةٌ تسمّي 144710
 * «الثاني» وأخرى تكتب سنةً بلا جزء). هذه الاختبارات تثبّت القاعدة في
 * موضع واحد: الخانتان الأخيرتان هما التسمية.
 */

describe('تسمية الفصل التدريبي', () => {
  it('١٠ = الأول، و٢٠ = الثاني، و٣٠ = الصيفي', () => {
    expect(termLabel('144710')).toBe('الفصل التدريبي الأول ١٤٤٧هـ');
    expect(termLabel('144720')).toBe('الفصل التدريبي الثاني ١٤٤٧هـ');
    expect(termLabel('144730')).toBe('الفصل التدريبي الصيفي ١٤٤٧هـ');
  });

  it('السنة تتغيّر مع الرمز', () => {
    expect(termLabel('144820')).toBe('الفصل التدريبي الثاني ١٤٤٨هـ');
  });

  it('الأرقام هندية لا لاتينية — اللاتينية تنعكس وسط النص العربي', () => {
    expect(termLabel('144710')).not.toMatch(/\d/);
  });

  it('يقرأ السنة والجزء منفصلين', () => {
    const info = readTerm('144730');
    expect(info.code).toBe('144730');
    expect(info.year).toBe('1447');
    expect(info.part).toBe('summer');
    expect(info.partLabel).toBe('الصيفي');
  });

  it('يقبل الأرقام الهندية ويطبّعها لاتينيةً في الرمز', () => {
    expect(readTerm('١٤٤٧١٠').code).toBe('144710');
    expect(termLabel('١٤٤٧١٠')).toBe('الفصل التدريبي الأول ١٤٤٧هـ');
  });

  it('رمزٌ لا يتبع القاعدة يُعرض كما هو بلا تخمين جزءٍ له', () => {
    const info = readTerm('144715');
    expect(info.part).toBe('unknown');
    expect(info.label).toBe('الفصل التدريبي ١٤٤٧١٥');
  });

  it('الفراغ لا يُخرج نصاً مبتوراً', () => {
    expect(termLabel('')).toBe('فصل تدريبي غير محدَّد');
    expect(readTerm('').code).toBe('');
  });
});
