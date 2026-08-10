import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white active:brightness-110 disabled:bg-line-2',
  secondary: 'bg-surface text-ink border border-line active:bg-surface-2',
  ghost: 'bg-transparent text-accent-ink active:bg-accent-soft',
  danger: 'bg-danger-soft text-danger border border-danger/20 active:brightness-95',
};

// Минимум 48px по высоте — требование доступности из docs/04-ux.md
const sizes: Record<Size, string> = {
  md: 'min-h-12 px-4 text-base',
  lg: 'min-h-14 px-6 text-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold',
        'transition-[filter,background-color] disabled:opacity-60',
        variants[variant],
        sizes[size],
        block ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
