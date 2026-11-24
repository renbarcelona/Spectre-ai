import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { ExecutiveInsightsEditor } from "@/components/executive-insights-editor";
import { ApiSettings } from "@/components/api-settings/api-settings";
import { FeatureManagement } from "@/components/feature-management";
import { useQueryClient } from "@tanstack/react-query";
import { useSaveSettings, useHealthCheck, getGetWorkspaceQueryKey } from "@workspace/api-client-react";
import { Lock, Save } from "lucide-react";
import { UserManagement } from "@/components/auth/user-management";
import { useTeamAuth } from "@/lib/team-auth";
import { PageHead } from "@/components/shell";
import { Panel, PageSkeleton, ErrorState } from "@/components/kit";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/lib/sentinel";

export default function SettingsPage() {
  const { data: ws, isLoading, isError, refetch } = useWorkspace();
  const health = useHealthCheck();
  const save = useSaveSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [org, setOrg] = useState("");
  const [notif, setNotif] = useState(false);
  const [init, setInit] = useState(false);
  const { isReadOnly } = useTeamAuth();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const sec = new URLSearchParams(search).get("section");
  const tab = sec === "executive-insights" || sec === "api" || sec === "users" || sec === "features" ? sec : "general";
  useEffect(() => { if (ws && !init) { setOrg(ws.settings.organization); setNotif(ws.settings.notifications); setInit(true); } }, [ws, init]);

  if (isLoading) return <PageSkeleton />;
  if (isError || !ws) return <ErrorState onRetry={() => refetch()} />;
  const dirty = org !== ws.settings.organization || notif !== ws.settings.notifications;
  const valid = org.trim().length >= 1 && org.length <= 100;

  const submit = () => !isReadOnly && save.mutate({ data: { organization: org.trim(), allowedSubnet: "192.168.10.0/24", notifications: notif } }, {
    onSuccess: () => { toast({ title: "Settings saved" }); qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() }); },
    onError: () => toast({ title: "Save failed", description: "Settings were not persisted. Retry.", variant: "destructive" }),
  });

  const integrations = [
    { n: "Assessment API", s: health.isLoading ? "Checking" : health.isError ? "Offline" : "Connected", ok: !health.isError && !health.isLoading },
    { n: "AI analysis model", s: "OpenAI Default · Test Connections In API Settings", ok: false },
    { n: "Network scanner engine", s: "Not connected · demo simulation only", ok: false },
    { n: "SIEM / ticketing export", s: "Not configured", ok: false },
    { n: "Email notifications", s: "No mail provider configured", ok: false },
  ];

  return (
    <div>
      <PageHead kicker="Configuration" title="Workspace Settings" />
      <div role="tablist" aria-label="Settings sections" className="mx-4 mb-3 flex flex-wrap gap-1 border-b border-border md:mx-5">
        {([["general", "General"], ["executive-insights", "Executive Insights"], ["api", "API Settings"], ["users", "User Management"], ["features", "Feature Management"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={`tab-settings-${id}`}
            onClick={() => setLocation(id === "general" ? "/settings" : `/settings?section=${id}`)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs ${tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
        ))}
      </div>
      {tab === "features" ? <div className="px-4 pb-8 md:px-5"><FeatureManagement /></div> : tab === "users" ? <div className="px-4 pb-8 md:px-5"><UserManagement /></div> : tab === "api" ? <div className="px-4 pb-8 md:px-5"><ApiSettings /></div> : tab === "executive-insights" ? <div className="px-4 pb-8 md:px-5"><ExecutiveInsightsEditor ws={ws} refetch={refetch} /></div> : (
      <div className="grid gap-3 px-4 md:px-5 lg:grid-cols-2">
        <Panel kicker="Organization" title="Profile And Scope">
          <div className="space-y-4 text-xs">
            <label className="block"><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Organization name</span>
              <input value={org} maxLength={100} onChange={(e) => setOrg(e.target.value)} disabled={isReadOnly} data-testid="input-organization" className="mt-1 w-full rounded border border-input bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary" />
              {!valid && <span className="text-destructive">Required, up to 100 characters.</span>}
            </label>
            <div><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Authorized subnet</span>
              <div className="mt-1 flex items-center gap-2 rounded border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-muted-foreground"><Lock className="h-3.5 w-3.5" />192.168.10.0/24<span className="ml-auto text-[10px]">fixed in demo</span></div></div>
            <div className="flex items-center justify-between rounded border border-border p-3">
              <div><div className="text-[13px]">In-app notifications</div><div className="text-[11px] text-muted-foreground">Toast alerts for scan completion and critical findings.</div></div>
              <Switch checked={notif} onCheckedChange={setNotif} disabled={isReadOnly} data-testid="switch-notifications" />
            </div>
            <button onClick={submit} disabled={isReadOnly || !dirty || !valid || save.isPending} data-testid="button-save-settings" className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"><Save className="h-3.5 w-3.5" />{save.isPending ? "Saving" : "Save changes"}</button>
          </div>
        </Panel>
        <Panel kicker="Integrations" title="Connection Status" bodyClass="p-0">
          <ul className="divide-y divide-border/50">
            {integrations.map((i) => (
              <li key={i.n} className="flex items-center justify-between px-4 py-3 text-xs" data-testid={`status-integration-${i.n}`}>
                <span>{i.n}</span>
                <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground"><span className={i.ok ? "h-1.5 w-1.5 rounded-full bg-primary" : "h-1.5 w-1.5 rounded-full bg-muted-foreground/40"} />{i.s}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel kicker="Access" title="User Management" className="lg:col-span-2">
          <div className="flex flex-col items-start gap-3 md:flex-row md:items-center">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border"><Lock className="h-4 w-4 text-primary" /></div>
            <div className="flex-1 text-xs">
              <div className="text-[13px] font-medium">Local team sign-in is enforced</div>
              <p className="mt-0.5 text-muted-foreground">Every team member signs in with an administrator-issued account. Administrators have full access; read-only accounts can view and download only.</p>
            </div>
            <button onClick={() => setLocation("/settings?section=users")} data-testid="link-user-management" className="rounded border border-primary/50 px-3 py-1.5 text-xs text-primary hover:bg-primary/10">{isReadOnly ? "Your account" : "Manage accounts"}</button>
          </div>
        </Panel>
      </div>
      )}
    </div>
  );
}
