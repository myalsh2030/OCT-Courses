import { BookOpen, CalendarDays, Check, CircleAlert, Layers, LoaderCircle, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { arabicDigits } from '../domain/vocab';
import type { TermSummary } from '../services/adminArchive';
import { stamp } from '../services/adminFormat';
import './admin.css';

/**
 * بطاقات ملخّص التقرير المعروض، ومؤشر الحفظ التلقائي.
 *
 * وحدة العدّ الشعبة لا الصف — التقرير يكرر الشعبة بصفوف لقاءاتها،
 * والملخّص يقول ذلك في تلميح كل بطاقة كي لا يُقارَن رقمٌ برقمٍ آخر
 * يعدّ شيئاً غيره.
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function Metric({
  icon,
  label,
  value,
  foot,
  highlight,
  title,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  foot: string;
  highlight?: boolean;
  title: string;
}) {
  return (
    <div className={highlight ? 'metric-card highlight' : 'metric-card'}>
      <span className="metric-label" title={title}>
        {icon}
        {label}
      </span>
      <span className="metric-value">{value}</span>
      <span className="metric-foot">{foot}</span>
    </div>
  );
}

export interface AdminSummaryProps {
  summary: TermSummary;
  /** من أين جاء المعروض: رفعٌ في هذه الجلسة أم لقطة من الأرشيف. */
  source: 'upload' | 'archive';
  fileName: string;
  savedAt: string;
}

export function AdminSummary({ summary, source, fileName, savedAt }: AdminSummaryProps) {
  return (
    <div className="admin-block">
      <h2 className="section-title">
        <BookOpen size={18} aria-hidden />
        ملخّص التقرير المعروض
      </h2>
      <p className="section-note">
        {source === 'upload' ? 'رُفع الآن من ملف ' : 'لقطة محفوظة من ملف '}
        <bdi className="file-name">{fileName}</bdi> — حُفظت {stamp(savedAt)}.
      </p>

      <div className="metrics-grid">
        <Metric
          highlight
          icon={<CalendarDays size={14} aria-hidden />}
          label="الفصل التدريبي"
          value={summary.term}
          foot={summary.termLabel}
          title="رمز الفصل كما ورد في عمود «الفصل التدريبي» بالتقرير"
        />
        <Metric
          icon={<Layers size={14} aria-hidden />}
          label="إجمالي الشعب"
          value={arabicDigits(summary.sections)}
          foot={
            summary.unassigned > 0
              ? `شعبة، منها ${arabicDigits(summary.unassigned)} بلا مدرب`
              : 'شعبة، كلّها مسندة لمدربين'
          }
          title="عدد الشعب بأرقامها المرجعية بلا تكرار — لا عدد صفوف الملف"
        />
        <Metric
          icon={<Users size={14} aria-hidden />}
          label="عدد المدربين"
          value={arabicDigits(summary.trainers)}
          foot="مدرباً مسنداً في هذا التقرير"
          title="أرقام المدربين بلا تكرار، مطبَّعةً سبع خانات"
        />
        <Metric
          icon={<BookOpen size={14} aria-hidden />}
          label="الأقسام المشمولة"
          value={arabicDigits(summary.departments.length)}
          foot={summary.departments.join('، ') || 'لا قسم مذكور في التقرير'}
          title="الأقسام الأكاديمية بأسمائها العربية كما وردت في عمود «القسم»"
        />
      </div>
    </div>
  );
}

/** مؤشر الحفظ التلقائي — لا زر حفظ في الصفحة، فالحال يُعلَن هنا. */
export function SaveBadge({ state, at, term }: { state: SaveState; at: string; term: string }) {
  if (state === 'saving') {
    return (
      <span className="save-state saving" title="تُقرأ صفوف التقرير وتُحفظ لقطته على هذا الجهاز">
        <LoaderCircle size={15} className="spin" aria-hidden />
        يُقرأ التقرير ويُحفظ…
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="save-state error" title="لم تُحفظ لقطة هذا الرفع">
        <CircleAlert size={15} aria-hidden />
        لم يُحفظ الرفع الأخير
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="save-state saved" title={`لقطة الفصل ${term} محفوظة في متصفح هذا الجهاز`}>
        <Check size={15} aria-hidden />
        حُفظت لقطة الفصل تلقائياً ({stamp(at)})
      </span>
    );
  }
  return (
    <span className="save-state" title="لا رفع في هذه الجلسة بعد">
      <Check size={15} aria-hidden />
      لا تغيير غير محفوظ
    </span>
  );
}
