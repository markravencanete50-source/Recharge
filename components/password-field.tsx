"use client";
import { useId, useState, type ChangeEvent } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";

// A password box with an eye button, so people can check what they typed before saving or
// signing in. The value never leaves the field; showing it only changes the input type.
export function PasswordField({ label, name, autoComplete, minLength, maxLength, disabled, value, onChange }: {
  label: string; name: string; autoComplete: "current-password" | "new-password"; minLength?: number; maxLength: number; disabled?: boolean;
  value?: string; onChange?: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-control">
        <LockKeyhole aria-hidden size={17} className="auth-control-icon" />
        <input id={id} name={name} type={shown ? "text" : "password"} required autoComplete={autoComplete} minLength={minLength} maxLength={maxLength}
          disabled={disabled} spellCheck={false} autoCapitalize="none" autoCorrect="off"
          {...(onChange ? { value: value ?? "", onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value) } : {})} />
        <button type="button" className="auth-eye" aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown} aria-controls={id}
          disabled={disabled} onClick={() => setShown(value => !value)}>
          {shown ? <EyeOff aria-hidden size={18} /> : <Eye aria-hidden size={18} />}
        </button>
      </div>
    </div>
  );
}
