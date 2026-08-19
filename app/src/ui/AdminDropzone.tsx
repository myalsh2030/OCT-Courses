import { useCallback, useRef, useState, type ReactNode } from 'react';
import './admin.css';

/**
 * منطقة إفلات ملفات — تُستعمل مرتين في الصفحة: لتقرير الشعب ولنسخ
 * المدربين. الإفلات وحده لا يكفي: زر استعراض صريح، والمنطقة كلها قابلة
 * للنقر، فمن لا يعرف السحب لا يقف.
 */

export interface AdminDropzoneProps {
  /** أنواع الملفات المقبولة في نافذة الاستعراض. */
  accept: string;
  multiple?: boolean;
  compact?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  title: string;
  hint: ReactNode;
  buttonLabel: string;
  buttonIcon?: ReactNode;
  onFiles: (files: File[]) => void;
}

export function AdminDropzone({
  accept,
  multiple = false,
  compact = false,
  disabled = false,
  icon,
  title,
  hint,
  buttonLabel,
  buttonIcon,
  onFiles,
}: AdminDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = useCallback(
    (list: FileList | null) => {
      const files = [...(list ?? [])];
      if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
    },
    [multiple, onFiles],
  );

  const classes = ['dropzone'];
  if (compact) classes.push('compact');
  if (over) classes.push('dragover');

  return (
    <div
      className={classes.join(' ')}
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      title={title}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (!disabled) take(event.dataTransfer.files);
      }}
    >
      <div className="dropzone-icon">{icon}</div>
      <div className="dropzone-title">{title}</div>
      <p className="dropzone-hint">{hint}</p>
      <button
        type="button"
        className="btn primary"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          input.current?.click();
        }}
      >
        {buttonIcon}
        {buttonLabel}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(event) => {
          take(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
