import { useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, LogIn, RefreshCw, ShieldCheck, TerminalSquare, WifiOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Backdrop } from "@/components/backdrop";
import { Mark } from "@/components/shell";
import { PasswordField, TextField, FormError } from "@/components/auth/password-field";
import { useLogin, useSetupAdmin, useChangeOwnPassword, useTeamAuth, errorMessage, passwordIssue, USERNAME_RE, type TeamAuthStatus } from "@/lib/team-auth";

function Frame({ kicker, title, sub, children, wide }: { kicker: string; title: string; sub?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <>
      <Backdrop />
      <div className="relative z-[2] flex min-h-[100dvh] items-center justify-center px-4 py-10">
        <div className={`w-full ${wide ? "max-w-lg" : "max-w-sm"} animate-in fade-in slide-in-from-bottom-2 duration-500`}>
          <div className="mb-6 flex items-center gap-3">
            <Mark />
            <div>
              <div className="font-display text-[17px] font-semibold leading-none">SPECTRE AI</div>
              <div className="mt-1 text-[10px] text-muted-foreground">Strategic Penetration &amp; Exploit Cyber Threat Response Engine</div>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-6 shadow-xl">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">{kicker}</div>
            <h1 className="font-display mt-1 text-xl font-semibold">{title}</h1>
            {sub && <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{sub}</div>}
            <div className="mt-5">{children}</div>
          </div>
          <div className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">Team workspace · authorized personnel only</div>
        </div>
      </div>
    </>
  );
}

function Submit({ pending, disabled, children, testId }: { pending: boolean; disabled?: boolean; children: ReactNode; testId: string }) {
  return (
    <button type="submit" disabled={pending || disabled} data-testid={testId}
      className="flex w-full items-center justify-center gap-2 rounded bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition-opacity disabled:opacity-40">
      {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}{children}
    </button>
  );
}

export function AuthLoading() {
  return (
    <>
      <Backdrop />
      <div className="relative z-[2] flex min-h-[100dvh] items-center justify-center" data-testid="status-auth-loading">
        <div className="w-full max-w-sm space-y-3 px-4">
          <div className="flex items-center gap-3"><Mark /><div className="h-3 w-28 animate-pulse rounded bg-muted" /></div>
          <div className="h-56 animate-pulse rounded-lg border border-border bg-card/60" />
        </div>
      </div>
    </>
  );
}

export function AuthUnavailable({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <Frame kicker="Connection" title="Sign-In Service Unavailable" sub="SPECTRE cannot confirm your session, so the workspace stays locked.">
      <div className="flex items-start gap-3 rounded border border-border bg-background/50 p-3 text-xs text-muted-foreground">
        <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><span data-testid="text-auth-unavailable">{message}</span>
      </div>
      <button onClick={onRetry} disabled={retrying} data-testid="button-auth-retry"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded border border-primary/60 px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />{retrying ? "Retrying" : "Retry"}
      </button>
    </Frame>
  );
}

export function LoginScreen() {
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const submit = (e: FormEvent) => { e.preventDefault(); if (username && password) login.mutate({ username: username.trim(), password }); };
  return (
    <Frame kicker="Team sign-in" title="Access The Workspace" sub="Use the account your SPECTRE administrator issued. There are no default credentials.">
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Username" value={username} onChange={setUsername} testId="input-login-username" autoComplete="username" maxLength={80} />
        <PasswordField label="Password" value={password} onChange={setPassword} testId="input-login-password" autoComplete="current-password" />
        <FormError message={login.isError ? errorMessage(login.error) : null} />
        <Submit pending={login.isPending} disabled={!username || !password} testId="button-login"><LogIn className="h-3.5 w-3.5" />{login.isPending ? "Signing in" : "Sign in"}</Submit>
      </form>
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">Forgot your password? Ask an administrator to issue a reset. Accounts are created by administrators only.</p>
    </Frame>
  );
}

export function SetupScreen({ status }: { status: TeamAuthStatus }) {
  const setup = useSetupAdmin();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [touched, setTouched] = useState(false);
  const uErr = username && !USERNAME_RE.test(username) ? "3-80 characters; letters, digits and . _ @ - (must start with a letter or digit)." : null;
  const dErr = displayName.trim().length > 80 ? "Up to 80 characters." : null;
  const pErr = pw || pw2 ? passwordIssue(pw, pw2) : null;
  const valid = code.length > 0 && USERNAME_RE.test(username) && displayName.trim().length >= 1 && !dErr && !passwordIssue(pw, pw2);
  const submit = (e: FormEvent) => { e.preventDefault(); setTouched(true); if (valid) setup.mutate({ setupCode: code, username: username.trim(), displayName: displayName.trim(), password: pw }); };

  if (!status.setupReady) {
    return (
      <Frame wide kicker="First-time setup" title="Setup Code Not Configured" sub="No accounts exist yet. Creating the first administrator requires a one-time setup code held as a workspace Secret.">
        <ol className="space-y-3 text-xs text-muted-foreground" data-testid="text-setup-instructions">
          <li className="flex gap-3"><span className="font-mono text-primary">01</span><span>Open the Secrets panel for this workspace and add <code className="rounded bg-muted px-1 font-mono text-foreground">SPECTRE_SETUP_CODE</code> with a random value of at least 24 characters.</span></li>
          <li className="flex gap-3"><span className="font-mono text-primary">02</span><span>Restart the API server so it reads the new Secret.</span></li>
          <li className="flex gap-3"><span className="font-mono text-primary">03</span><span>Return here and enter the code into this page only. Never paste it into chat, tickets or source code.</span></li>
        </ol>
        <div className="mt-5 flex items-center gap-2 rounded border border-accent/30 bg-accent/10 p-3 text-[11px] text-accent"><TerminalSquare className="h-4 w-4 shrink-0" />This page re-checks every 15 seconds.</div>
      </Frame>
    );
  }

  return (
    <Frame wide kicker="First-time setup" title="Create The First Administrator" sub="This form is available once, before any account exists. Further accounts are created from Settings, User Management.">
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded border border-border bg-background/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <KeyRound className="mr-1.5 inline h-3.5 w-3.5 text-primary" />Enter the value of the <code className="font-mono text-foreground">SPECTRE_SETUP_CODE</code> workspace Secret. Type it here only, never in chat.
        </div>
        <PasswordField label="Setup code" value={code} onChange={setCode} testId="input-setup-code" autoComplete="off" error={touched && !code ? "Required." : null} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Username" value={username} onChange={setUsername} testId="input-setup-username" autoComplete="username" maxLength={80} error={uErr ?? (touched && !username ? "Required." : null)} />
          <TextField label="Display name" value={displayName} onChange={setDisplayName} testId="input-setup-display-name" maxLength={80} error={dErr ?? (touched && !displayName.trim() ? "Required." : null)} />
        </div>
        <PasswordField label="Password" value={pw} onChange={setPw} testId="input-setup-password" hint="12-128 characters." />
        <PasswordField label="Confirm password" value={pw2} onChange={setPw2} testId="input-setup-password-confirm" error={pErr} />
        <FormError message={setup.isError ? errorMessage(setup.error) : null} />
        <Submit pending={setup.isPending} disabled={!valid} testId="button-setup-admin"><ShieldCheck className="h-3.5 w-3.5" />{setup.isPending ? "Creating administrator" : "Create administrator"}</Submit>
      </form>
    </Frame>
  );
}

export function ChangePasswordForm({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const change = useChangeOwnPassword();
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [done, setDone] = useState(false);
  const issue = passwordIssue(pw, pw2);
  const sameAsOld = pw.length > 0 && pw === cur ? "New password must differ from the current one." : null;
  const valid = cur.length > 0 && !issue && !sameAsOld;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    change.mutate({ currentPassword: cur, newPassword: pw }, { onSuccess: () => { setCur(""); setPw(""); setPw2(""); setDone(true); onDone?.(); } });
  };
  return (
    <form onSubmit={submit} className={compact ? "space-y-3" : "space-y-4"}>
      <PasswordField label="Current password" value={cur} onChange={(v) => { setCur(v); setDone(false); }} testId="input-current-password" autoComplete="current-password" />
      <PasswordField label="New password" value={pw} onChange={setPw} testId="input-new-password" hint="12-128 characters." error={sameAsOld} />
      <PasswordField label="Confirm new password" value={pw2} onChange={setPw2} testId="input-new-password-confirm" error={pw || pw2 ? issue : null} />
      <FormError message={change.isError ? errorMessage(change.error) : null} />
      {done && <div data-testid="text-password-changed" className="rounded border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">Password changed. Other sessions for this account were signed out.</div>}
      <Submit pending={change.isPending} disabled={!valid} testId="button-change-password"><KeyRound className="h-3.5 w-3.5" />{change.isPending ? "Updating" : "Change password"}</Submit>
    </form>
  );
}

export function ForcedChangeScreen() {
  const { user, logout, loggingOut } = useTeamAuth();
  const { toast } = useToast();
  return (
    <Frame kicker="Action required" title="Set A New Password" sub={<>Signed in as <span className="text-foreground" data-testid="text-forced-user">{user?.displayName}</span>. Your password was issued by an administrator and must be replaced before you can continue.</>}>
      <ChangePasswordForm />
      <button onClick={() => logout().catch((e) => toast({ title: "Sign Out Failed", description: `${errorMessage(e)} You are still signed in; retry.`, variant: "destructive" }))} disabled={loggingOut} data-testid="button-forced-logout" className="mt-3 w-full text-center text-[11px] text-muted-foreground hover:text-foreground">Sign out instead</button>
    </Frame>
  );
}
