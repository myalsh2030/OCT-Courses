import { describe, expect, it } from 'vitest';
import { arabicCount, COUNT_COURSES, COUNT_MISSING } from './vocab';

/**
 * عدّادات الواجهة تُكتب عربيةً سليمة لا رقماً ملصوقاً بجمع:
 * «١ نواقص» و«٢ مقررات» خطأٌ يظهر في أول شريطٍ يراه المدرب.
 */
describe('العدد بمعدوده', () => {
  it('الواحد والاثنان بلا رقم', () => {
    expect(arabicCount(1, COUNT_MISSING)).toBe('نقيصة واحدة');
    expect(arabicCount(2, COUNT_MISSING)).toBe('نقيصتان');
    expect(arabicCount(1, COUNT_COURSES)).toBe('مقرر واحد');
    expect(arabicCount(2, COUNT_COURSES)).toBe('مقرران');
  });

  it('من ثلاثة إلى عشرة: جمع قلة يسبقه العدد', () => {
    expect(arabicCount(3, COUNT_MISSING)).toBe('3 نواقص');
    expect(arabicCount(10, COUNT_COURSES)).toBe('10 مقررات');
  });

  it('أحد عشر فأكثر: تمييزٌ مفرد', () => {
    expect(arabicCount(11, COUNT_COURSES)).toBe('11 مقرراً');
    expect(arabicCount(15, COUNT_MISSING)).toBe('15 نقيصة');
  });

  it('الصفر لا يُكتب رقماً', () => {
    expect(arabicCount(0, COUNT_COURSES)).toBe('لا مقررات');
    expect(arabicCount(0, { ...COUNT_COURSES, none: 'بلا مقررات' })).toBe('بلا مقررات');
  });

  it('أرقام لاتينية في معدودات الواجهة (قرار المالك ٢٠٢٦-٠٨-٢٠)', () => {
    for (const n of [1, 2, 3, 10, 11, 25]) {
      expect(arabicCount(n, COUNT_COURSES)).not.toMatch(/[٠-٩]/);
    }
  });
});
