import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildingFromOffice,
  DEFAULT_DEPARTMENT,
  type TrainerProfile,
} from '../domain/department';
import KNOWN_TRAINERS from '../data/trainers/known-trainers.json';
import { generateCourse } from '../domain/generator';
import { MemoryAdapter } from '../storage';
import { CourseService } from './courseService';

const SS01_SAMPLE = readFileSync(
  join(__dirname, '../test/fixtures/SS01.sample.csv'),
  'utf-8',
);

/**
 * الخدمة هي الحدّ الفاصل بين الواجهة والتخزين. تُختبر على محوّل الذاكرة —
 * نفس الواجهة التي يطبّقها IndexedDB، وسلوكهما مثبت التطابق في اختبارات
 * المحوّل نفسها.
 */

let service: CourseService;
let storage: MemoryAdapter;

beforeEach(async () => {
  storage = new MemoryAdapter();
  await storage.init();
  service = new CourseService(storage);
  await service.seed();
});

describe('الزرع والفهرس', () => {
  it('يزرع مقررات القسم الخمسة عشر ويرتّبها بالمستوى ثم المعرّف', () => {
    return service.list().then((list) => {
      expect(list).toHaveLength(15);
      expect(list[0].id).toBe('MMEC-101'); // المستوى الأول: الورشة التأسيسية
      const levels = list.map((c) => c.level);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
      expect(list.every((c) => !c.hasDraft)).toBe(true);
    });
  });

  it('الفهرس يحمل رمز الخطة (حروف عربية وأرقام لاتينية) ورمز رايات', async () => {
    const list = await service.list();
    const workshop = list.find((c) => c.id === 'MMEC-101')!;
    expect(workshop.displayCode).toBe('101 منتج');
    expect(workshop.rayatCode).toBe('منتج-101');

    const fluid = list.find((c) => c.id === 'MMIN-141')!;
    expect(fluid.displayCode).toBe('141 مصيم');
    expect(fluid.rayatCode).toBe('مصيم-141');

    // لا رمز لاتيني يظهر للمستخدم: كل رموز العرض عربية الحروف
    for (const c of list) {
      expect(c.displayCode, c.id).toMatch(/^\d{3} [؀-ۿ]+$/);
    }
  });

  it('إعادة الزرع لا تمسّ المسودّات', async () => {
    const course = structuredClone(generateCourse('MMIN 141'));
    course.description = 'وصف عدّله المدرب.';
    await service.saveDraft('MMIN-141', course);

    await service.seed(); // إقلاع جديد
    const view = await service.view('MMIN-141');
    expect(view?.draft).not.toBeNull();
    expect(view?.effective.description).toBe('وصف عدّله المدرب.');
  });
});

describe('العرض والمسودّات', () => {
  it('بلا مسودّة: الفعلي هو الأصل', async () => {
    const view = await service.view('MMIN-141');
    expect(view).not.toBeNull();
    expect(view!.draft).toBeNull();
    expect(view!.effective).toEqual(view!.original);
  });

  it('المسودّة تعلو الأصل ولا تلمسه', async () => {
    const edited = structuredClone((await service.view('MMIN-141'))!.original);
    edited.plan[0].strategies[0].text = 'دراسة الحالة';
    const result = await service.saveDraft('MMIN-141', edited);
    expect(result.ok).toBe(true);

    const view = (await service.view('MMIN-141'))!;
    expect(view.effective.plan[0].strategies[0].text).toBe('دراسة الحالة');
    expect(view.original.plan[0].strategies[0].text).not.toBe('دراسة الحالة');
    expect((await service.list()).find((c) => c.id === 'MMIN-141')!.hasDraft).toBe(true);
  });

  it('يرفض مسودّة تكسر ثابت الدرجات ولا يكتبها', async () => {
    const broken = structuredClone((await service.view('MMIN-141'))!.original);
    broken.plan[0].grades[0].value = 50; // المجموع يصير ١٤٩
    const result = await service.saveDraft('MMIN-141', broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('مجموع درجات');
    expect((await service.view('MMIN-141'))!.draft).toBeNull();
  });

  it('إسقاط المسودّة يعيد الأصل', async () => {
    const edited = structuredClone((await service.view('MMIN-141'))!.original);
    edited.generalObjective = 'هدف معدّل.';
    await service.saveDraft('MMIN-141', edited);
    await service.discardDraft('MMIN-141');

    const view = (await service.view('MMIN-141'))!;
    expect(view.draft).toBeNull();
    expect(view.effective.generalObjective).not.toBe('هدف معدّل.');
  });

  it('معرّف مجهول ⇒ null لا استثناء', async () => {
    expect(await service.view('MMIN-999')).toBeNull();
  });
});

describe('طول الفصل', () => {
  it('الافتراضي ١٩ ويُحفظ الاختيار', async () => {
    expect(await service.getSemesterLength()).toBe(19);
    await service.setSemesterLength(17);
    expect(await service.getSemesterLength()).toBe(17);
  });
});

describe('استيراد SS01 والمدربون', () => {
  it('يستورد الروابط ويحدد الفصل ويزرع ملفات المدربين', async () => {
    const result = await service.importSS01(SS01_SAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.term).toBe('144620');
    expect(result.assignmentCount).toBeGreaterThanOrEqual(9);
    expect(result.trainerCount).toBeGreaterThanOrEqual(5);

    const meta = await service.getSS01Meta();
    expect(meta?.term).toBe('144620');
  });

  it('الفهرس يُقيَّد بمقررات المدرب المختار ويُظهر أسماء المدربين', async () => {
    await service.importSS01(SS01_SAMPLE);
    const all = await service.list();
    expect(all).toHaveLength(15);
    expect(all.find((c) => c.id === 'MMIN-141')?.trainers.join(' ')).toContain('الشبيلي');

    const trainers = await service.listTrainers();
    const shubaili = trainers.find((t) => t.name.includes('الشبيلي'))!;
    const mine = await service.list(shubaili.trainerNo);
    expect(mine.map((c) => c.id)).toEqual(shubaili.courseIds.sort());
  });

  it('إعادة الاستيراد تستبدل الروابط لا تراكمها', async () => {
    await service.importSS01(SS01_SAMPLE);
    const before = (await service.listTrainers()).length;
    await service.importSS01(SS01_SAMPLE);
    expect((await service.listTrainers()).length).toBe(before);
  });

  it('يرفض ملفاً ليس SS01 برسالة', async () => {
    const result = await service.importSS01('عمود١,عمود٢\nقيمة,قيمة');
    expect(result.ok).toBe(false);
  });

  it('الأسماء تبقى كما وردت في التقرير والبريد يُكمَّل من البيانات المعتمدة', async () => {
    await service.importSS01(SS01_SAMPLE);
    const trainers = await service.listTrainers();

    const ali = trainers.find((t) => t.trainerNo === '0006169')!;
    expect(ali.name).toBe('علي العبيد'); // اسم التقرير لا الاسم الرباعي

    await service.setActiveTrainer('0006158');
    const samnan = await service.getTrainer();
    expect(samnan.name).toBe('احمد السمنان');
    expect(samnan.email).toBe('aalsmnan@tvtc.gov.sa');

    await service.setActiveTrainer('0013270');
    const shubaili = await service.getTrainer();
    expect(shubaili.name).toBe('محمد الشبيلي');
    expect(shubaili.email).toBe('myalsh@tvtc.gov.sa');
  });

  it('تشابه اسمين برقمين وظيفيين مختلفين يُفرَّق بالاسم الرباعي المعتمد', async () => {
    const csv = [
      'الفصل التدريبي,المقرر,اسم المقرر,الرقم المرجعي,نوع الشعبة,رقم المدرب,اسم المدرب',
      '144620,مصيم-151,صيانة العناصر الميكانيكية -1,14882,نظري صباحي,0006169,علي العبيد',
      '144620,مصيم-171,تقنية ورش ولحام,14891,نظري صباحي,0099999,علي العبيد',
    ].join('\n');
    expect((await service.importSS01(csv)).ok).toBe(true);

    const names = (await service.listTrainers()).map((t) => t.name);
    expect(names).toContain('علي حمد علي العبيد'); // المعتمد للمعروف
    expect(names).toContain('علي العبيد (0099999)'); // والرقم لغير المعتمد بعد

    // بطاقات المقررات تتبع نفس التفريق
    const cards = await service.list();
    expect(cards.find((c) => c.id === 'MMIN-151')?.trainers).toContain('علي حمد علي العبيد');
  });

  it('مكاتب المدربين المعتمدة تُزرع مع الرفع، والمبنى يُشتق منها', async () => {
    await service.importSS01(SS01_SAMPLE);
    const expected: Record<string, string> = {
      '0013415': '1350610108', // طلال العبيد
      '0006697': '1350630301', // عادل الفريهيدي
      '0013270': '1350610108', // محمد الشبيلي
      '0006158': '1350610108', // احمد السمنان
      '0012907': '1350610108', // اسامه السلطان
      '0006169': '1350610108', // علي العبيد
      '0000605': '1350610108', // عبدالرحمن الناصر
    };
    for (const [trainerNo, office] of Object.entries(expected)) {
      await service.setActiveTrainer(trainerNo);
      const profile = await service.getTrainer();
      expect(profile.office, trainerNo).toBe(office);
      expect(profile.building, trainerNo).toBe('06');
    }
  });

  it('رئيس القسم مخزَّن كمدرب أيضاً، فإن أُسند له مقرر ظهرت بياناته', async () => {
    const head = KNOWN_TRAINERS['0025887'];
    expect(head?.office).toBe('1350610108');
    expect(head?.email).toBe('m.alhamda@tvtc.gov.sa');
    expect(buildingFromOffice(head!.office!)).toBe('06');
    // اسمه المعتمد في كتلة رئيس القسم يبقى كما هو
    expect(DEFAULT_DEPARTMENT.headOfDepartment.email).toBe('m.alhamda@tvtc.gov.sa');
  });

  it('إعادة الاستيراد لا تمسّ ملف مدرب عدّله صاحبه', async () => {
    await service.importSS01(SS01_SAMPLE);
    await service.setActiveTrainer('0006169');
    const edited = structuredClone(await service.getTrainer());
    edited.email = 'custom@tvtc.gov.sa';
    edited.office = '123';
    await service.saveTrainer(edited);

    await service.importSS01(SS01_SAMPLE);
    const after = await service.getTrainer();
    expect(after.email).toBe('custom@tvtc.gov.sa');
    expect(after.office).toBe('123'); // مكتبه الذي أدخله لا المعتمد
  });

  it('الملف المزروع آلياً باسم قديم يستعيد اسم التقرير عند إعادة الرفع', async () => {
    await service.importSS01(SS01_SAMPLE);
    // محاكاة قاعدة قديمة زرعت الاسم الرباعي بدل اسم التقرير (بلا ختم حفظ)
    const stale = (await storage.get<TrainerProfile>('trainerProfiles', '0006169'))!;
    await storage.put('trainerProfiles', { ...stale, name: 'علي حمد علي العبيد' });

    await service.importSS01(SS01_SAMPLE);
    await service.setActiveTrainer('0006169');
    const refreshed = await service.getTrainer();
    expect(refreshed.name).toBe('علي العبيد');
    expect(refreshed.email).toBe('aalobiad@tvtc.gov.sa');
  });

  it('اختيار المدرب النشط يُحفظ ويُمسح', async () => {
    await service.importSS01(SS01_SAMPLE);
    await service.setActiveTrainer('0013270');
    expect(await service.getActiveTrainerNo()).toBe('0013270');
    expect((await service.getTrainer()).trainerNo).toBe('0013270');
    await service.setActiveTrainer(null);
    expect(await service.getActiveTrainerNo()).toBeNull();
  });
});

describe('الإصدارات: تصدير ورفع ورجوع', () => {
  async function exportEdited(description: string) {
    const edited = structuredClone((await service.view('MMIN-141'))!.original);
    edited.description = description;
    await service.saveDraft('MMIN-141', edited);
    const exported = await service.exportVersionFile('MMIN-141');
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw new Error('unreachable');
    return exported;
  }

  it('التصدير يحمل مسودّة المدرب وتوقيعه واسم ملف مقترحاً', async () => {
    const exported = await exportEdited('وصف للإصدار الأول.');
    expect(exported.file.kind).toBe('tvtc-course-version');
    expect((exported.file.course as { description: string }).description).toBe(
      'وصف للإصدار الأول.',
    );
    expect(exported.file.author.trainerNo).toMatch(/^\d{7}$/);
    expect(exported.suggestedName).toMatch(/^MMIN-141_\d{7}_\d{8}\.json$/);
  });

  it('الرفع يصير الإصدار المعتمد المعروض افتراضاً', async () => {
    const exported = await exportEdited('وصف معتمد مرفوع.');
    await service.discardDraft('MMIN-141'); // كأن الرفع على جهاز آخر
    const imported = await service.importVersionFile(exported.file);
    expect(imported.ok).toBe(true);

    const view = (await service.view('MMIN-141'))!;
    expect(view.effectiveSource).toBe('version');
    expect(view.effective.description).toBe('وصف معتمد مرفوع.');
    expect(view.versions).toHaveLength(1);
    expect(view.original.description).not.toBe('وصف معتمد مرفوع.');
  });

  it('الأحدث يعلو، والرجوع للأصل أو لإصدار وسيط ثم العودة للأحدث', async () => {
    const v1 = await exportEdited('الإصدار الأول.');
    await service.discardDraft('MMIN-141');
    await service.importVersionFile(v1.file);
    const v2 = await exportEdited('الإصدار الثاني.');
    await service.discardDraft('MMIN-141');
    await service.importVersionFile(v2.file);

    let view = (await service.view('MMIN-141'))!;
    expect(view.versions).toHaveLength(2);
    expect(view.effective.description).toBe('الإصدار الثاني.');

    await service.setDefaultVersion('MMIN-141', 1);
    view = (await service.view('MMIN-141'))!;
    expect(view.effective.description).toBe('الإصدار الأول.');

    await service.setDefaultVersion('MMIN-141', 'original');
    view = (await service.view('MMIN-141'))!;
    expect(view.effectiveSource).toBe('original');

    await service.setDefaultVersion('MMIN-141', 'latest');
    view = (await service.view('MMIN-141'))!;
    expect(view.effective.description).toBe('الإصدار الثاني.');
  });

  it('مسودّتي المحلية تعلو الإصدار المعتمد حتى أُسقطها', async () => {
    const v1 = await exportEdited('إصدار معتمد.');
    await service.importVersionFile(v1.file); // المسودّة ما تزال قائمة
    const mine = structuredClone((await service.view('MMIN-141'))!.original);
    mine.description = 'تحريري المحلي الجاري.';
    await service.saveDraft('MMIN-141', mine);

    let view = (await service.view('MMIN-141'))!;
    expect(view.effectiveSource).toBe('draft');
    await service.discardDraft('MMIN-141');
    view = (await service.view('MMIN-141'))!;
    expect(view.effectiveSource).toBe('version');
  });

  it('يرفض غلافاً غريباً وملفَّ مقررٍ تالفاً وعدم تطابق المعرّف', async () => {
    expect((await service.importVersionFile({ kind: 'x' })).ok).toBe(false);

    const exported = await exportEdited('سليم.');
    const broken = structuredClone(exported.file);
    (broken.course as { plan: unknown }).plan = [];
    expect((await service.importVersionFile(broken)).ok).toBe(false);

    const mismatched = structuredClone(exported.file);
    mismatched.courseId = 'MMIN-151';
    const result = await service.importVersionFile(mismatched);
    expect(result.ok).toBe(false);
  });

  it('الرفع الجديد يلغي رجوعاً سابقاً (الافتراضي يعود للأحدث)', async () => {
    const v1 = await exportEdited('الأول.');
    await service.discardDraft('MMIN-141');
    await service.importVersionFile(v1.file);
    await service.setDefaultVersion('MMIN-141', 'original');
    const v2 = await exportEdited('الثاني.');
    await service.discardDraft('MMIN-141');
    await service.importVersionFile(v2.file);
    const view = (await service.view('MMIN-141'))!;
    expect(view.effective.description).toBe('الثاني.');
  });
});

describe('ملف المدرب ورئيس القسم', () => {
  it('الافتراضي هو النموذج المضمّن ثم يُحفظ التعديل ويعود', async () => {
    const trainer = await service.getTrainer();
    expect(trainer.trainerNo).toMatch(/^\d{7}$/);

    const edited = structuredClone(trainer);
    edited.name = 'م/ مدرب معدَّل';
    edited.officeHours[0].from = '09 : 00';
    const result = await service.saveTrainer(edited);
    expect(result.ok).toBe(true);

    const reloaded = await service.getTrainer();
    expect(reloaded.name).toBe('م/ مدرب معدَّل');
    expect(reloaded.officeHours[0].from).toBe('09 : 00');
  });

  it('يرفض رقم مدرب غير سباعي ولا يكتب', async () => {
    const trainer = structuredClone(await service.getTrainer());
    const originalName = trainer.name;
    trainer.trainerNo = '12';
    trainer.name = 'لن يُحفظ';
    const result = await service.saveTrainer(trainer);
    expect(result.ok).toBe(false);
    expect((await service.getTrainer()).name).toBe(originalName);
  });

  it('رئيس القسم: الافتراضي من ثابت القسم ويُحفظ التعديل', async () => {
    const head = await service.getDepartmentHead();
    expect(head.name.length).toBeGreaterThan(0);

    const edited = structuredClone(head);
    edited.email = 'head@tvtc.gov.sa';
    edited.channels.other = true;
    const result = await service.saveDepartmentHead(edited);
    expect(result.ok).toBe(true);

    const reloaded = await service.getDepartmentHead();
    expect(reloaded.email).toBe('head@tvtc.gov.sa');
    expect(reloaded.channels.other).toBe(true);
  });
});
