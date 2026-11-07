import { forwardRef, useId } from 'react';
import { cn } from '@/lib/utils';

interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

/** Liste déroulante native avec `<label>` et message d'erreur accessibles. */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  ({ label, error, hint, options, placeholder, id, className, ...props }, ref) => {
    const autoId = useId();
    const selectId = id ?? autoId;
    const describedBy = error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined;
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={selectId} className="text-sm font-semibold text-ink">
          {label}
        </label>
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'min-h-touch w-full rounded-md border border-surface-border bg-white px-3 text-sm text-ink focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20 disabled:bg-surface disabled:text-ink-muted aria-[invalid=true]:border-status-red-fg',
            className,
          )}
          {...props}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {error ? (
          <span
            id={`${selectId}-error`}
            role="alert"
            className="text-xs font-medium text-status-red-fg"
          >
            {error}
          </span>
        ) : hint ? (
          <span id={`${selectId}-hint`} className="text-xs text-ink-muted">
            {hint}
          </span>
        ) : null}
      </div>
    );
  },
);
SelectField.displayName = 'SelectField';
