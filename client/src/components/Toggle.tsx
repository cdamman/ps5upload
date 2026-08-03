import { useId } from "react";
import { haptic } from "../lib/haptics";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Accessible switch. Uses `<button role="switch">` semantics — switches
 * are distinct from checkboxes (they represent binary state changes,
 * not selections in a form field).
 *
 *   - 52×28px visual track + thumb
 *   - 44px hit area (WCAG 2.5.5)
 *   - Space and Enter toggle (native button behavior)
 *   - Fires haptic("selection") on change for touch users
 */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  className = "",
}: ToggleProps) {
  const autoId = useId();
  const labelId = `${autoId}-label`;
  const hintId = `${autoId}-hint`;
  const describedBy = hint ? hintId : undefined;

  const handleClick = () => {
    if (disabled) return;
    haptic("selection");
    onChange(!checked);
  };

  return (
    <div className={["flex items-center gap-3", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={handleClick}
        className={[
          "relative inline-flex h-7 w-13 shrink-0 items-center rounded-full",
          "transition-colors duration-150",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-surface-3)]",
        ].join(" ")}
        style={{ width: "3.25rem" }}
      >
        <span
          aria-hidden="true"
          className={[
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-150",
            checked ? "translate-x-6" : "translate-x-1",
          ].join(" ")}
        />
      </button>
      <div>
        <span id={labelId} className="text-sm text-[var(--color-text)]">
          {label}
        </span>
        {hint && (
          <p id={hintId} className="mt-0.5 text-xs text-[var(--color-muted)]">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
