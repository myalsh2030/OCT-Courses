import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbAdapter } from './indexedDbAdapter';
import { MemoryAdapter } from './memoryAdapter';
import { StorageError, type StorageAdapter } from './types';

interface CourseRow {
  id: string;
  rayatCode: string;
  name: string;
}

/**
 * نفس مجموعة الاختبارات تُشغَّل على كل تنفيذ للمحوّل.
 * الهدف: إثبات أن العقد واحد، فحين نستبدل IndexedDB بقاعدة بيانات
 * يكفي تمرير التنفيذ الجديد هنا للتأكد من عدم كسر أي شاشة.
 */
const implementations: Array<[string, () => StorageAdapter]> = [
  ['MemoryAdapter', () => new MemoryAdapter()],
  // اسم قاعدة فريد لكل حالة كي لا تتداخل الاختبارات
  ['IndexedDbAdapter', () => new IndexedDbAdapter(`test-db-${Math.random().toString(36).slice(2)}`)],
];

describe.each(implementations)('%s — عقد محوّل التخزين', (_name, create) => {
  let storage: StorageAdapter;

  const fluids: CourseRow = { id: 'مصيم-141', rayatCode: 'مصيم-141', name: 'أساسيات ميكانيكا الموائع' };
  const welding: CourseRow = { id: 'مصيم-171', rayatCode: 'مصيم-171', name: 'تقنية ورش ولحام' };

  beforeEach(async () => {
    storage = create();
    await storage.init();
  });

  afterEach(async () => {
    await storage.close();
  });

  it('يحفظ سجلاً ويقرؤه بمعرّفه', async () => {
    await storage.put('courses', fluids);
    expect(await storage.get<CourseRow>('courses', 'مصيم-141')).toEqual(fluids);
  });

  it('يعيد undefined لمعرّف غير موجود', async () => {
    expect(await storage.get('courses', 'لا-يوجد')).toBeUndefined();
  });

  it('يحدّث السجل بنفس المعرّف بدل تكراره', async () => {
    await storage.put('courses', fluids);
    await storage.put('courses', { ...fluids, name: 'اسم معدّل' });
    expect(await storage.count('courses')).toBe(1);
    expect((await storage.get<CourseRow>('courses', 'مصيم-141'))?.name).toBe('اسم معدّل');
  });

  it('يحفظ دفعة ويقرؤها كاملة', async () => {
    await storage.putMany('courses', [fluids, welding]);
    const all = await storage.getAll<CourseRow>('courses');
    expect(all.map((c) => c.id).sort()).toEqual(['مصيم-141', 'مصيم-171']);
  });

  it('يتجاهل الدفعة الفارغة دون خطأ', async () => {
    await storage.putMany('courses', []);
    expect(await storage.count('courses')).toBe(0);
  });

  it('يحذف سجلاً ويفرّغ مجموعة', async () => {
    await storage.putMany('courses', [fluids, welding]);
    await storage.remove('courses', 'مصيم-141');
    expect(await storage.count('courses')).toBe(1);
    await storage.clear('courses');
    expect(await storage.count('courses')).toBe(0);
  });

  it('يبحث بالفهرس الثانوي', async () => {
    await storage.putMany('versions', [
      { id: 'v1', courseId: 'مصيم-141', createdAt: '2026-01-01' },
      { id: 'v2', courseId: 'مصيم-141', createdAt: '2026-02-01' },
      { id: 'v3', courseId: 'مصيم-171', createdAt: '2026-01-15' },
    ]);
    const found = await storage.findBy('versions', 'courseId', 'مصيم-141');
    expect(found.map((v) => v.id).sort()).toEqual(['v1', 'v2']);
  });

  it('يرفض مجموعة غير معرّفة', async () => {
    await expect(storage.get('collection_ghost', 'x')).rejects.toThrow(StorageError);
  });

  it('يرفض فهرساً غير معرّف', async () => {
    await expect(storage.findBy('courses', 'name', 'أي')).rejects.toThrow(StorageError);
  });

  it('يرفض العمل قبل init()', async () => {
    const fresh = create();
    await expect(fresh.get('courses', 'x')).rejects.toThrow(StorageError);
  });

  it('يعزل المجموعات بعضها عن بعض', async () => {
    await storage.put('courses', fluids);
    await storage.put('drafts', { id: 'مصيم-141', courseId: 'مصيم-141' });
    await storage.clear('courses');
    expect(await storage.count('drafts')).toBe(1);
  });

  it('يخزّن نسخة لا مرجعاً — تعديل الكائن بعد الحفظ لا يغيّر المخزَّن', async () => {
    const mutable = { ...fluids };
    await storage.put('courses', mutable);
    mutable.name = 'تم العبث به';
    expect((await storage.get<CourseRow>('courses', 'مصيم-141'))?.name).toBe(
      'أساسيات ميكانيكا الموائع',
    );
  });

  it('يحفظ بنية متداخلة كما هي (خطة ١٩ أسبوعاً)', async () => {
    const nested = {
      id: 'مصيم-141',
      weeks: [
        { no: 1, units: ['مقدمة في علم الموائع.'], hours: [2, 2, 2] },
        { no: 2, units: ['مفهوم اللزوجة'], hours: [2, 2, 2] },
      ],
    };
    await storage.put('courses', nested);
    expect(await storage.get('courses', 'مصيم-141')).toEqual(nested);
  });
});

describe('IndexedDbAdapter — الترقية', () => {
  it('يضيف الفهارس الناقصة ويحذف المهملة ويبقي البيانات', async () => {
    const dbName = `upgrade-${Math.random().toString(36).slice(2)}`;

    // إصدار قديم بمخطط مختلف: فهرس «code» الذي لم يعد مستعملاً
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('courses', { keyPath: 'id' });
        store.createIndex('code', 'code', { unique: false });
      };
      request.onsuccess = () => {
        const tx = request.result.transaction('courses', 'readwrite');
        tx.objectStore('courses').put({ id: 'MMIN-141', code: 'قديم', rayatCode: 'مصيم-141' });
        tx.oncomplete = () => {
          request.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });

    const upgraded = new IndexedDbAdapter(dbName);
    await upgraded.init();

    // البيانات القديمة باقية
    expect(await upgraded.get('courses', 'MMIN-141')).toBeDefined();
    // الفهرس الجديد يعمل
    expect(await upgraded.findBy('courses', 'rayatCode', 'مصيم-141')).toHaveLength(1);
    // الفهرس المهمل أُزيل
    await expect(upgraded.findBy('courses', 'code', 'قديم')).rejects.toThrow(StorageError);

    await upgraded.close();
  });
});

describe('IndexedDbAdapter — بقاء البيانات', () => {
  it('يستعيد البيانات بعد إغلاق الاتصال وإعادة فتحه', async () => {
    const dbName = `persist-${Math.random().toString(36).slice(2)}`;

    const first = new IndexedDbAdapter(dbName);
    await first.init();
    await first.put('courses', { id: 'مصيم-141', rayatCode: 'مصيم-141', name: 'الموائع' });
    await first.close();

    const second = new IndexedDbAdapter(dbName);
    await second.init();
    expect(await second.get<CourseRow>('courses', 'مصيم-141')).toMatchObject({ name: 'الموائع' });
    await second.close();
  });
});
