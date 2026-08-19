import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatableCourses, generateCourse } from './generator';
import { parseCsv, parseSS01 } from './ss01';

/**
 * المحلّل يُختبر على عينة تقرير SS01 حقيقية (فصل 144620) — لا على نص
 * مُصطنع — لأن الشيطان في تفاصيل الاقتباس والتكرار والترويسة العربية.
 */

const SAMPLE = readFileSync(
  join(__dirname, '../test/fixtures/SS01.sample.csv'),
  'utf-8',
);

/** خريطة رايات ← معرّف من المقررات المولّدة نفسها (مصدر الحقيقة). */
function knownMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const code of generatableCourses()) {
    const c = generateCourse(code);
    map.set(c.rayatCode, c.id);
  }
  return map;
}

describe('محلّل CSV', () => {
  it('يراعي الحقول المقتبسة والفواصل داخلها', () => {
    const rows = parseCsv('a,"b,1",c\r\n"x""y",z,');
    expect(rows).toEqual([
      ['a', 'b,1', 'c'],
      ['x"y', 'z', ''],
    ]);
  });

  it('يقرأ العينة الحقيقية كاملة', () => {
    const rows = parseCsv(SAMPLE);
    expect(rows.length).toBeGreaterThan(500);
    expect(rows[0]).toContain('رقم المدرب');
  });
});

describe('تحليل SS01', () => {
  const result = parseSS01(SAMPLE, knownMap());

  it('ينجح ويحدد الفصل التدريبي', () => {
    expect(result.ok).toBe(true);
    expect(result.term).toBe('144620');
    expect(result.totalRows).toBeGreaterThan(500);
  });

  it('يستخرج روابط مقررات القسم التخصصية فقط (مصيم ومنتج)', () => {
    const courseIds = new Set(result.assignments.map((a) => a.courseId));
    for (const id of courseIds) expect(id).toMatch(/^MM(IN|EC)-\d{3}$/);
    // تسعة مصيم + خمسة منتج مُسندة في تقرير هذا الفصل (٢٣٣ CAD غير مسند)
    expect([...courseIds].filter((id) => id.startsWith('MMIN-'))).toHaveLength(9);
    expect([...courseIds].filter((id) => id.startsWith('MMEC-'))).toHaveLength(5);
  });

  it('المقررات متعددة المدربين تظهر برابط لكل مدرب', () => {
    const of = (courseId: string) =>
      result.assignments.filter((a) => a.courseId === courseId);
    expect(of('MMIN-151')).toHaveLength(2); // نظري + عملي
    expect(of('MMIN-252')).toHaveLength(2);
    expect(of('MMIN-261')).toHaveLength(2);
    expect(of('MMIN-141')).toHaveLength(1);
  });

  it('رابط الموائع يحمل مدربه الصحيح وشعبته', () => {
    const a = result.assignments.find((x) => x.courseId === 'MMIN-141')!;
    expect(a.trainerNo).toBe('0013270');
    expect(a.trainerName).toContain('الشبيلي');
    expect(a.sections.length).toBeGreaterThanOrEqual(1);
    expect(a.sections[0].ref).toMatch(/^\d+$/);
  });

  it('تتكرر الشعبة بصفوف لقاءات فلا تتكرر في الرابط', () => {
    for (const a of result.assignments) {
      const refs = a.sections.map((s) => s.ref);
      expect(new Set(refs).size).toBe(refs.length);
    }
  });

  it('يجمع رموز المقررات غير المعروفة دون أن تفشل العملية', () => {
    expect(result.unknownRayatCodes.length).toBeGreaterThan(0);
    expect(result.unknownRayatCodes).not.toContain('مصيم-141');
  });

  it('يرفض ملفاً ليس SS01 برسالة مفهومة', () => {
    const bad = parseSS01('اسم,عمر\nمحمد,30', knownMap());
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('SS01');
  });

  it('يرفض ملفاً فارغاً', () => {
    expect(parseSS01('', knownMap()).ok).toBe(false);
  });
});
