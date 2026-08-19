import { describe, expect, it } from 'vitest';
import {
  BACKUP_STATUS_CLASS,
  BACKUP_STATUS_LABEL,
  classifyBackups,
  parseBackupText,
  type BackupStatus,
} from './adminBackups';

/**
 * كشف تضارب نسخ المدربين.
 *
 * النسخة الاحتياطية عمل فصلٍ كامل لمدرب، ودمج الخطأ منها يمحو عمله بلا
 * أن يعلم. فالثلاثة كلها تُعرض ولا تُبتلع: الأقدم، ونسخة فصلٍ آخر، ونسخة
 * مدربٍ لا شعبة له في التقرير المعروض.
 */

const HOURS = ['الأحد', 'الأثنين', 'الثلاثاء', 'الاربعاء', 'الخميس'].map((day) => ({
  day,
  from: '',
  to: '',
}));

interface FakeBackup {
  trainerNo: string;
  trainerName: string;
  term: string;
  savedAt: string;
}

/** ملف نسخة صالح بأقلّ ما يقبله `backupFileSchema` — بلا مقررات. */
function backupText({ trainerNo, trainerName, term, savedAt }: FakeBackup): string {
  return JSON.stringify({
    kind: 'oct-trainer-backup',
    formatVersion: 1,
    term,
    trainerNo,
    trainerName,
    department: 'التقنية الميكانيكية',
    specialization: 'مصيم',
    savedAt,
    profile: {
      id: `trainer-${trainerNo}`,
      trainerNo,
      name: trainerName,
      channels: { email: true, officeHours: true, whatsapp: false, other: false, otherValue: '' },
      officeHours: HOURS,
    },
    sections: [],
    courses: [],
  });
}

const SHUBAILI: FakeBackup = {
  trainerNo: '0013270',
  trainerName: 'م/ محمد الشبيلي',
  term: '144710',
  savedAt: '2026-08-19T14:10:00.000Z',
};

const CONTEXT = { term: '144710', trainerNumbers: ['0013270', '0009175'] };

function classify(files: [string, string][]) {
  return classifyBackups(
    files.map(([name, text]) => parseBackupText(name, text)),
    CONTEXT,
  );
}

describe('قراءة الملف المرفوع', () => {
  it('الملف الصالح يُقرأ بملخّصه', () => {
    const parsed = parseBackupText('نسخة.json', backupText(SHUBAILI));
    expect(parsed.error).toBe('');
    expect(parsed.file?.trainerNo).toBe('0013270');
    expect(parsed.summary?.specialization).toBe('مصيم');
  });

  it('نصٌّ ليس JSON يُرفض برسالة لا باستثناء', () => {
    expect(parseBackupText('x.json', 'ليس JSON').error).toContain('JSON');
  });

  it('ملفٌ من نظام آخر يُرفض برسالة القارئ نفسه', () => {
    expect(parseBackupText('x.json', '{"hello":1}').error).toContain('نسخة احتياطية');
  });
});

describe('حالة الدمج', () => {
  it('نسخةٌ لمدرب من مدربي الفصل المعروض: جاهزة', () => {
    const [item] = classify([['a.json', backupText(SHUBAILI)]]);
    expect(item.status).toBe('ready');
    expect(item.trainerName).toBe('م/ محمد الشبيلي');
    expect(item.term).toBe('144710');
  });

  it('نسخةٌ لفصلٍ آخر تُعرض ولا تُدمج', () => {
    const [item] = classify([['a.json', backupText({ ...SHUBAILI, term: '144620' })]]);
    expect(item.status).toBe('other-term');
    expect(item.message).toContain('الفصل التدريبي');
    expect(BACKUP_STATUS_LABEL[item.status]).toBe('فصلٌ آخر');
  });

  it('نسخةٌ لمدرب لا شعبة له في التقرير المعروض', () => {
    const [item] = classify([
      ['a.json', backupText({ ...SHUBAILI, trainerNo: '0009999', trainerName: 'م/ غريب' })],
    ]);
    expect(item.status).toBe('unknown-trainer');
    expect(item.message).toContain('لا شعبة');
  });

  it('الأصفار البادئة لا تجعل المدرب غريباً', () => {
    const [item] = classify([['a.json', backupText({ ...SHUBAILI, trainerNo: '0013270' })]]);
    expect(item.status).toBe('ready');
  });

  it('نسختان لمدرب واحد: الأحدث تُدمج والأقدم تُعلَن', () => {
    const items = classify([
      ['قديمة.json', backupText({ ...SHUBAILI, savedAt: '2026-08-18T16:00:00.000Z' })],
      ['حديثة.json', backupText(SHUBAILI)],
    ]);
    expect(items.map((i) => i.status)).toEqual(['older', 'ready']);
    expect(items[0].message).toContain('أحدث');
  });

  it('ولا فرق إن رُفعت الأحدث أولاً', () => {
    const items = classify([
      ['حديثة.json', backupText(SHUBAILI)],
      ['قديمة.json', backupText({ ...SHUBAILI, savedAt: '2026-08-18T16:00:00.000Z' })],
    ]);
    expect(items.map((i) => i.status)).toEqual(['ready', 'older']);
  });

  it('نسختان بالوقت نفسه: واحدة تُدمج لا اثنتان', () => {
    const items = classify([
      ['a.json', backupText(SHUBAILI)],
      ['b.json', backupText(SHUBAILI)],
    ]);
    expect(items.map((i) => i.status)).toEqual(['ready', 'older']);
  });

  it('مدربان مختلفان لا يتزاحمان', () => {
    const items = classify([
      ['a.json', backupText(SHUBAILI)],
      [
        'b.json',
        backupText({ ...SHUBAILI, trainerNo: '0009175', savedAt: '2026-08-01T10:00:00.000Z' }),
      ],
    ]);
    expect(items.map((i) => i.status)).toEqual(['ready', 'ready']);
  });

  it('الملف التالف يظهر في القائمة بسببه لا يختفي', () => {
    const items = classify([
      ['تالف.json', '{'],
      ['a.json', backupText(SHUBAILI)],
    ]);
    expect(items[0].status).toBe('invalid');
    expect(items[0].fileName).toBe('تالف.json');
    expect(items[0].message).not.toBe('');
    expect(items[1].status).toBe('ready');
  });

  it('قبل رفع أي تقرير لا تُتَّهم النسخة بشيء', () => {
    const items = classifyBackups([parseBackupText('a.json', backupText(SHUBAILI))], {
      term: '',
      trainerNumbers: [],
    });
    expect(items[0].status).toBe('ready');
  });
});

describe('تسميات الحالات', () => {
  it('لكل حالة تسميةٌ وصنف شارة', () => {
    const statuses: BackupStatus[] = ['ready', 'older', 'other-term', 'unknown-trainer', 'invalid'];
    for (const status of statuses) {
      expect(BACKUP_STATUS_LABEL[status]).not.toBe('');
      expect(BACKUP_STATUS_CLASS[status]).toMatch(/^(info|warning|danger)$/);
    }
  });
});
