import { Fragment, type ReactNode } from 'react';
import logo from '../assets/logo.png';
import type { ContactBlock, ContactChannels, OfficeHours } from '../domain/department';
import { FORM_TEMPLATE as T } from '../domain/template';

/* ───────────────────────── لبنات مشتركة ───────────────────────── */

export function Page({ children }: { children: ReactNode }) {
  return <div className="page">{children}</div>;
}

export function DocHeader({ college }: { college: string }) {
  return (
    <header className="head">
      <div className="org">
        <div className="ar">{T.organization.ar}</div>
        <div className="en">{T.organization.en}</div>
        <div className="col">{college}</div>
      </div>
      <div className="logo">
        <img src={logo} alt={`شعار ${T.organization.ar}`} />
      </div>
      <div className="doc">
        <div className="l1">{T.documentTitle.authority}</div>
        <div className="l2">{T.documentTitle.title}</div>
      </div>
    </header>
  );
}

export function Panel({
  title,
  children,
  bodyClass,
  bodyStyle,
}: {
  title: string;
  children: ReactNode;
  bodyClass?: string;
  bodyStyle?: React.CSSProperties;
}) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className={bodyClass ? `body ${bodyClass}` : 'body'} style={bodyStyle}>
        {children}
      </div>
    </section>
  );
}

/** زوج «مسمى + قيمة» داخل شريط رمادي واحد. `onEdit` يحوّل القيمة حقلَ إدخال. */
export function Field({
  label,
  value,
  side,
  ltr,
  onEdit,
}: {
  label: string;
  value: string;
  side: 'a' | 'b';
  ltr?: boolean;
  onEdit?: (v: string) => void;
}) {
  return (
    <div className={`pair ${side}`}>
      <div className="lbl">{label}</div>
      {onEdit ? (
        <div className={ltr ? 'val ltr' : 'val'}>
          <input className="cell-edit" value={value} onChange={(e) => onEdit(e.target.value)} />
        </div>
      ) : (
        <div className={ltr ? 'val ltr' : 'val'}>{value}</div>
      )}
    </div>
  );
}

/** مربع تأشير النموذج — يُملأ بعلامة صح أو يُترك فارغاً؛ `onToggle` يجعله نقرياً. */
export function CheckBox({ checked, onToggle }: { checked: boolean; onToggle?: () => void }) {
  if (onToggle) {
    return (
      <span
        className="cb cb-edit"
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        title="نقرة للتبديل"
        onClick={onToggle}
        onKeyDown={(e) => e.key === ' ' && onToggle()}
      >
        {checked ? '✓' : ' '}
      </span>
    );
  }
  return <span className="cb">{checked ? '✓' : ' '}</span>;
}

/* ───────────────────────── وسيلة التواصل ───────────────────────── */

type ContactMutator = (mutate: (contact: ContactBlock) => void) => void;

function TimeCell({ value, onEdit }: { value: string; onEdit?: (v: string) => void }) {
  if (onEdit) {
    return (
      <input
        className={value ? 'box time-edit' : 'box empty time-edit'}
        value={value}
        placeholder=":"
        title="مثال: 10 : 00"
        onChange={(e) => onEdit(e.target.value)}
      />
    );
  }
  return <div className={value ? 'box' : 'box empty'}>{value || ':'}</div>;
}

function DaySlot({
  hours,
  onEdit,
}: {
  hours: OfficeHours;
  onEdit?: (field: 'from' | 'to', v: string) => void;
}) {
  return (
    <div className="slot">
      <div className="hd">
        <span>{T.contactChannels.from}</span>
        <span>–</span>
        <span>{T.contactChannels.to}</span>
      </div>
      <div className="pair">
        <div className="hint">{T.contactChannels.hourMinuteHint}</div>
        <div className="hint">{T.contactChannels.hourMinuteHint}</div>
      </div>
      <div className="pair">
        <TimeCell value={hours.from} onEdit={onEdit && ((v) => onEdit('from', v))} />
        <TimeCell value={hours.to} onEdit={onEdit && ((v) => onEdit('to', v))} />
      </div>
    </div>
  );
}

/**
 * عنصر في صف وسائل التواصل: مربع تأشير + مسمى + قيمة بين قوسين.
 * `checked === null` يعني بنداً معلوماتياً بلا تأشيرة (رقم المكتب).
 */
function Way({
  checked,
  label,
  value,
  width,
  hint,
  onToggle,
  onValue,
}: {
  checked: boolean | null;
  label: string;
  value?: string;
  width?: 'mail' | 'num';
  hint?: string;
  onToggle?: () => void;
  onValue?: (v: string) => void;
}) {
  return (
    <div className="it" title={hint}>
      {checked !== null && <CheckBox checked={checked} onToggle={onToggle} />} {label}
      {width && (
        <>
          &nbsp;:
          <span className={`fld ${width}`}>
            <span>(</span>
            {onValue ? (
              <input
                className="v cell-edit"
                value={value ?? ''}
                onChange={(e) => onValue(e.target.value)}
              />
            ) : (
              <span className="v">{value ?? ''}</span>
            )}
            <span>)</span>
          </span>
        </>
      )}
    </div>
  );
}

export function ContactBlockView({
  contact,
  side,
  thirdChannel,
  showOffice,
  onEdit,
}: {
  contact: ContactBlock;
  side: string[];
  /** القناة الثالثة في الصف: واتساب لمدرب المقرر، «أخرى» لرئيس القسم. */
  thirdChannel: 'whatsapp' | 'other';
  /** إظهار رقم المكتب في الصف — لكتلة رئيس القسم (المدرب رقمه في صدر الوثيقة). */
  showOffice?: boolean;
  /** حضوره يجعل التأشيرات نقرية والقيم والأوقات حقولَ إدخال. */
  onEdit?: ContactMutator;
}) {
  const { channels } = contact;
  // واتساب قناة اختيارية: الأصل الساعات المكتبية والبريد، فلا تظهر في
  // الوثيقة إلا إذا كتب صاحبها رقمه (وتبقى ظاهرة في وضع التحرير ليملأها).
  const hasWhatsapp = contact.whatsapp.trim() !== '';
  const toggle = (key: keyof Omit<ContactChannels, 'otherValue'>) =>
    onEdit &&
    (() =>
      onEdit((c) => {
        c.channels[key] = !c.channels[key];
      }));

  return (
    <div className="block">
      {/* Fragment لا span: الخلية flex، وأي عنصر ملفوف يصير بنداً مستقلاً
          فتصطف الأسطر أفقياً بدل أن تتراكب. */}
      <div className="side">
        {side.map((line, i) => (
          <Fragment key={line}>
            {i > 0 && <br />}
            {line}
          </Fragment>
        ))}
      </div>

      <div className="main">
        <div className="ways">
          <Way
            checked={channels.email}
            label={T.contactChannels.email}
            value={contact.email}
            width="mail"
            onToggle={toggle('email')}
            onValue={
              onEdit &&
              ((v) =>
                onEdit((c) => {
                  c.email = v;
                }))
            }
          />
          <Way
            checked={channels.officeHours}
            label={T.contactChannels.officeHours}
            hint="التواصل حضورياً في المكتب خلال الساعات المدوّنة أدناه"
            onToggle={toggle('officeHours')}
          />
          {thirdChannel === 'whatsapp' ? (
            (hasWhatsapp || onEdit) && (
              <Way
                checked={channels.whatsapp && hasWhatsapp}
                label={T.contactChannels.whatsapp}
                value={contact.whatsapp}
                width="num"
                hint="اختياري — اترك الرقم فارغاً فلا يظهر واتساب في الوثيقة"
                onToggle={
                  onEdit && hasWhatsapp
                    ? () =>
                        onEdit((c) => {
                          c.channels.whatsapp = !c.channels.whatsapp;
                        })
                    : undefined
                }
                onValue={
                  onEdit &&
                  ((v) =>
                    onEdit((c) => {
                      c.whatsapp = v;
                      // كتابة الرقم تفعّل القناة، ومسحه يطفئها — فلا تبقى
                      // مؤشَّرة بلا رقم ولا تختفي وفيها رقم.
                      c.channels.whatsapp = v.trim() !== '';
                    }))
                }
              />
            )
          ) : (
            <Way
              checked={channels.other}
              label={T.contactChannels.other}
              value={channels.otherValue}
              width="num"
              onToggle={toggle('other')}
              onValue={
                onEdit &&
                ((v) =>
                  onEdit((c) => {
                    c.channels.otherValue = v;
                  }))
              }
            />
          )}
        </div>

        {/* رقم المكتب في شريط الساعات المكتبية لا في صف الوسائل: الصف
            الأصلي ثلاثة بنود، وبندٌ رابع فيه يدفع الجدول خارج الورقة. */}
        <div className="hours-bar">
          {T.contactChannels.officeHoursBar}
          {showOffice && (
            <span className="office-in-bar" title="رقم المكتب الذي تُقضى فيه الساعات المكتبية">
              {T.contactChannels.office}&nbsp;:
              <span className="fld num">
                <span>(</span>
                {onEdit ? (
                  <input
                    className="v cell-edit"
                    value={contact.office}
                    onChange={(e) =>
                      onEdit((c) => {
                        c.office = e.target.value;
                      })
                    }
                  />
                ) : (
                  <span className="v">{contact.office}</span>
                )}
                <span>)</span>
              </span>
            </span>
          )}
        </div>

        <div className="days">
          {contact.officeHours.map((h) => (
            <div className="day" key={h.day}>
              {h.day}
            </div>
          ))}
        </div>

        <div className="slots">
          {contact.officeHours.map((h, dayIndex) => (
            <DaySlot
              key={h.day}
              hours={h}
              onEdit={
                onEdit &&
                ((field, v) =>
                  onEdit((c) => {
                    c.officeHours[dayIndex][field] = v;
                  }))
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Strip() {
  return <div className="strip" />;
}
