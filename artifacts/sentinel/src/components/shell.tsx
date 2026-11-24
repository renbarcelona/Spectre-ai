import { useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useEmergencyStop, useHealthCheck, getGetWorkspaceQueryKey, getListExercisesQueryKey } from "@workspace/api-client-react";
import { Eye, KeyRound, LogOut, LayoutDashboard, Radar, ShieldAlert, FileText, MessageSquareText, Settings, OctagonX, Crosshair, Menu, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace, isActive } from "@/lib/sentinel";
import { cn } from "@/lib/utils";
import { EMERGENCY_STOP_EVENT } from "@/lib/attack-paths";
import { useTeamAuth, errorMessage } from "@/lib/team-auth";
import { moduleForPath, useFeatures } from "@/lib/features";

const NAV = [
  { href: "/", label: "Executive Insights", icon: LayoutDashboard },
  { href: "/scans", label: "Scans", icon: Radar },
  { href: "/simulations", label: "Red Team", icon: Crosshair },
  { href: "/vulnerabilities", label: "Vulnerabilities", icon: ShieldAlert },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/investigator", label: "AI Investigator", icon: MessageSquareText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Mark() {
  return (
    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/35 bg-gradient-to-br from-primary/20 via-sidebar to-accent/10 shadow-[0_0_16px_hsl(172_72%_52%/0.12)]">
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-primary" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 6v3m0 6v3M6 12h3m6 0h3M7.4 7.4l2.4 2.4m4.4 4.4 2.4 2.4m0-9.2-2.4 2.4m-4.4 4.4-2.4 2.4" />
        <circle cx="12" cy="3.5" r="2" />
        <circle cx="20.5" cy="12" r="2" />
        <circle cx="12" cy="20.5" r="2" />
        <circle cx="3.5" cy="12" r="2" />
        <circle cx="6" cy="6" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="18" cy="6" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="6" cy="18" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="18" cy="18" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="3" className="text-accent" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const features = useFeatures();
  const [loc] = useLocation();
  const search = useSearch();
  const smode = loc === "/scans" ? new URLSearchParams(search).get("mode") : null;
  const embMode = smode === "embedded";
  const liveMode = embMode;
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { user, isReadOnly, logout, loggingOut } = useTeamAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const ws = useWorkspace();
  const health = useHealthCheck();
  const stop = useEmergencyStop();
  const active = ws.data?.scans.filter(isActive).length ?? 0;
  const redRunning = ws.data?.exercises?.filter((e) => e.status.toLowerCase() === "running").length ?? 0;
  const online = health.data?.status === "ok" || (!!health.data && !health.isError);

  const doStop = () => {
    window.dispatchEvent(new CustomEvent(EMERGENCY_STOP_EVENT));
    stop.mutate(undefined, {
      onSuccess: (r) => { toast({ title: "Emergency stop acknowledged", description: r.message }); qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() }); qc.invalidateQueries({ queryKey: getListExercisesQueryKey() }); },
      onError: () => toast({ title: "Emergency stop failed", description: "Could not reach the API. Retry.", variant: "destructive" }),
    });
  };

  const nav = (
    <nav className="flex flex-col gap-0.5 px-2">
      {NAV.map(({ href, label, icon: Icon }) => {
        const feature = moduleForPath(href);
        const disabled = !!feature && (features.isError || !features.data?.[feature.key]);
        if (disabled) return <span key={href} role="link" aria-disabled="true" title={`${label} Is Unavailable`} data-testid={`link-${label.toLowerCase()}`}
          className="flex cursor-not-allowed items-center gap-3 rounded px-3 py-2 text-[13px] text-muted-foreground opacity-40 grayscale">
          <Icon className="h-4 w-4" />{label}<span className="ml-auto text-[9px]">Disabled</span>
        </span>;
        const on = href === "/" ? loc === "/" : loc.startsWith(href);
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)} data-testid={`link-${label.toLowerCase()}`}
            className={cn("group relative flex items-center gap-3 rounded px-3 py-2 text-[13px] transition-colors", on ? "bg-sidebar-accent text-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-foreground")}>
            {on && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded bg-primary" />}
            <Icon className={cn("h-4 w-4", on ? "text-primary" : "")} />
            {label}
            {label === "Scans" && active > 0 && <span className="ml-auto rounded-sm bg-primary/15 px-1.5 font-mono text-[10px] text-primary">{active}</span>}
            {label === "Red Team" && redRunning > 0 && <span className="ml-auto rounded-sm bg-destructive/15 px-1.5 font-mono text-[10px] text-destructive">{redRunning}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const side = (
    <div className="flex h-full flex-col">
      <div className="px-4 py-4">
        <div className="flex items-center gap-2.5">
          <Mark />
          <div className="font-display text-[15px] font-semibold leading-none">SPECTRE AI</div>
        </div>
        <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Strategic Penetration &amp; Exploit Cyber Threat Response Engine</div>
        <div className="mt-2 text-[10px] leading-relaxed text-sidebar-foreground/80">Created by Renne Barcelona</div>
      </div>
      {nav}
      <div className="mt-auto space-y-2 p-3">
        {user && (
          <div className="rounded border border-sidebar-border bg-background/40 p-3" data-testid="panel-current-user">
            <div className="flex items-center gap-2">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border font-mono text-[10px] uppercase">{user.displayName.slice(0, 2)}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px]" data-testid="text-current-user">{user.displayName}</div>
                <div className={cn("font-sans text-[11px] font-medium", isReadOnly ? "text-accent" : "text-primary")} data-testid="text-current-role">{isReadOnly ? "Read-Only" : "Administrator"}</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <Link href="/settings?section=users" onClick={() => setOpen(false)} data-testid="link-change-password" className="flex items-center justify-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"><KeyRound className="h-3 w-3" />Password</Link>
              <button onClick={() => logout().catch((e) => toast({ title: "Sign Out Failed", description: `${errorMessage(e)} You are still signed in; retry.`, variant: "destructive" }))} disabled={loggingOut} data-testid="button-logout" className="flex items-center justify-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"><LogOut className="h-3 w-3" />{loggingOut ? "Leaving" : "Sign out"}</button>
            </div>
          </div>
        )}
        <div className="rounded border border-sidebar-border bg-background/40 p-3 font-sans text-[11px] leading-relaxed text-muted-foreground">
          <div className="flex items-center justify-between"><span>API</span><span className={online ? "text-primary" : "text-destructive"}>{health.isLoading ? "checking" : online ? "online" : "offline"}</span></div>
          <div className="flex items-center justify-between"><span>AI engine</span><span className={ws.data?.aiAvailable ? "text-primary" : "text-accent"}>{ws.data ? (ws.data.aiAvailable ? "available" : "fallback") : "--"}</span></div>
          <div className="flex items-start justify-between gap-3" title="Configured default AI Investigator model. A selected API Gateway connector may use another model; this label is not a connectivity test.">
            <span className="shrink-0">AI Model</span>
            <span className="min-w-0 break-all text-right font-mono text-[10px] text-foreground/80" data-testid="status-ai-model">{ws.data?.aiModel || "--"}</span>
          </div>
          <div className="flex items-center justify-between"><span>{liveMode ? "Live Scope" : "Demo Scope"}</span><span className="text-foreground/80">{liveMode ? "Approved Public IPs" : "192.168.10.0/24"}</span></div>
        </div>
      </div>
    </div>
  );

  return (
    <>
    <div className="relative z-[2] flex min-h-[100dvh]">
      <aside className="sticky top-0 hidden h-[100dvh] w-56 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">{side}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-background/70" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-sidebar-border bg-sidebar">{side}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-background px-3 md:px-5">
          <button className="shrink-0 lg:hidden" onClick={() => setOpen(!open)} data-testid="button-menu">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          <span className="min-w-0 truncate rounded-sm border border-accent/30 bg-accent/10 px-2 py-0.5 font-sans text-[11px] font-medium text-accent" data-testid="status-demo">{embMode ? "Embedded Live Checks · Real" : "Demo Environment"}</span>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {active > 0 && <span className="hidden items-center gap-1.5 font-mono text-[11px] text-primary sm:flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />{active} demo job{active > 1 ? "s" : ""} running</span>}
            {isReadOnly && <span className="flex shrink-0 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent" data-testid="badge-read-only"><Eye className="h-3 w-3" />Read-Only</span>}
            {!isReadOnly && <button onClick={() => setConfirm(true)} disabled={stop.isPending} data-testid="button-emergency-stop"
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-destructive/60 bg-[hsl(354_60%_14%)] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/20 disabled:opacity-60 md:px-3 md:text-xs">
              <OctagonX className="h-4 w-4" />
              {stop.isPending ? "Stopping" : "Stop Demo Jobs"}
            </button>}
          </div>
        </header>
        {isReadOnly && (
          <div className="flex items-center gap-2 border-b border-accent/25 bg-accent/[0.07] px-3 py-1.5 text-[11px] text-accent md:px-5" data-testid="banner-read-only">
            <Eye className="h-3.5 w-3.5 shrink-0" /><span>Read-only access. You can browse, filter and download; launching, editing and stopping jobs require an administrator.</span>
          </div>
        )}
        <main className="min-w-0 flex-1 pb-24" data-readonly={isReadOnly ? "true" : undefined}>{children}</main>
      </div>

      <AlertDialog open={confirm && !isReadOnly} onOpenChange={setConfirm}>
        <AlertDialogContent className="border-destructive/40 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Stop Demo Jobs (Demo Only)?</AlertDialogTitle>
            <AlertDialogDescription>This stops every queued or running simulated scan and stops every draft or running demo red-team exercise in this demonstration workspace, and halts local MITRE playback. It does not cancel real jobs; use Stop All Live Scans in Intelligent VAPT Scans.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-stop">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doStop} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-stop">Stop demo jobs</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </>
  );
}

export function PageHead({ kicker, title, sub, right }: { kicker: string; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-5 md:px-5">
      <div>
        <div className="font-sans text-[11px] font-medium capitalize tracking-wide text-muted-foreground">{kicker}</div>
        <h1 className="font-display mt-1 text-xl font-semibold md:text-2xl">{title}</h1>
        {sub && <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
