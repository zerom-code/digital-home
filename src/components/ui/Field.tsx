import { useId } from 'react';
import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';

const control =
  'w-full min-h-12 rounded-xl border border-line bg-surface px-4 py-3 text-base ' +
  'text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none ' +
  'focus-visible:outline-2 focus-visible:outline-accent';

interface Wrap {
  label?: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

function FieldShell({ label, hint, error, children }: Wrap) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-ink-2">
          {label}
        </label>
      )}
      {children(id, describedBy)}
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="text-sm text-ink-3">
          {hint}
        </p>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export function Input({ label, hint, error, className = '', ...rest }: InputProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {(id, describedBy) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`${control} ${className}`}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export function Textarea({ label, hint, error, className = '', rows = 3, ...rest }: TextareaProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {(id, describedBy) => (
        <textarea
          id={id}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`${control} resize-y ${className}`}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export function Select({ label, hint, error, className = '', children, ...rest }: SelectProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {(id, describedBy) => (
        <select
          id={id}
          aria-describedby={describedBy}
          className={`${control} appearance-none pr-10 ${className}`}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}
