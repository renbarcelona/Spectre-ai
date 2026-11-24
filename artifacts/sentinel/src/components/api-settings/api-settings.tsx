import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/lib/azure-auth";
import {
  useGetGateway, getGetGatewayQueryKey, useCreateGatewayConnector, useUpdateGatewayConnector,
  useDeleteGatewayConnector, useTestGatewayConnector, useQueryGatewayConnector,
} from "@workspace/api-client-react";
import type { GatewayConnector, GatewayProvider, GatewayResult, GatewayConnectorInputProvider } from "@workspace/api-client-react";
import { Brain, Check, Copy, FlaskConical, KeyRound, LogIn, Pencil, Play, Power, Radar, Send, ShieldAlert, Trash2, X, ExternalLink } from "lucide-react";
import { Panel, Skel, ErrorState, EmptyState } from "@/components/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { useCanWrite } from "@/lib/team-auth";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const MAX = 20;
const fmt = (s?: string) => (s ? new Date(s).toLocaleString() : "never");

function errMsg(e: unknown): string {
  const err = e as { status?: number; message?: string; data?: unknown } | null;
  const d = err?.data as { error?: string; message?: string } | null | undefined;
  const detail = d?.error ?? d?.message ?? err?.message ?? "Request failed";
  return err?.status ? `${err.status}: ${detail}` : detail;
}

const Btn = ({ children, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
  <button {...p} className={cn("inline-flex items-center justify-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40", className)}>{children}</button>
);
const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) => (
  <label className="block"><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>{children}{hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}</label>
);
const inputCls = "mt-1 w-full rounded border border-input bg-background/60 px-3 py-2 font-mono text-sm outline-none focus:border-primary";
const primary = "border-primary bg-primary text-primary-foreground hover:opacity-90";
const ghost = "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground";

function status(c: GatewayConnector) {
  if (c.enabled) return { t: "Enabled", cls: "text-primary border-primary/40 bg-primary/10" };
  if (c.testOk) return { t: "Tested · Disabled", cls: "text-accent border-accent/40 bg-accent/10" };
  if (c.testedAt) return { t: "Test Failed", cls: "text-destructive border-destructive/40 bg-destructive/10" };
  return { t: "Untested", cls: "text-muted-foreground border-border bg-muted/30" };
}

export function ApiSettings() {
  const { user, isLoading, isAuthenticated, login } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id ?? "anon";
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading) return;
    if (last.current !== uid) { qc.removeQueries({ queryKey: getGetGatewayQueryKey() }); last.current = uid; }
  }, [uid, isLoading, qc]);

  if (isLoading) return <div className="space-y-3"><Skel className="h-24" /><Skel className="h-72" /></div>;
  if (!isAuthenticated || !user) return (
    <Panel kicker="API Settings" title="Sign In Required" className="mx-auto max-w-3xl">
      <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
        <p className="text-sm leading-relaxed text-muted-foreground">AI and threat-intelligence connectors are scoped to your signed-in identity. Nothing is loaded or sent to any provider until you sign in and explicitly run a request.</p>
        <Btn onClick={login} data-testid="button-api-sign-in" className={cn(primary, "py-2.5 text-sm")}><LogIn className="h-4 w-4" />Sign In</Btn>
      </div>
    </Panel>
  );
  return <Console key={user.id} userId={user.id} />;
}

function CopyName({ name }: { name: string }) {
  const { toast } = useToast();
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded border border-accent/40 bg-background/70 px-2 py-1.5 font-mono text-[11px] text-accent" data-testid="text-secret-name">{name}</code>
      <Btn data-testid="button-copy-secret-name" className="border-accent/50 text-accent hover:bg-accent/15"
        onClick={() => navigator.clipboard.writeText(name).then(() => toast({ title: "Secret name copied" }), () => toast({ title: "Copy failed", description: "Select the name manually.", variant: "destructive" }))}><Copy className="h-3.5 w-3.5" />Copy</Btn>
    </div>
  );
}

function CredentialGuide({ c, p }: { c: GatewayConnector; p?: GatewayProvider }) {
  if (!c.secretName) return (
    <div className="rounded border border-border bg-background/40 p-3 text-[11px] leading-relaxed text-muted-foreground" data-testid="text-credential-managed">
      {c.credentialReady ? "No credential required, or a managed runtime credential is configured server-side." : "Managed runtime is not configured for this provider in this workspace (provisioning may be blocked by organization policy). You can keep the connector saved, but tests will fail until an operator configures it."}
    </div>
  );
  return (
    <div className="space-y-2 rounded border border-accent/30 bg-accent/5 p-3 text-[11px] leading-relaxed">
      <div className="flex items-center gap-2 font-semibold text-accent"><KeyRound className="h-3.5 w-3.5" />Credential via Workspace Secret</div>
      <CopyName name={c.secretName} />
      <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
        <li>A project operator opens the workspace Secrets tool.</li>
        <li>Create a secret with exactly this name. {p?.auth}</li>
        <li>Restart the API server if required, then run Test here.</li>
      </ol>
      <p className="text-muted-foreground">Never paste keys into SPECTRE, URLs, tickets or chat. The credential is never returned to the browser.</p>
      <div className={cn("font-mono text-[10px] uppercase", c.credentialReady ? "text-primary" : "text-destructive")} data-testid={`status-credential-${c.id}`}>{c.credentialReady ? "Credential present on server" : "Credential missing"}</div>
    </div>
  );
}

function Console({ userId }: { userId: string }) {
  const ro = !useCanWrite();
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = [...getGetGatewayQueryKey(), userId] as const;
  const q = useGetGateway({ query: { queryKey: key, refetchInterval: 15000 } });
  const refresh = () => qc.invalidateQueries({ queryKey: getGetGatewayQueryKey() });
  const fail = (title: string) => (e: unknown) => toast({ title, description: errMsg(e), variant: "destructive" });

  const create = useCreateGatewayConnector();
  const update = useUpdateGatewayConnector();
  const del = useDeleteGatewayConnector();
  const test = useTestGatewayConnector();

  // wizard
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<"ai" | "cti">("ai");
  const [prov, setProv] = useState("");
  const [name, setName] = useState(""); const [model, setModel] = useState(""); const [baseUrl, setBaseUrl] = useState("");
  const [wizId, setWizId] = useState<string | null>(null);
  const [lastTest, setLastTest] = useState<(GatewayResult & { id: string }) | null>(null);

  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; name: string; model: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<GatewayConnector | null>(null);

  if (q.isLoading) return <div className="space-y-3"><Skel className="h-20" /><div className="grid gap-3 xl:grid-cols-2"><Skel className="h-80" /><Skel className="h-80" /></div></div>;
  if (q.isError || !q.data) return <ErrorState message={errMsg(q.error)} onRetry={() => q.refetch()} />;

  const { providers, connectors, audit } = q.data;
  const pOf = (id: string) => providers.find((p) => p.id === id);
  const provider = pOf(prov);
  const wiz = connectors.find((c) => c.id === wizId);
  const full = connectors.length >= MAX;
  const selected = connectors.find((c) => c.id === sel);

  const resetWizard = () => { setStep(1); setProv(""); setName(""); setModel(""); setBaseUrl(""); setWizId(null); setLastTest(null); };
  const pick = (p: GatewayProvider) => { setProv(p.id); setModel(p.defaultModel ?? ""); setBaseUrl(p.customUrl ? "" : p.baseUrl ?? ""); if (!name) setName(p.name); setStep(2); };
  const urlErr = provider?.customUrl ? (!baseUrl ? "Required" : !/^https:\/\/[^/\s]+/i.test(baseUrl.trim()) ? "Must be an https:// public endpoint" : null) : null;
  const canSave = !!provider && name.trim().length > 0 && !urlErr && !full && !create.isPending && (provider.kind !== "ai" || model.trim().length > 0);

  const save = () => provider && create.mutate({ data: { name: name.trim(), provider: provider.id as GatewayConnectorInputProvider, ...(provider.kind === "ai" ? { model: model.trim() } : {}), ...(provider.customUrl ? { baseUrl: baseUrl.trim() } : {}) } }, {
    onSuccess: (c) => { setWizId(c.id); setStep(3); toast({ title: "Connector saved", description: "Saved disabled. Test before enabling." }); refresh(); },
    onError: fail("Save failed"),
  });
  const runTest = (id: string, inWizard = false) => test.mutate({ id }, {
    onSuccess: (r) => { setLastTest({ ...r, id }); if (inWizard && r.ok) setStep(4); toast({ title: r.ok ? "Test passed" : "Test failed", description: r.message, variant: r.ok ? undefined : "destructive" }); refresh(); },
    onError: (e) => { fail("Test failed")(e); refresh(); },
  });
  const setEnabled = (c: GatewayConnector, enabled: boolean, after?: () => void) => update.mutate({ id: c.id, data: { enabled } }, {
    onSuccess: () => { toast({ title: enabled ? "Connector enabled" : "Connector disabled" }); refresh(); after?.(); },
    onError: fail(enabled ? "Enable failed" : "Disable failed"),
  });
  const saveEdit = () => {
    if (!edit) return; const c = connectors.find((x) => x.id === edit.id); if (!c) return;
    const data: { name?: string; model?: string } = {};
    if (edit.name.trim() !== c.name) data.name = edit.name.trim();
    if (c.kind === "ai" && edit.model.trim() !== (c.model ?? "")) data.model = edit.model.trim();
    if (!Object.keys(data).length) { setEdit(null); return; }
    update.mutate({ id: c.id, data }, {
      onSuccess: () => { toast({ title: "Connector updated", description: data.model ? "Model changed: test cleared and connector disabled. Re-test to enable." : undefined }); setEdit(null); if (lastTest?.id === c.id) setLastTest(null); refresh(); },
      onError: fail("Update failed"),
    });
  };
  const doDelete = () => { const c = confirmDel; if (!c) return; del.mutate({ id: c.id }, {
    onSuccess: () => { toast({ title: "Connector deleted", description: "Workspace secret was not touched." }); if (sel === c.id) setSel(null); if (wizId === c.id) resetWizard(); refresh(); },
    onError: fail("Delete failed"),
  }); };

  const steps = ["Choose Provider", "Configure", "Test", "Enable"];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded border border-primary/25 bg-card/70 px-4 py-3" data-testid="api-status-strip">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Server-Side Gateway</span>
        <Stat k="Connectors" v={`${connectors.length}/${MAX}`} />
        <Stat k="Enabled" v={String(connectors.filter((c) => c.enabled).length)} />
        <Stat k="Providers Ready" v={`${providers.filter((p) => p.ready).length}/${providers.length}`} />
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        {ro ? (
        <Panel kicker="Access" title="Read-Only View" className="xl:col-span-7">
          <p className="text-xs leading-relaxed text-muted-foreground" data-testid="text-api-readonly">You can review the provider catalog, saved connections and their test status. Adding, testing, enabling, editing, deleting and querying connectors require an administrator.</p>
        </Panel>
        ) : (
        <Panel kicker="New Connector" title="Guided Setup" className="xl:col-span-7">
          <ol className="mb-4 grid grid-cols-4 gap-1" data-testid="wizard-steps">
            {steps.map((s, i) => (
              <li key={s} className={cn("border-t-2 pt-1.5 font-mono text-[10px] uppercase tracking-wider", step > i + 1 ? "border-primary text-primary" : step === i + 1 ? "border-accent text-foreground" : "border-border text-muted-foreground")}>{i + 1}. {s}</li>
            ))}
          </ol>

          {step === 1 && (
            <div className="space-y-3 text-xs">
              {full && <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive">Limit of {MAX} connectors reached. Delete one to add another.</p>}
              <div className="inline-grid grid-cols-2 gap-1 rounded border border-border bg-background/50 p-0.5 font-mono text-[11px]">
                {(["ai", "cti"] as const).map((k) => <button key={k} type="button" onClick={() => setKind(k)} data-testid={`button-kind-${k}`} className={cn("flex items-center gap-1.5 rounded-sm px-3 py-1.5 uppercase tracking-wider", kind === k ? "bg-secondary text-primary" : "text-muted-foreground")}>{k === "ai" ? <Brain className="h-3.5 w-3.5" /> : <Radar className="h-3.5 w-3.5" />}{k === "ai" ? "AI Models" : "Threat Intel"}</button>)}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {providers.filter((p) => p.kind === kind).map((p) => (
                  <button key={p.id} type="button" disabled={full} onClick={() => pick(p)} data-testid={`card-provider-${p.id}`}
                    className={cn("rounded border bg-background/40 p-3 text-left transition-colors hover:border-primary/50 disabled:opacity-40", prov === p.id ? "border-primary" : "border-border")}>
                    <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-semibold">{p.name}</span>
                      <span className={cn("font-mono text-[9px] uppercase", p.ready ? "text-primary" : "text-accent")}>{p.ready ? "Ready" : "Needs Config"}</span></div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{p.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && provider && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between rounded border border-border bg-background/40 px-3 py-2"><span><span className="font-semibold">{provider.name}</span> <span className="font-mono text-[10px] uppercase text-muted-foreground">· {provider.kind}</span></span><a href={provider.docsUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1 text-[11px] text-primary" data-testid="link-provider-docs">Docs<ExternalLink className="h-3 w-3" /></a></div>
              {!provider.ready && <p className="rounded border border-accent/40 bg-accent/10 p-2 text-[11px] text-accent" data-testid="text-provider-unready">Not configured in this workspace. {provider.auth} You can save now; it cannot be enabled until a test succeeds.</p>}
              <Field label="Connector name"><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="input-connector-name" className={inputCls} /></Field>
              {provider.kind === "ai" && <Field label="Model" hint={provider.defaultModel && `Default: ${provider.defaultModel}`}><input value={model} maxLength={120} onChange={(e) => setModel(e.target.value)} data-testid="input-connector-model" className={inputCls} /></Field>}
              {provider.customUrl ? (
                <Field label="Base URL" hint={urlErr ? <span className="text-destructive">{urlErr}</span> : "Public HTTPS on port 443. Private, LAN and redirecting endpoints are rejected by the server. Immutable after save."}>
                  <input value={baseUrl} maxLength={500} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" data-testid="input-connector-baseurl" className={inputCls} />
                </Field>
              ) : provider.baseUrl && <p className="font-mono text-[10px] text-muted-foreground">Destination: {provider.baseUrl}</p>}
              <p className="text-[11px] text-muted-foreground">No API key field by design. After saving you receive a server-generated secret name to set in workspace Secrets.</p>
              <div className="flex gap-2">
                <Btn onClick={() => setStep(1)} className={ghost} data-testid="button-wizard-back">Back</Btn>
                <Btn onClick={save} disabled={!canSave} className={primary} data-testid="button-save-connector"><Check className="h-3.5 w-3.5" />{create.isPending ? "Saving" : "Save (disabled)"}</Btn>
              </div>
            </div>
          )}

          {step >= 3 && wiz && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between"><span className="text-[13px] font-semibold">{wiz.name}</span><span className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase", status(wiz).cls)}>{status(wiz).t}</span></div>
              <CredentialGuide c={wiz} p={pOf(wiz.provider)} />
              {lastTest?.id === wiz.id && <TestResult r={lastTest} />}
              <div className="flex flex-wrap gap-2">
                <Btn onClick={() => runTest(wiz.id, true)} disabled={test.isPending} className={ghost} data-testid="button-wizard-test"><FlaskConical className="h-3.5 w-3.5" />{test.isPending ? "Testing" : "Run Test"}</Btn>
                <Btn onClick={() => setEnabled(wiz, true, () => { setSel(wiz.id); resetWizard(); })} disabled={!wiz.testOk || update.isPending} className={primary} data-testid="button-wizard-enable"><Power className="h-3.5 w-3.5" />Enable</Btn>
                <Btn onClick={resetWizard} className={ghost} data-testid="button-wizard-finish">Finish later</Btn>
              </div>
              {!wiz.testOk && <p className="text-[11px] text-muted-foreground">Enable unlocks only after a successful server test.</p>}
            </div>
          )}
          {step >= 3 && !wiz && <EmptyState title="Connector unavailable" body="It may have been deleted." />}
        </Panel>
        )}

        <Panel kicker="Reference" title="Gateway API" className="xl:col-span-5">
          <div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground" data-testid="text-api-guide">
            <pre className="scrollbar-thin overflow-auto rounded border border-border bg-background/80 p-2 font-mono text-[10.5px] text-foreground">{`GET    /api/v1/gateway
POST   /api/v1/gateway/connectors
PATCH  /api/v1/gateway/connectors/:id
DELETE /api/v1/gateway/connectors/:id
POST   /api/v1/gateway/connectors/:id/test
POST   /api/v1/gateway/connectors/:id/query`}</pre>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Authenticated session required; connectors are owner-scoped.</li>
              <li>Calls execute server-side only. Browser never holds provider credentials.</li>
              <li>HTTPS public endpoints on port 443; no redirects, no private/LAN targets.</li>
              <li>CTI connectors are read-only lookups.</li>
              <li>Deadlines and response size limits apply.</li>
              <li>User-triggered only: no automatic uploads, scans or LLM actions.</li>
            </ul>
          </div>
        </Panel>

        <Panel kicker="Saved" title={`Connectors (${connectors.length}/${MAX})`} className="xl:col-span-7" bodyClass="p-0">
          {connectors.length === 0 ? <div className="p-4"><EmptyState title="No connectors yet" body="Use guided setup to add an AI model or threat-intel source." /></div> : (
            <ul className="divide-y divide-border/50">
              {connectors.map((c) => { const s = status(c); const editing = edit?.id === c.id; return (
                <li key={c.id} className={cn("space-y-2 px-4 py-3 text-xs", sel === c.id && "bg-primary/5")} data-testid={`row-connector-${c.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setSel(c.id)} className="min-w-0 flex-1 text-left" data-testid={`button-select-connector-${c.id}`}>
                      <div className="flex items-center gap-2 text-[13px] font-medium">{c.kind === "ai" ? <Brain className="h-3.5 w-3.5 text-primary" /> : <Radar className="h-3.5 w-3.5 text-accent" />}{c.name}</div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">{pOf(c.provider)?.name ?? c.provider} · {c.model ?? c.baseUrl ?? pOf(c.provider)?.baseUrl ?? "managed"} · cred {c.credentialReady ? "present" : "missing"} · tested {fmt(c.testedAt)}</div>
                    </button>
                    <span className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase", s.cls)} data-testid={`status-connector-${c.id}`}>{s.t}</span>
                  </div>
                  {ro ? null : editing ? (
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <input value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid={`input-edit-name-${c.id}`} className={cn(inputCls, "mt-0 py-1.5")} />
                      {c.kind === "ai" ? <input value={edit.model} maxLength={120} onChange={(e) => setEdit({ ...edit, model: e.target.value })} data-testid={`input-edit-model-${c.id}`} className={cn(inputCls, "mt-0 py-1.5")} /> : <span />}
                      <div className="flex gap-1">
                        <Btn onClick={saveEdit} disabled={!edit.name.trim() || (c.kind === "ai" && !edit.model.trim()) || update.isPending} className={primary} data-testid={`button-save-edit-${c.id}`}><Check className="h-3.5 w-3.5" /></Btn>
                        <Btn onClick={() => setEdit(null)} className={ghost} data-testid={`button-cancel-edit-${c.id}`}><X className="h-3.5 w-3.5" /></Btn>
                      </div>
                      {c.kind === "ai" && edit.model.trim() !== (c.model ?? "") && <p className="text-[11px] text-accent sm:col-span-3">Changing the model clears the test and disables this connector. Provider and endpoint are immutable; delete and recreate to change them.</p>}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      <Btn onClick={() => runTest(c.id)} disabled={test.isPending} className={ghost} data-testid={`button-test-${c.id}`}><FlaskConical className="h-3.5 w-3.5" />Test</Btn>
                      {c.enabled
                        ? <Btn onClick={() => setEnabled(c, false)} disabled={update.isPending} className={ghost} data-testid={`button-disable-${c.id}`}><Power className="h-3.5 w-3.5" />Disable</Btn>
                        : <Btn onClick={() => setEnabled(c, true)} disabled={!c.testOk || update.isPending} title={c.testOk ? undefined : "Requires a successful test"} className={primary} data-testid={`button-enable-${c.id}`}><Power className="h-3.5 w-3.5" />Enable</Btn>}
                      <Btn onClick={() => setEdit({ id: c.id, name: c.name, model: c.model ?? "" })} className={ghost} data-testid={`button-edit-${c.id}`}><Pencil className="h-3.5 w-3.5" />Edit</Btn>
                      {c.kind === "ai" && c.enabled && c.testOk && <Link href={`/investigator?connector=${encodeURIComponent(c.id)}`} data-testid={`link-investigator-${c.id}`} className="inline-flex items-center gap-1.5 rounded border border-primary/40 px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10">Use In AI Investigator</Link>}
                      <Btn onClick={() => setConfirmDel(c)} className="ml-auto border-destructive/40 text-destructive hover:bg-destructive/10" data-testid={`button-delete-${c.id}`}><Trash2 className="h-3.5 w-3.5" /></Btn>
                    </div>
                  )}
                  {lastTest?.id === c.id && step < 3 && <TestResult r={lastTest} />}
                  {sel === c.id && !c.credentialReady && <CredentialGuide c={c} p={pOf(c.provider)} />}
                </li>
              ); })}
            </ul>
          )}
        </Panel>

        <div className="xl:col-span-5">
          {ro ? <Panel kicker="Run" title="Query Connector" className="h-full"><EmptyState title="Administrators only" body="Running provider queries is a write action and is unavailable to read-only accounts." /></Panel> : <QueryPanel key={selected ? `${selected.id}:${selected.revision}:${selected.enabled}` : "none"} c={selected} p={selected ? pOf(selected.provider) : undefined} />}
        </div>

        <Panel kicker="Audit" title="Recent Gateway Activity" className="xl:col-span-12" bodyClass="p-0">
          <p className="border-b border-border/50 px-4 py-2 text-[11px] text-muted-foreground">Actions and outcomes only. Query content and credentials are never logged. Latest 100.</p>
          {audit.length === 0 ? <div className="p-4"><EmptyState title="No activity" body="Create, test or query a connector to see entries." /></div> : (
            <div className="scrollbar-thin max-h-72 overflow-auto">
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="sticky top-0 bg-card text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-4 py-2">Time</th><th className="px-2">Connector</th><th className="px-2">Action</th><th className="px-2">Outcome</th></tr></thead>
                <tbody className="divide-y divide-border/40">
                  {audit.slice(0, 100).map((a, i) => (
                    <tr key={`${a.at}-${i}`} data-testid={`row-audit-${i}`}><td className="whitespace-nowrap px-4 py-1.5 text-muted-foreground">{fmt(a.at)}</td><td className="px-2">{connectors.find((c) => c.id === a.connectorId)?.name ?? a.connectorId}</td><td className="px-2">{a.action}</td><td className="px-2">{a.outcome}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDel?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the connector configuration from SPECTRE. It does not delete the workspace secret{confirmDel?.secretName ? ` ${confirmDel.secretName}` : ""}; an operator must remove that separately in workspace Secrets.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} data-testid="button-confirm-delete" className="bg-destructive text-destructive-foreground">Delete Configuration</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="flex items-baseline gap-1.5"><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{k}</span><span className="font-mono text-[12px]" data-testid={`stat-${k.toLowerCase().replace(/\s+/g, "-")}`}>{v}</span></div>;
}

function TestResult({ r }: { r: GatewayResult }) {
  return (
    <div className={cn("rounded border p-2 text-[11px]", r.ok ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5")} data-testid="text-test-result">
      <span className={r.ok ? "text-primary" : "text-destructive"}>{r.ok ? "PASS" : "FAIL"}</span> · {r.message} <span className="font-mono text-[10px] text-muted-foreground">· {fmt(r.at)}</span>
    </div>
  );
}

function QueryPanel({ c, p }: { c?: GatewayConnector; p?: GatewayProvider }) {
  const run = useQueryGatewayConnector();
  const [text, setText] = useState("");
  const [ack, setAck] = useState(false);
  const [res, setRes] = useState<GatewayResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const ready = !!c && c.enabled && !!c.testOk;
  const submit = () => {
    if (!c) return; setRes(null); setErr(null);
    run.mutate({ id: c.id, data: { query: text.trim() } }, {
      onSuccess: (r) => { if (live.current) setRes(r); },
      onError: (e) => { if (live.current) setErr(errMsg(e)); },
    });
  };

  return (
    <Panel kicker="Run" title={c ? `Query · ${c.name}` : "Query Connector"} className="h-full">
      {!c ? <EmptyState title="Select a connector" body="Choose an enabled, tested connector from the list to run a manual query." /> : !ready ? (
        <EmptyState title="Not available for queries" body="Only enabled connectors with a successful test can be queried." />
      ) : (
        <div className="space-y-3 text-xs">
          <Field label={c.kind === "ai" ? "Prompt" : "Indicator / collection / CVE"} hint={p?.queryHint}>
            <textarea value={text} maxLength={4000} rows={c.kind === "ai" ? 5 : 2} onChange={(e) => setText(e.target.value)} data-testid="input-gateway-query" className={cn(inputCls, "resize-y")} />
          </Field>
          <label className="flex items-start gap-2 rounded border border-accent/25 bg-accent/5 p-2.5">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} data-testid="checkbox-query-disclosure" className="mt-0.5" />
            <span className="text-[11px] leading-relaxed">I understand this text is sent from the SPECTRE server to {p?.name ?? c.provider}{c.baseUrl ? ` (${c.baseUrl})` : ""} and is subject to that provider's terms.</span>
          </label>
          <Btn onClick={submit} disabled={!ack || !text.trim() || run.isPending} className={cn(primary, "w-full py-2")} data-testid="button-run-query">{run.isPending ? <><Play className="h-3.5 w-3.5" />Running</> : <><Send className="h-3.5 w-3.5" />Send To Provider</>}</Btn>
          {run.isPending && <Skel className="h-24" />}
          {err && <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive" data-testid="text-query-error">{err}</p>}
          {res && (
            <div className="space-y-2" data-testid="panel-query-result">
              <div className={cn("text-[11px]", res.ok ? "text-primary" : "text-destructive")}>{res.message} <span className="font-mono text-[10px] text-muted-foreground">· fetched {fmt(res.at)}</span></div>
              {res.resultText && <pre className="scrollbar-thin max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background/80 p-2 font-mono text-[11px]" data-testid="text-query-result">{res.resultText}</pre>}
              <p className="flex items-start gap-1.5 text-[10.5px] text-muted-foreground"><ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />{c.kind === "cti" ? "A threat-intel match is context, not proof of compromise or vulnerability. Verify independently." : "Model output may be wrong. Verify before acting."}</p>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
