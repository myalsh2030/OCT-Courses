/**
 * محوّل التخزين — واجهة محايدة عن التقنية.
 *
 * الغرض: يبقى بقيّة التطبيق جاهلاً بمكان التخزين، فيمكن استبدال IndexedDB
 * بقاعدة بيانات على خادم لاحقاً بتنفيذ هذه الواجهة فقط دون لمس أي شاشة.
 * لذلك كل العمليات غير متزامنة (Promise) حتى لو كان التنفيذ الحالي محلياً.
 */

/** أي سجل مخزَّن لا بد أن يحمل معرّفاً نصياً. */
export interface Entity {
  id: string;
}

/** وصف مجموعة (يقابل object store في IndexedDB أو جدولاً في SQL). */
export interface CollectionSchema {
  /** فهارس ثانوية للبحث بغير المعرّف الأساسي. */
  indexes: readonly string[];
}

export interface StorageAdapter {
  /** يهيّئ المخزن وينشئ المجموعات إن لزم. يجب استدعاؤه قبل أي عملية. */
  init(): Promise<void>;

  get<T extends Entity>(collection: string, id: string): Promise<T | undefined>;
  getAll<T extends Entity>(collection: string): Promise<T[]>;

  /** إدراج أو تحديث (upsert). */
  put<T extends Entity>(collection: string, value: T): Promise<void>;
  putMany<T extends Entity>(collection: string, values: T[]): Promise<void>;

  remove(collection: string, id: string): Promise<void>;
  clear(collection: string): Promise<void>;
  count(collection: string): Promise<number>;

  /** بحث بفهرس ثانوي — لا بد أن يكون الفهرس معرّفاً في مخطط المجموعة. */
  findBy<T extends Entity>(
    collection: string,
    index: string,
    value: string | number,
  ): Promise<T[]>;

  close(): Promise<void>;
}

/** خطأ موحّد يرفعه أي تنفيذ للمحوّل، كي لا تتسرب أخطاء IndexedDB للواجهة. */
export class StorageError extends Error {
  readonly reason?: unknown;

  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.reason = reason;
  }
}
