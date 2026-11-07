import { forwardRef, useId } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'min-h-touch w-full rounded-md border border-surface-border bg-white px-3 text-sm text-ink placeholder:text-ink-muted focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20 aria-[invalid=true]:border-status-red-fg',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

/** Champ avec `<label>` associé et message d'erreur accessible. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(
  ({ label, error, hint, id, ...props }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-semibold text-ink">
          {label}
        </label>
        <Input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
        {error ? (
          <span
            id={`${inputId}-error`}
            role="alert"
            className="text-xs font-medium text-status-red-fg"
          >
            {error}
          </span>
        ) : hint ? (
          <span id={`${inputId}-hint`} className="text-xs text-ink-muted">
            {hint}
          </span>
        ) : null}
      </div>
    );
  },
);
Field.displayName = 'Field';
