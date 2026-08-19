import { describe, expect, it } from 'vitest';
import type { ReferenceRow } from './course.schema';
import type { TrainerProfile } from './department';
import {
  applyOwnReference,
  courseCompletion,
  findMissing,
  findProfileMissing,
  hasOwnReference,
  missingSummary,
  readOwnReference,
  type CourseCheck,
} from './missing';
import { DEFAULT_REFERENCES } from './references';

/**
 * شريط «معلومات ناقصة» يعدّ ويسمّي — فحسابه هو العقد كله: بندٌ يظهر بلا
 * سبب يُفقد الشريط مصداقيته، وبندٌ لا يظهر يترك وثيقةً ناقصة تُطبع.
 */

const FULL: TrainerProfile = {
  id: '0013270',
  trainerNo: '0013270',
  name: 'محمد الشبيلي',
  email: 'myalsh@tvtc.gov.sa',
  whatsapp: '',
  building: '06',
  office: '1350610108',
  channels: { email: true, officeHours: true, whatsapp: false, other: false, otherValue: '' },
  officeHours: [
    { day: 'الأحد', from: '09 : 00', to: '10 : 00' },
    { day: 'الأثنين', from: '', to: '' },
    { day: 'الثلاثاء', from: '', to: '' },
    { day: 'الاربعاء', from: '', to: '' },
    { day: 'الخميس', from: '', to: '' },
  ],
  updatedAt: '2026-08-19T00:00:00.000Z',
};

const OWN_REFERENCE: ReferenceRow[] = [
  ...DEFAULT_REFERENCES,
  { main: 'أساسيات ميكانيكا الموائع وتطبيقاتها', site: '', platform: '' },
];

const course = (over: Partial<CourseCheck> = {}): CourseCheck => ({
  courseId: 'MMIN-141',
  rayatCode: 'مصيم-141',
  name: 'أساسيات ميكانيكا الموائع',
  hasDocument: true,
  references: OWN_REFERENCE,
  ...over,
});

describe('نواقص ملف المدرب', () => {
  it('الملف المكتمل بلا نواقص', () => {
    expect(findProfileMissing(FULL)).toEqual([]);
  });

  it('البريد الفارغ نقيصة مسمّاة', () => {
    const items = findProfileMissing({ ...FULL, email: '' });
    expect(items.map((i) => i.kind)).toContain('email');
    expect(items.find((i) => i.kind === 'email')?.label).toBe('البريد الإلكتروني الرسمي');
  });

  it('المكتب الفارغ نقيصة', () => {
    expect(findProfileMissing({ ...FULL, office: '' }).map((i) => i.kind)).toContain('office');
  });

  it('يومٌ بلا نهاية لا يُحتسب ساعاتٍ مكتبية', () => {
    const half = FULL.officeHours.map((d, i) => (i === 0 ? { ...d, to: '' } : d));
    expect(findProfileMissing({ ...FULL, officeHours: half }).map((i) => i.kind)).toContain(
      'officeHours',
    );
  });

  it('الواتساب اختياري: تركه بلا تأشير ليس نقصاً', () => {
    expect(findProfileMissing(FULL).map((i) => i.kind)).not.toContain('studentContact');
  });

  it('لكن تأشيره بلا رقم تناقضٌ يُطبع مربّعاً أمام فراغ', () => {
    const items = findProfileMissing({
      ...FULL,
      channels: { ...FULL.channels, whatsapp: true },
    });
    expect(items.map((i) => i.kind)).toContain('studentContact');
  });

  it('«وسيلة أخرى» مؤشَّرة بلا ذكرها نقيصة كذلك', () => {
    const items = findProfileMissing({
      ...FULL,
      channels: { ...FULL.channels, other: true, otherValue: '' },
    });
    expect(items.map((i) => i.kind)).toContain('studentContact');
  });

  it('ملفٌ بلا أي قناة تحمل بياناً: تظهر نقيصة الوسيلة', () => {
    const bare = findProfileMissing({
      ...FULL,
      email: '',
      officeHours: FULL.officeHours.map((d) => ({ ...d, from: '', to: '' })),
    });
    expect(bare.map((i) => i.kind)).toEqual(['email', 'officeHours', 'studentContact']);
  });
});

describe('نواقص مراجع المقررات', () => {
  it('المراجع المؤسسية العامة وحدها لا تُعدّ مرجعاً خاصاً بالمقرر', () => {
    expect(hasOwnReference(DEFAULT_REFERENCES)).toBe(false);
    const items = findMissing(FULL, [course({ references: DEFAULT_REFERENCES })]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('course:MMIN-141');
    expect(items[0].label).toBe('مراجع مقرر أساسيات ميكانيكا الموائع');
  });

  it('مرجعٌ خاص واحد يرفع النقص', () => {
    expect(hasOwnReference(OWN_REFERENCE)).toBe(true);
    expect(findMissing(FULL, [course()])).toEqual([]);
  });

  it('المقرر المسند بلا توصيف تفصيلي لا يُحاسب على مراجع لا وثيقة لها', () => {
    expect(findMissing(FULL, [course({ hasDocument: false, references: [] })])).toEqual([]);
  });
});

describe('كتابة المرجع الخاص', () => {
  it('يُضاف صفاً جديداً ولا يمسّ الصف المؤسسي المعتمد', () => {
    const rows = applyOwnReference(DEFAULT_REFERENCES, {
      main: 'كتاب المقرر',
      site: '',
      platform: '',
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].main).toBe(DEFAULT_REFERENCES[0].main);
    expect(rows[0].mainUrl).toBe(DEFAULT_REFERENCES[0].mainUrl);
    expect(rows[1].main).toBe('كتاب المقرر');
  });

  it('التعديل الثاني يُحدّث الصف نفسه ولا يكرره', () => {
    const once = applyOwnReference(DEFAULT_REFERENCES, { main: 'أ', site: '', platform: '' });
    const twice = applyOwnReference(once, { main: 'ب', site: 'موقع', platform: '' });
    expect(twice).toHaveLength(2);
    expect(twice[1]).toMatchObject({ main: 'ب', site: 'موقع' });
  });

  it('إفراغ الحقول يحذف الصف فلا يُطبع صفٌّ فارغ', () => {
    const once = applyOwnReference(DEFAULT_REFERENCES, { main: 'أ', site: '', platform: '' });
    expect(applyOwnReference(once, { main: '', site: '', platform: '' })).toHaveLength(1);
  });

  it('القراءة تعيد ما كُتب لا الصف المؤسسي', () => {
    expect(readOwnReference(DEFAULT_REFERENCES).main).toBe('');
    expect(readOwnReference(OWN_REFERENCE).main).toBe('أساسيات ميكانيكا الموائع وتطبيقاتها');
  });
});

describe('اكتمال بطاقة المقرر', () => {
  it('خمسة بنود: مراجعه وأربعةٌ من كتلة تواصله المطبوعة', () => {
    expect(courseCompletion(FULL, course())).toMatchObject({ done: 5, total: 5, percent: 100 });
  });

  it('نقصُ المراجع وحده يهبط بالنسبة إلى ٨٠٪', () => {
    const result = courseCompletion(FULL, course({ references: DEFAULT_REFERENCES }));
    expect(result.percent).toBe(80);
    expect(result.missing).toHaveLength(1);
  });

  it('المقرر بلا توصيف يُحاسب على أربعة بنود لا خمسة', () => {
    expect(courseCompletion(FULL, course({ hasDocument: false, references: [] })).total).toBe(4);
  });
});

describe('عبارة الشريط', () => {
  it('تسمّي النواقص بفواصلها وواو الأخيرة', () => {
    const items = findMissing({ ...FULL, email: '', office: '' }, [
      course({ references: DEFAULT_REFERENCES }),
    ]);
    expect(missingSummary(items)).toBe(
      'البريد الإلكتروني الرسمي، رقم المكتب، ومراجع مقرر أساسيات ميكانيكا الموائع',
    );
  });

  it('نقيصةٌ واحدة بلا فواصل', () => {
    expect(missingSummary(findProfileMissing({ ...FULL, office: '' }))).toBe('رقم المكتب');
  });

  it('لا نواقص فلا عبارة', () => {
    expect(missingSummary([])).toBe('');
  });
});
