/**
 * `sessionStorage` بسيط في الذاكرة لبيئة الاختبار (Node بلا DOM).
 *
 * جلسة المدرب تعيش في `sessionStorage`، واختبار حماية المسارات يحتاج
 * جلسةً حاضرة وأخرى غائبة — فيُركَّب المخزن هنا ويُفرَّغ بين الحالات.
 */
export function installSessionStorage(): Storage {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, String(value)),
  };
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
  return storage;
}
