import { describe, expect, it } from 'vitest';
import { readTerm, termLabel } from './term';

/**
 * تسمية الفصل كانت متناقضة بين نموذجَي التصميم، ثم اشتُقّت منه سنةٌ
 * وجزء. والمعتمد الآن (قرار المالك ٢٠٢٦-٠٨-٢٠): **الرمز كما هو**، لأن
 * الأربع الأولى سنةُ بدء العام الدراسي لا السنة الجارية — فـ`144710`
 * يقع في ١٤٤٨هـ، وكتابة «١٤٤٧هـ» تُخالف الواقع.
 *
 * السنة والجزء يبقيان مقروءَين في `readTerm` لمن احتاجهما برمجياً،
 * ولا يدخلان النص المعروض.
 */

describe('تسمية الفصل التدريبي', () => {
  it('التسمية هي الرمز نفسه بأرقام لاتينية', () => {
    expect(termLabel('144710')).toBe('الفصل التدريبي 144710');
    expect(termLabel('144720')).toBe('الفصل التدريبي 144720');
    expect(termLabel('144820')).toBe('الفصل التدريبي 144820');
  });

  it('لا تُشتق سنة هجرية معروضة — الأربع الأولى سنةُ بدء العام لا الجارية', () => {
    for (const code of ['144710', '144720', '144730', '144820']) {
      expect(termLabel(code)).not.toContain('هـ');
      expect(termLabel(code)).not.toContain('الأول');
      expect(termLabel(code)).not.toContain('الثاني');
    }
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
    expect(termLabel('١٤٤٧١٠')).toBe('الفصل التدريبي 144710');
  });

  it('رمزٌ لا يتبع القاعدة يُعرض كما هو بلا تخمين جزءٍ له', () => {
    const info = readTerm('144715');
    expect(info.part).toBe('unknown');
    expect(info.label).toBe('الفصل التدريبي 144715');
  });

  it('الفراغ لا يُخرج نصاً مبتوراً', () => {
    expect(termLabel('')).toBe('فصل تدريبي غير محدَّد');
    expect(readTerm('').code).toBe('');
  });
});
