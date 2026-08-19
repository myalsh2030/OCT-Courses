import { IndexedDbAdapter } from './indexedDbAdapter';
import { MemoryAdapter } from './memoryAdapter';
import type { StorageAdapter } from './types';

export * from './types';
export * from './schema';
export { IndexedDbAdapter } from './indexedDbAdapter';
export { MemoryAdapter } from './memoryAdapter';

let instance: StorageAdapter | null = null;

/**
 * يعيد محوّل التخزين الوحيد للتطبيق.
 * يحاول IndexedDB أولاً، ويسقط إلى الذاكرة إن تعذّر (تصفح خاص/بيئة اختبار)
 * حتى لا تنهار الواجهة، مع تنبيه في الطرفية لأن البيانات ستضيع بإغلاق التبويب.
 */
export async function getStorage(): Promise<StorageAdapter> {
  if (instance) return instance;

  const indexedDb = new IndexedDbAdapter();
  try {
    await indexedDb.init();
    instance = indexedDb;
  } catch (error) {
    console.warn('تعذّر فتح IndexedDB — التحويل إلى تخزين مؤقت في الذاكرة.', error);
    const memory = new MemoryAdapter();
    await memory.init();
    instance = memory;
  }
  return instance;
}

/** للاختبارات فقط: يعيد ضبط المفردة بين الحالات. */
export async function resetStorage(): Promise<void> {
  await instance?.close();
  instance = null;
}
