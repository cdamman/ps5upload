import { useId } from "react";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  hint?: string;
  error?: string;
  disabled?: boolean;
  indeterminate?: boolean;
  className?: string;
}

/**
 * Tri-state checkbox for "select all" patterns. `indeterminate` is set
 * on the DOM node via a ref (React can't set it declaratively).
 *
 * Renders a native `<input type="checkbox">` + `<label>` pair with the
 * correct association; accent-color check styling lives in index.css.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  error,
  disabled = false,
  indeterminate = false,
  className = "",
}: CheckboxProps) {
  const autoId = useId();
  const cbId = autoId;
  const hintId = `${cbId}-hint`;
  const errorId = `${cbId}-error`;

  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div className={className}>
      <div className="flex items-start gap-2">
        <input
          ref={(el) => {
            if (el) el.indeterminate = indeterminate;
          }}
          id={cbId}
          type="checkbox"
          className="checkbox mt-0.5 h-5 w-5"
          checked={checked}
          disabled={disabled}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
        <div>
          <label htmlFor={cbId} className="text-sm text-[var(--color-text)]">
            {label}
          </label>
          {hint && (
            <p id={hintId} className="mt-0.5 text-xs text-[var(--color-muted)]">
              {hint}
            </p>
          )}
          {error && (
            <p id={errorId} className="mt-0.5 text-xs text-[var(--color-bad)]">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
