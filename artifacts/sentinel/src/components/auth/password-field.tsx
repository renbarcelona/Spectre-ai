import { useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{children}</span>;
}

export function TextField({ label, value, onChange, testId, hint, autoComplete, maxLength, error, disabled }: {
  label: string; value: string; onChange: (v: string) => void; testId: string; hint?: string; autoComplete?: string; maxLength?: number; error?: string | null; disabled?: boolean;
}) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <input value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} autoComplete={autoComplete} maxLength={maxLength} disabled={disabled}
        className="mt-1 w-full rounded border border-input bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50" />
      {error ? <span className="mt-1 block text-[11px] text-destructive">{error}</span> : hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function PasswordField({ label, value, onChange, testId, autoComplete = "new-password", error, hint }: {
  label: string; value: string; onChange: (v: string) => void; testId: string; autoComplete?: string; error?: string | null; hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-1 flex items-center rounded border border-input bg-background/60 focus-within:border-primary">
        <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} autoComplete={autoComplete} maxLength={128}
          className="w-full bg-transparent px-3 py-2 font-mono text-sm outline-none" />
        <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} data-testid={`toggle-${testId}`}
          className="px-3 text-muted-foreground hover:text-foreground">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
      </div>
      {error ? <span className="mt-1 block text-[11px] text-destructive">{error}</span> : hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <div role="alert" data-testid="text-auth-error" className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">{message}</div>;
}
