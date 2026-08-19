import { COLLECTIONS, COLLECTION_NAMES, DB_NAME, DB_VERSION } from './schema';
import { StorageError, type Entity, type StorageAdapter } from './types';

/** يلفّ IDBRequest في Promise ويحوّل أخطاءه إلى StorageError. */
function promisify<T>(request: IDBRequest<T>, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new StorageError(what, request.error));
  });
}

export class IndexedDbAdapter implements StorageAdapter {
  private db: IDBDatabase | null = null;
  private readonly dbName: string;
  private readonly version: number;

  constructor(dbName: string = DB_NAME, version: number = DB_VERSION) {
    this.dbName = dbName;
    this.version = version;
  }

  async init(): Promise<void> {
    if (this.db) return;
    if (typeof indexedDB === 'undefined') {
      throw new StorageError('IndexedDB غير متاح في هذه البيئة');
    }

    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of COLLECTION_NAMES) {
          const store = db.objectStoreNames.contains(name)
            ? request.transaction!.objectStore(name)
            : db.createObjectStore(name, { keyPath: 'id' });

          const wanted: readonly string[] = COLLECTIONS[name].indexes;
          for (const index of wanted) {
            if (!store.indexNames.contains(index)) {
              store.createIndex(index, index, { unique: false });
            }
          }
          // إزالة الفهارس التي لم تعد في المخطط، وإلا تراكمت عبر الترقيات
          // وبقيت تستهلك مساحة وتُحدَّث مع كل كتابة بلا فائدة.
          for (const existing of Array.from(store.indexNames)) {
            if (!wanted.includes(existing)) store.deleteIndex(existing);
          }
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new StorageError('تعذّر فتح المخزن', request.error));
      request.onblocked = () =>
        reject(new StorageError('المخزن محجوز من تبويب آخر — أغلق التبويبات الأخرى'));
    });
  }

  private store(collection: string, mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new StorageError('لم يُستدعَ init() قبل استخدام المخزن');
    if (!this.db.objectStoreNames.contains(collection)) {
      throw new StorageError(`مجموعة غير معرّفة: ${collection}`);
    }
    return this.db.transaction(collection, mode).objectStore(collection);
  }

  async get<T extends Entity>(collection: string, id: string): Promise<T | undefined> {
    return promisify<T | undefined>(
      this.store(collection, 'readonly').get(id),
      `تعذّرت قراءة ${id} من ${collection}`,
    );
  }

  async getAll<T extends Entity>(collection: string): Promise<T[]> {
    return promisify<T[]>(
      this.store(collection, 'readonly').getAll(),
      `تعذّرت قراءة ${collection}`,
    );
  }

  async put<T extends Entity>(collection: string, value: T): Promise<void> {
    await promisify(
      this.store(collection, 'readwrite').put(value),
      `تعذّر حفظ ${value.id} في ${collection}`,
    );
  }

  async putMany<T extends Entity>(collection: string, values: T[]): Promise<void> {
    if (values.length === 0) return;
    // معاملة واحدة للدفعة كلها: إمّا أن تُحفظ جميعاً أو لا شيء.
    const store = this.store(collection, 'readwrite');
    await new Promise<void>((resolve, reject) => {
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () =>
        reject(new StorageError(`تعذّر حفظ دفعة في ${collection}`, store.transaction.error));
      store.transaction.onabort = () =>
        reject(new StorageError(`أُجهضت دفعة ${collection}`, store.transaction.error));
      for (const value of values) store.put(value);
    });
  }

  async remove(collection: string, id: string): Promise<void> {
    await promisify(
      this.store(collection, 'readwrite').delete(id),
      `تعذّر حذف ${id} من ${collection}`,
    );
  }

  async clear(collection: string): Promise<void> {
    await promisify(this.store(collection, 'readwrite').clear(), `تعذّر تفريغ ${collection}`);
  }

  async count(collection: string): Promise<number> {
    return promisify(this.store(collection, 'readonly').count(), `تعذّر عدّ ${collection}`);
  }

  async findBy<T extends Entity>(
    collection: string,
    index: string,
    value: string | number,
  ): Promise<T[]> {
    const store = this.store(collection, 'readonly');
    if (!store.indexNames.contains(index)) {
      throw new StorageError(`فهرس غير معرّف: ${collection}.${index}`);
    }
    return promisify<T[]>(
      store.index(index).getAll(value),
      `تعذّر البحث في ${collection}.${index}`,
    );
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}
