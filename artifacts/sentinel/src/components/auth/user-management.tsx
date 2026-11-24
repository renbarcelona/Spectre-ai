import { useState, type FormEvent } from "react";
import { Eye, KeyRound, Lock, Pencil, Power, RefreshCw, Shield, Trash2, UserPlus } from "lucide-react";
import { Panel, ErrorState } from "@/components/kit";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ChangePasswordForm } from "@/components/auth/auth-screens";
import { PasswordField, TextField, FormError, FieldLabel } from "@/components/auth/password-field";
import { useTeamAuth, useTeamAccounts, useCreateAccount, useUpdateAccount, useDeleteAccount, errorMessage, passwordIssue, USERNAME_RE, type TeamAccount, type TeamRole } from "@/lib/team-auth";

function RoleBadge({ role }: { role: TeamRole }) {
  return role === "admin"
    ? <span className="inline-flex items-center gap-1 rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary"><Shield className="h-3 w-3" />Admin</span>
    : <span className="inline-flex items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent"><Eye className="h-3 w-3" />Read-only</span>;
}

function RolePicker({ value, onChange, testId }: { value: TeamRole; onChange: (r: TeamRole) => void; testId: string }) {
  return (
    <div>
      <FieldLabel>Role</FieldLabel>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {(["readonly", "admin"] as const).map((r) => (
          <button key={r} type="button" aria-pressed={value === r} onClick={() => onChange(r)} data-testid={`${testId}-${r}`}
            className={`rounded border px-3 py-2 text-left text-xs ${value === r ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
            <div className="font-medium">{r === "admin" ? "Administrator" : "Read-only"}</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{r === "admin" ? "Full write access and account management" : "View, filter and download only"}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateAccount();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<TeamRole>("readonly");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const reset = () => { setUsername(""); setDisplayName(""); setRole("readonly"); setPw(""); setPw2(""); create.reset(); };
  const uErr = username && !USERNAME_RE.test(username) ? "3-80 characters; letters, digits and . _ @ -" : null;
  const valid = USERNAME_RE.test(username) && displayName.trim().length >= 1 && displayName.trim().length <= 80 && !passwordIssue(pw, pw2);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    create.mutate({ username: username.trim(), displayName: displayName.trim(), role, password: pw }, {
      onSuccess: (a) => { toast({ title: "Account created", description: `${a.username} must set a new password at first sign-in.` }); reset(); onOpenChange(false); },
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display">Create Team Account</DialogTitle>
          <DialogDescription>Share the temporary password through a secure channel. The user must change it at first sign-in.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Username" value={username} onChange={setUsername} testId="input-new-username" maxLength={80} error={uErr} autoComplete="off" />
            <TextField label="Display name" value={displayName} onChange={setDisplayName} testId="input-new-display-name" maxLength={80} />
          </div>
          <RolePicker value={role} onChange={setRole} testId="button-new-role" />
          <PasswordField label="Temporary password" value={pw} onChange={setPw} testId="input-new-user-password" hint="12-128 characters." />
          <PasswordField label="Confirm temporary password" value={pw2} onChange={setPw2} testId="input-new-user-password-confirm" error={pw || pw2 ? passwordIssue(pw, pw2) : null} />
          <FormError message={create.isError ? errorMessage(create.error) : null} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { reset(); onOpenChange(false); }} data-testid="button-cancel-create-user" className="rounded border border-border px-3 py-2 text-xs">Cancel</button>
            <button type="submit" disabled={!valid || create.isPending} data-testid="button-submit-create-user" className="rounded bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40">{create.isPending ? "Creating" : "Create account"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ account, onClose }: { account: TeamAccount; onClose: () => void }) {
  const update = useUpdateAccount();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(account.displayName);
  const [role, setRole] = useState<TeamRole>(account.role);
  const dirty = displayName.trim() !== account.displayName || role !== account.role;
  const valid = displayName.trim().length >= 1 && displayName.trim().length <= 80;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data: { displayName?: string; role?: TeamRole } = {};
    if (displayName.trim() !== account.displayName) data.displayName = displayName.trim();
    if (role !== account.role) data.role = role;
    update.mutate({ id: account.id, data }, { onSuccess: () => { toast({ title: "Account updated", description: role !== account.role ? "Role changed; the user's sessions were signed out." : undefined }); onClose(); } });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border-border bg-card">
        <DialogHeader><DialogTitle className="font-display">Edit Account: {account.username}</DialogTitle><DialogDescription>Role changes sign the user out of every session.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <TextField label="Display name" value={displayName} onChange={setDisplayName} testId="input-edit-display-name" maxLength={80} error={!valid ? "1-80 characters." : null} />
          <RolePicker value={role} onChange={setRole} testId="button-edit-role" />
          <FormError message={update.isError ? errorMessage(update.error) : null} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} data-testid="button-cancel-edit-user" className="rounded border border-border px-3 py-2 text-xs">Cancel</button>
            <button type="submit" disabled={!dirty || !valid || update.isPending} data-testid="button-save-edit-user" className="rounded bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40">{update.isPending ? "Saving" : "Save"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({ account, onClose }: { account: TeamAccount; onClose: () => void }) {
  const update = useUpdateAccount();
  const { toast } = useToast();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const issue = passwordIssue(pw, pw2);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (issue || !confirmed) return;
    update.mutate({ id: account.id, data: { password: pw } }, { onSuccess: () => { toast({ title: "Password reset", description: `${account.username} must choose a new password at next sign-in.` }); onClose(); } });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="border-border bg-card">
        <DialogHeader><DialogTitle className="font-display">Reset Password: {account.username}</DialogTitle><DialogDescription>All of their sessions end immediately and they must set a new password at next sign-in.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <PasswordField label="Temporary password" value={pw} onChange={setPw} testId="input-reset-password" hint="12-128 characters." />
          <PasswordField label="Confirm temporary password" value={pw2} onChange={setPw2} testId="input-reset-password-confirm" error={pw || pw2 ? issue : null} />
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="checkbox-confirm-reset" className="mt-0.5 accent-[hsl(var(--primary))]" />
            I understand this signs {account.displayName} out everywhere.
          </label>
          <FormError message={update.isError ? errorMessage(update.error) : null} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} data-testid="button-cancel-reset" className="rounded border border-border px-3 py-2 text-xs">Cancel</button>
            <button type="submit" disabled={!!issue || !confirmed || update.isPending} data-testid="button-confirm-reset" className="rounded bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-40">{update.isPending ? "Resetting" : "Reset password"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdminAccounts({ me }: { me: TeamAccount }) {
  const list = useTeamAccounts(true);
  const update = useUpdateAccount();
  const del = useDeleteAccount();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TeamAccount | null>(null);
  const [resetting, setResetting] = useState<TeamAccount | null>(null);
  const [deleting, setDeleting] = useState<TeamAccount | null>(null);
  const [toggling, setToggling] = useState<TeamAccount | null>(null);

  const accounts = list.data ?? [];
  const activeAdmins = accounts.filter((a) => a.role === "admin" && a.active).length;

  const doToggle = () => {
    if (!toggling) return;
    const a = toggling;
    update.mutate({ id: a.id, data: { active: !a.active } }, {
      onSuccess: () => toast({ title: a.active ? "Account deactivated" : "Account reactivated", description: a.active ? `${a.username} was signed out and cannot sign in.` : `${a.username} can sign in again.` }),
      onError: (e) => toast({ title: "Update failed", description: errorMessage(e), variant: "destructive" }),
    });
    setToggling(null);
  };
  const doDelete = () => {
    if (!deleting) return;
    const a = deleting;
    del.mutate(a.id, {
      onSuccess: () => toast({ title: "Account deleted", description: "Team workspace data was kept." }),
      onError: (e) => toast({ title: "Delete failed", description: errorMessage(e), variant: "destructive" }),
    });
    setDeleting(null);
  };

  return (
    <Panel kicker="Access" title="Team Accounts" bodyClass="p-0" action={
      <button onClick={() => setCreating(true)} data-testid="button-create-user" className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"><UserPlus className="h-3.5 w-3.5" />New account</button>
    }>
      {list.isLoading ? (
        <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded bg-muted/50" />)}</div>
      ) : list.isError ? (
        <div className="p-4"><ErrorState onRetry={() => list.refetch()} /></div>
      ) : (
        <ul className="divide-y divide-border/50" data-testid="list-team-accounts">
          {accounts.map((a) => {
            const self = a.id === me.id;
            const lastAdmin = a.role === "admin" && a.active && activeAdmins <= 1;
            return (
              <li key={a.id} data-testid={`row-account-${a.id}`} className={`flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center ${a.active ? "" : "opacity-60"}`}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-background/50 font-mono text-[11px] uppercase">{a.displayName.slice(0, 2)}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="truncate font-medium" data-testid={`text-account-name-${a.id}`}>{a.displayName}</span>
                      <RoleBadge role={a.role} />
                      {self && <span className="rounded-sm bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">you</span>}
                      {!a.active && <span className="rounded-sm border border-destructive/40 px-1.5 font-mono text-[10px] uppercase text-destructive">inactive</span>}
                      {a.mustChangePassword && <span className="rounded-sm border border-accent/40 px-1.5 font-mono text-[10px] text-accent">password change pending</span>}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{a.username} · created {new Date(a.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
                {self ? (
                  <span className="text-[11px] text-muted-foreground">Manage your own password below</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <IconBtn testId={`button-edit-user-${a.id}`} onClick={() => setEditing(a)} icon={Pencil} label="Edit" />
                    <IconBtn testId={`button-reset-user-${a.id}`} onClick={() => setResetting(a)} icon={KeyRound} label="Reset" />
                    <IconBtn testId={`button-toggle-user-${a.id}`} onClick={() => setToggling(a)} icon={Power} label={a.active ? "Deactivate" : "Reactivate"} disabled={lastAdmin} title={lastAdmin ? "The last active administrator cannot be deactivated" : undefined} />
                    <IconBtn testId={`button-delete-user-${a.id}`} onClick={() => setDeleting(a)} icon={Trash2} label="Delete" danger disabled={lastAdmin} title={lastAdmin ? "The last active administrator cannot be deleted" : undefined} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <CreateDialog open={creating} onOpenChange={setCreating} />
      {editing && <EditDialog account={editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetDialog account={resetting} onClose={() => setResetting(null)} />}
      <AlertDialog open={!!toggling} onOpenChange={(o) => !o && setToggling(null)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{toggling?.active ? "Deactivate Account" : "Reactivate Account"}: {toggling?.username}?</AlertDialogTitle>
            <AlertDialogDescription>{toggling?.active ? "Their sessions end immediately and they cannot sign in until reactivated." : "They will be able to sign in with their current password."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-toggle-user">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doToggle} data-testid="button-confirm-toggle-user">{toggling?.active ? "Deactivate" : "Reactivate"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent className="border-destructive/40 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Delete Account: {deleting?.username}?</AlertDialogTitle>
            <AlertDialogDescription>The account is removed permanently. Scans, findings and other team workspace data are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-user">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-user">Delete account</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

function IconBtn({ icon: Icon, label, onClick, testId, danger, disabled, title }: { icon: typeof Pencil; label: string; onClick: () => void; testId: string; danger?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} data-testid={testId}
      className={`flex items-center gap-1 rounded border px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "border-destructive/40 text-destructive hover:bg-destructive/10" : "border-border text-muted-foreground hover:text-foreground"}`}>
      <Icon className="h-3 w-3" />{label}
    </button>
  );
}

export function UserManagement() {
  const { user, isAdmin } = useTeamAuth();
  if (!user) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="lg:col-span-2">
        {isAdmin ? <AdminAccounts me={user} /> : (
          <Panel kicker="Access" title="Read-Only Account">
            <div className="flex items-start gap-3 text-xs" data-testid="text-readonly-explainer">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-accent/40 bg-accent/10"><Lock className="h-4 w-4 text-accent" /></div>
              <div className="space-y-2 text-muted-foreground">
                <p className="text-[13px] text-foreground">You can view the shared team workspace but not change it.</p>
                <p>Browsing, filtering, reading reports and downloading evidence all work. Launching scans, running simulations or investigations, editing settings and managing accounts require an administrator.</p>
                <p>Ask an administrator if you need elevated access. Account details are visible to administrators only.</p>
              </div>
            </div>
          </Panel>
        )}
      </div>
      <Panel kicker="Your account" title="Change Password">
        <div className="mb-3 flex items-center gap-2 text-xs"><span className="font-medium" data-testid="text-own-display-name">{user.displayName}</span><RoleBadge role={user.role} /></div>
        <ChangePasswordForm compact />
        <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground"><RefreshCw className="h-3 w-3" />Changing your password signs out your other sessions.</p>
      </Panel>
    </div>
  );
}
