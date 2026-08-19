import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSS01Rows, type SS01Row } from '../domain/ss01';
import { DB_NAME, resetStorage } from '../storage';
import {
  listArchivedTerms,
  readTermSnapshot,
  saveTermSnapshot,
  summarizeRows,
  trainerNumbersOf,
} from './adminArchive';

/**
 * أرشيف الفصول على المخزن الحقيقي (IndexedDB في الاختبار).
 *
 * المسألة التي يحرسه هذا الملف: أن ما رُفع يبقى قابلاً للاسترجاع كما
 * رُفع — فعليه تقوم الفروق وإعادة بناء الحزمة. وأن العدّ **بالشعبة لا
 * بالصف**: التقرير يكرر الشعبة بصفوف لقاءاتها، فعدّ الصفوف يضاعفها.
 */

const SAMPLE = readFileSync(join(__dirname, '../test/fixtures/SS01.144710.sample.csv'), 'utf-8');
const ROWS = readSS01Rows(SAMPLE).rows;

function wipeDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await resetStorage();
  await wipeDatabase();
});

afterEach(async () => {
  await resetStorage();
});

describe('ملخّص التقرير', () => {
  const summary = summarizeRows(ROWS);

  it('الفصل بتسميته العربية لا برمزه وحده', () => {
    expect(summary.term).toBe('144710');
    expect(summary.termLabel).toBe('الفصل التدريبي 144710');
  });

  it('العدّ بالشعبة لا بالصف، والشاغرة معدودة على حدة', () => {
    expect(ROWS).toHaveLength(41);
    expect(summary.sections).toBe(36);
    expect(summary.unassigned).toBe(5);
    expect(summary.trainers).toBe(6);
  });

  it('الأقسام بأسمائها العربية مرتّبة بلا تكرار', () => {
    expect(summary.departments).toHaveLength(5);
    expect(summary.departments).toContain('التقنية الميكانيكية');
    expect(summary.departments).toEqual([...summary.departments].sort((a, b) => a.localeCompare(b, 'ar')));
  });

  it('أرقام المدربين مطبَّعة سبع خانات بلا تكرار', () => {
    const numbers = trainerNumbersOf(ROWS);
    expect(numbers).toHaveLength(6);
    expect(numbers).toContain('0013270');
    for (const no of numbers) expect(no).toMatch(/^\d{7}$/);
  });

  it('تقريرٌ فارغ لا يكسر الملخّص', () => {
    const empty = summarizeRows([]);
    expect(empty.term).toBe('');
    expect(empty.sections).toBe(0);
    expect(empty.departments).toEqual([]);
  });
});

describe('لقطة الفصل', () => {
  it('تُحفظ وتُقرأ كما رُفعت', async () => {
    const at = new Date('2026-08-20T09:30:00.000Z');
    const saved = await saveTermSnapshot(ROWS, 'SS01_135_144710.csv', at);
    expect(saved.term).toBe('144710');

    const back = await readTermSnapshot('144710');
    expect(back?.rows).toHaveLength(41);
    expect(back?.fileName).toBe('SS01_135_144710.csv');
    expect(back?.savedAt).toBe(at.toISOString());
    expect(back?.rows[0]).toEqual(ROWS[0]);
  });

  it('الرفعة الثانية للفصل نفسه تستبدل الأولى لا تُضاف إليها', async () => {
    await saveTermSnapshot(ROWS, 'قديم.csv', new Date('2026-08-20T07:00:00.000Z'));
    await saveTermSnapshot(ROWS.slice(0, 10), 'جديد.csv', new Date('2026-08-20T17:00:00.000Z'));

    const archive = await listArchivedTerms();
    expect(archive).toHaveLength(1);
    expect(archive[0].fileName).toBe('جديد.csv');

    const back = await readTermSnapshot('144710');
    expect(back?.rows).toHaveLength(10);
  });

  it('الفصل يُقرأ من التقرير لا من اسم الملف', async () => {
    const saved = await saveTermSnapshot(ROWS, 'اسمٌ-مضلِّل-144799.csv');
    expect(saved.term).toBe('144710');
  });

  it('تقريرٌ بلا رقم فصل لا يُحفظ صامتاً', async () => {
    const nameless: SS01Row[] = ROWS.map((r) => ({ ...r, term: '' }));
    await expect(saveTermSnapshot(nameless, 'x.csv')).rejects.toThrow('الفصل التدريبي');
  });

  it('فصلٌ لم يُرفع يعود null لا خطأً', async () => {
    expect(await readTermSnapshot('144620')).toBeNull();
    expect(await readTermSnapshot('')).toBeNull();
  });
});

describe('أرشيف الفصول', () => {
  it('الأحدث فصلاً أولاً مع ملخّص كل فصل', async () => {
    await saveTermSnapshot(ROWS, 'أول.csv', new Date('2026-01-01T00:00:00.000Z'));
    await saveTermSnapshot(
      ROWS.map((r) => ({ ...r, term: '144720' })),
      'ثانٍ.csv',
      new Date('2026-08-20T00:00:00.000Z'),
    );

    const archive = await listArchivedTerms();
    expect(archive.map((t) => t.term)).toEqual(['144720', '144710']);
    expect(archive[1].termLabel).toBe('الفصل التدريبي 144710');
    expect(archive[0].sections).toBe(36);
    expect(archive[0].trainers).toBe(6);
  });

  it('جهازٌ بلا رفعٍ سابق يعطي أرشيفاً فارغاً لا خطأً', async () => {
    expect(await listArchivedTerms()).toEqual([]);
  });
});
