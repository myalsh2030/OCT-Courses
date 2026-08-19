/** معاينة سريعة لتوزيع وحدات مقرر على أسابيع الفصل. للفحص اليدوي لا للبناء. */
import { allocateUnits, buildSemester, type SemesterLength } from '../src/domain/semester';

const H = { cth: 4, l: 2, p: 2 };
const U = [
  { title: 'الخواص الفيزيائية للموائع', hours: 11 },
  { title: 'استاتيكا الموائع', hours: 14 },
  { title: 'ديناميكا الموائع', hours: 22 },
  { title: 'التدفق وهبوط الضغط في الأنابيب ومجاري الهواء', hours: 17 },
];

for (const len of [17, 19] as SemesterLength[]) {
  const s = buildSemester(H, len);
  console.log(`\n=== ${len} أسبوعاً | موزّع ${s.totalHours} من ${s.declaredHours} ===`);
  for (const a of allocateUnits(U, s, H)) {
    const w = a.week;
    const tag =
      w.kind === 'periodExam' ? `فترة${w.periodIndex}` : w.kind === 'review' ? 'مراجعة' : 'تدريس';
    const body = a.slices.map((x) => `${x.title.slice(0, 20)} (${x.hours})`).join('  +  ');
    console.log(String(w.numbers[0]).padStart(2), tag.padEnd(8), body);
  }
  for (const w of s.weeks.filter((x) => x.kind.startsWith('final'))) {
    console.log(w.numbers.join('+').padStart(2), w.kind);
  }
}
