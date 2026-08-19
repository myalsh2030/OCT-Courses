import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * حارس الطباعة.
 *
 * خلفية العطل الذي أوجب هذا الملف:
 * المتصفح عند الطباعة يقيس استعلامات `max-width` على **عرض الورقة** لا على
 * عرض النافذة. ورقة A4 = 210مم ≈ 794px، وهي أصغر من نقطة الانكسار 820px،
 * فكان تخطيط الجوال ينطبق أثناء الطباعة: تنهار شبكة الحقول إلى عمود واحد،
 * وتتمدد الصفحات من ٦ إلى ١١.
 *
 * لا يكشف هذا اختبارُ DOM لأن jsdom لا ينفّذ الطباعة، ولهذا الحارس ثابتٌ
 * على نص الأنماط نفسه: كل استعلام عرض يجب أن يكون مقيّداً بـ `screen`.
 */

const FILES = [
  { label: 'document.css', path: resolve(__dirname, 'document.css') },
  { label: 'reference.html', path: resolve(__dirname, '../test/fixtures/reference.html') },
];

/** يلتقط شرط كل كتلة @media كما هو مكتوب. */
function mediaQueries(css: string): string[] {
  return [...css.matchAll(/@media([^{]+)\{/g)].map((m) => m[1].trim());
}

describe('حارس أنماط الطباعة', () => {
  for (const file of FILES) {
    describe(file.label, () => {
      const css = readFileSync(file.path, 'utf8');
      const queries = mediaQueries(css);

      it('يحتوي كتلة @media print', () => {
        expect(queries).toContain('print');
      });

      it('كل استعلام عرض مقيّد بـ screen حتى لا ينطبق على الورقة', () => {
        const widthQueries = queries.filter((q) => /max-width|min-width/.test(q));
        expect(widthQueries.length).toBeGreaterThan(0);

        const unscoped = widthQueries.filter((q) => !/^screen\s+and\s/.test(q));
        expect(
          unscoped,
          `استعلامات عرض غير مقيّدة بـ screen ستنطبق أثناء الطباعة ` +
            `(ورقة A4 ≈ 794px) وتُفسد التخطيط: ${JSON.stringify(unscoped)}`,
        ).toEqual([]);
      });

      it('لا تُعيد قواعدُ الشاشة تعريفَ صندوق الصفحة بعد كتلة الطباعة', () => {
        // ترتيب الكتل مهم: قواعد الشاشة تأتي بعد @media print في هذا الملف،
        // فلو كانت غير مقيّدة لتغلّبت عليها. نثبّت الترتيب صراحةً.
        const printAt = css.indexOf('@media print');
        const screenAt = css.search(/@media\s+screen\s+and\s*\(\s*max-width/);
        expect(printAt).toBeGreaterThan(-1);
        expect(screenAt).toBeGreaterThan(printAt);
      });
    });
  }

  /**
   * صناديق الدرجات الثلاثة كانت تختلف: عنوانان ينكسران سطرين وثالث سطراً
   * واحداً، فيرتفع صف الأرقام في الثالث ٢١px عن جيرانه. العلاج بنيوي —
   * الصندوق عمود مرن والعنوان يبتلع الفراغ — فتستقر صفوف الأرقام في
   * مستوى واحد مهما تغيّر طول النص. jsdom لا يحسب التخطيط، فنثبّت القاعدة.
   */
  for (const file of FILES) {
    it(`${file.label}: صناديق الدرجات تضمن محاذاة صفوف الأرقام`, () => {
      const css = readFileSync(file.path, 'utf8');
      const gbox = css.match(/\.gbox\{([^}]*)\}/)?.[1] ?? '';
      const cap = css.match(/\.gbox \.cap\{([^}]*)\}/)?.[1] ?? '';

      expect(gbox, '.gbox يجب أن يكون عموداً مرناً').toContain('flex-direction:column');
      expect(cap, '.cap يجب أن يمتد ليدفع صف الأرقام للأسفل').toContain('flex:1');
    });
  }

  it('الملفان متطابقان في استعلامات الوسائط', () => {
    const [a, b] = FILES.map((f) => mediaQueries(readFileSync(f.path, 'utf8')));
    expect(a).toEqual(b);
  });

  /**
   * خلفية: document.css نُقل من النموذج المرجعي دون متغيّراته اللونية —
   * فكان `var(--steel)` غير معرّف وخلفية «روابط مهمة» شفافة بنص أبيض
   * غير مرئي. هذا الحارس يضمن أن كل متغيّر مستعمَل في أنماط الوثيقة
   * والقشرة معرّفٌ في أحد ملفات الأنماط المحمّلة.
   */
  it('كل متغيّر CSS مستعمَل معرّفٌ فعلاً', () => {
    const loaded = ['document.css', '../ui/shell.css', '../index.css']
      .map((p) => readFileSync(resolve(__dirname, p), 'utf8'))
      .join('\n');
    const used = new Set([...loaded.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
    const defined = new Set([...loaded.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const missing = [...used].filter((v) => !defined.has(v));
    expect(missing, `متغيّرات مستعملة بلا تعريف: ${missing.join(', ')}`).toEqual([]);
  });
});
