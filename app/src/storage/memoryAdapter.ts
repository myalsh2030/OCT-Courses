import { COLLECTIONS, COLLECTION_NAMES } from './schema';
import { StorageError, type Entity, type StorageAdapter } from './types';

/**
 * تنفيذ في الذاكرة بنفس عقد `StorageAdapter`.
 * يُستعمل كبديل حين لا يتوفر IndexedDB (وضع التصفح الخاص مثلاً)
 * وكمرجع في الاختبارات للتأكد من أن العقد نفسه لا يتغير بتغير التقنية.
 */
export class MemoryAdapter implements StorageAdapter {
  private data = new Map<string, Map<string, unknown>>();
  private ready = false;

  async init(): Promise<void> {
    for (const name of COLLECTION_NAMES) {
      if (!this.data.has(name)) this.data.set(name, new Map());
    }
    this.ready = true;
  }

  private bucket(collection: string): Map<string, unknown> {
    if (!this.ready) throw new StorageError('لم يُستدعَ init() قبل استخدام المخزن');
    const bucket = this.data.get(collection);
    if (!bucket) throw new StorageError(`مجموعة غير معرّفة: ${collection}`);
    return bucket;
  }

  async get<T extends Entity>(collection: string, id: string): Promise<T | undefined> {
    return structuredClone(this.bucket(collection).get(id)) as T | undefined;
  }

  async getAll<T extends Entity>(collection: string): Promise<T[]> {
    return structuredClone([...this.bucket(collection).values()]) as T[];
  }

  async put<T extends Entity>(collection: string, value: T): Promise<void> {
    this.bucket(collection).set(value.id, structuredClone(value));
  }

  async putMany<T extends Entity>(collection: string, values: T[]): Promise<void> {
    const bucket = this.bucket(collection);
    for (const value of values) bucket.set(value.id, structuredClone(value));
  }

  async remove(collection: string, id: string): Promise<void> {
    this.bucket(collection).delete(id);
  }

  async clear(collection: string): Promise<void> {
    this.bucket(collection).clear();
  }

  async count(collection: string): Promise<number> {
    return this.bucket(collection).size;
  }

  async findBy<T extends Entity>(
    collection: string,
    index: string,
    value: string | number,
  ): Promise<T[]> {
    const indexes = COLLECTIONS[collection as keyof typeof COLLECTIONS]?.indexes as
      | readonly string[]
      | undefined;
    if (!indexes?.includes(index)) {
      throw new StorageError(`فهرس غير معرّف: ${collection}.${index}`);
    }
    const rows = [...this.bucket(collection).values()] as Record<string, unknown>[];
    return structuredClone(rows.filter((row) => row[index] === value)) as T[];
  }

  async close(): Promise<void> {
    this.ready = false;
  }
}
