import { describe, expect, it } from 'vitest';
import { diffBundle } from '../domain/bundle';
import type { SS01Row } from '../domain/ss01';
import { countDiff, DIFF_ORDER, DIFF_VIEW, flattenDiff, hasChanges } from './adminDiff';

/**
 * تصنيف الفروق كما تعرضه صفحة الأدمن.
 *
 * التصنيف نفسه من `domain/bundle.ts`؛ ما يُختبر هنا أن الشاشة تعرضه
 * **كاملاً وبالترتيب الصحيح**: المتغيّر أولاً والمطابق آخراً، وعدّادٌ لكل
 * حالة، وتسميةٌ ولونٌ لكل حالة بلا استثناء — فحالةٌ بلا تسمية تظهر شارةً
 * فارغة في جدولٍ يُبنى عليه قرار نشر.
 */

function row(ref: string, trainerNo: string, trainerName = 'م/ فلان'): SS01Row {
  return {
    term: '144710',
    department: 'التقنية الميكانيكية',
    rayatCode: 'مصيم-141',
    courseName: 'أساسيات ميكانيكا الموائع',
    ref,
    type: 'نظري صباحي',
    day: 'الأحد',
    time: '08:00',
    building: '06',
    room: '101',
    capacity: '24',
    enrolled: '20',
    remaining: '4',
    trainerNo: trainerNo || '-',
    trainerName: trainerNo ? trainerName : '-',
  };
}

/** رفعةٌ فيها الحالات الخمس مجتمعة. */
const PREVIOUS = [
  row('100', '0013270', 'م/ محمد'),
  row('101', ''),
  row('102', '0009175', 'م/ علي'),
  row('103', '0005527', 'م/ سعد'),
];
const NEXT = [
  row('100', '0013270', 'م/ محمد'),
  row('101', '0013270', 'م/ محمد'),
  row('102', '0012449', 'م/ خالد'),
  row('104', '0000607', 'م/ فهد'),
];

const DIFF = diffBundle(PREVIOUS, NEXT);

describe('عدّاد الحالات', () => {
  it('كل شعبة في حالةٍ واحدة، والمجموع مجموعها', () => {
    const counts = countDiff(DIFF);
    expect(counts).toMatchObject({
      added: 1,
      assigned: 1,
      changed: 1,
      removed: 1,
      same: 1,
      total: 5,
    });
  });

  it('رفعةٌ مطابقة لا تُعدّ تغييراً', () => {
    const same = diffBundle(PREVIOUS, PREVIOUS);
    expect(hasChanges(same)).toBe(false);
    expect(countDiff(same).same).toBe(4);
  });

  it('وأي فرقٍ واحد يجعلها تستحق النظر', () => {
    expect(hasChanges(DIFF)).toBe(true);
  });
});

describe('ترتيب صفوف الجدول', () => {
  it('المتغيّر أولاً والمطابق آخراً — لا ترتيب الأرقام المرجعية', () => {
    expect(flattenDiff(DIFF).map((r) => r.ref)).toEqual(['104', '101', '102', '103', '100']);
    expect(flattenDiff(DIFF).map((r) => r.change)).toEqual([
      'added',
      'assigned',
      'changed',
      'removed',
      'same',
    ]);
  });

  it('التصفية بحالة تعطي شعبها وحدها', () => {
    expect(flattenDiff(DIFF, 'changed').map((r) => r.ref)).toEqual(['102']);
    expect(flattenDiff(DIFF, 'removed')[0].previousTrainerName).toBe('م/ سعد');
    expect(flattenDiff(DIFF, 'removed')[0].trainerNo).toBe('');
    expect(flattenDiff(DIFF, 'assigned')[0].previousTrainerNo).toBe('');
  });

  it('لا شعبة تسقط من العرض ولا تتكرر فيه', () => {
    const shown = flattenDiff(DIFF).map((r) => r.ref).sort();
    expect(shown).toEqual(['100', '101', '102', '103', '104']);
  });
});

describe('تسميات الحالات', () => {
  it('لكل حالة رمزٌ وتسميةٌ وشرحٌ وصنف صف', () => {
    for (const kind of DIFF_ORDER) {
      const view = DIFF_VIEW[kind];
      expect(view.sign).not.toBe('');
      expect(view.chip).not.toBe('');
      expect(view.badge).not.toBe('');
      expect(view.title.length).toBeGreaterThan(10);
      expect(view.rowClass).toMatch(/^diff-/);
    }
  });

  it('الترتيب يشمل الحالات الخمس كلها بلا تكرار', () => {
    expect(DIFF_ORDER).toHaveLength(5);
    expect(new Set(DIFF_ORDER).size).toBe(5);
    expect(Object.keys(DIFF_VIEW).sort()).toEqual([...DIFF_ORDER].sort());
  });
});
