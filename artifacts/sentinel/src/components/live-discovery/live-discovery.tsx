import { useEffect, useMemo, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/lib/azure-auth";
import {
  useGetLiveDiscovery, getGetLiveDiscoveryQueryKey, useRegisterScanner, useRevokeScanner,
  useApprovePublicTarget, useRevokePublicTarget, useCreateLiveJob, useCancelLiveJob, useGetEmbeddedStatus, useCreateEmbeddedJob,
} from "@workspace/api-client-react";
import type { EmbeddedJobInput, GetEmbeddedStatus200, LiveJob, Scanner, PublicTarget, LiveDiscovery as LiveData } from "@workspace/api-client-react";
import { Copy, Download, KeyRound, LogIn, LogOut, OctagonX, Play, Server, ShieldCheck, Target, Trash2, X, Ban, FileText, Cpu } from "lucide-react";
import { Panel, Skel, ErrorState, EmptyState } from "@/components/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useCanWrite } from "@/lib/team-auth";
import { cn } from "@/lib/utils";
import { EmbeddedGuidance } from "./embedded-guidance";
import { EmbeddedNetMapper } from "./embedded-netmapper";
import { EmbeddedResultTabs } from "./embedded-result-tabs";
import { LiveExposureRadar } from "@/components/live-exposure-radar";
import { protoOf, jobPairs, fmtPairs, validateCustomPorts, MAX_CUSTOM_CHECKS, type JobLike } from "@/lib/live-exposure";

const PROFILES = {
  web: [80, 443, 8080, 8443],
  standard: [21, 22, 25, 53, 80, 110, 143, 443, 445, 465, 587, 993, 995, 1433, 1521, 3306, 3389, 5432, 5900, 6379, 8000, 8080, 8443, 9200, 27017],
} as const;
type Profile = keyof typeof PROFILES | "custom";
const pairsOf = (j: LiveJob) => jobPairs(j);
const ACTIVE = new Set(["queued", "running", "cancelling"]);
const MAX_SCOPES = 10;
export type Execution = "external" | "embedded";
const isEmb = (j: LiveJob) => j.engine === "embedded";

function errMsg(e: unknown): string {
  const err = e as { status?: number; message?: string; data?: unknown } | null;
  const d = err?.data as { error?: string; message?: string } | null | undefined;
  const detail = d?.error ?? d?.message ?? err?.message ?? "Request failed";
  const s = err?.status;
  const hint = s === 400 ? "Rejected by validation" : s === 401 ? "Session expired, sign in again" : s === 404 ? "Not found or already removed" : s === 409 ? "Conflict with current state" : undefined;
  return s ? `${s}${hint ? ` · ${hint}` : ""}: ${detail}` : detail;
}

const PRIVATE: [number, number, number][] = [
  // [first-octet-network as int, mask bits] encoded as [a, b, bits] with b = second octet start
  [0, 0, 8], [10, 0, 8], [100, 64, 10], [127, 0, 8], [169, 254, 16], [172, 16, 12], [192, 168, 16], [198, 18, 15], [224, 0, 4], [240, 0, 4],
];
const PRIVATE24 = ["192.0.0", "192.0.2", "192.88.99", "198.51.100", "203.0.113"];
export function publicIpv4Error(ip: string): string | null {
  const t = ip.trim();
  if (!t) return "Enter one IPv4 address";
  if (t.includes("/")) return "CIDR ranges are not permitted, single address only";
  if (t.includes(":")) return "IPv6 is not supported in this release";
  const m = t.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return "Not a dotted IPv4 address (domains are not accepted)";
  const o = m.slice(1).map(Number);
  if (o.some((n, i) => n > 255 || (m[i + 1].length > 1 && m[i + 1].startsWith("0")))) return "Invalid octet";
  const n = ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
  for (const [a, b, bits] of PRIVATE) {
    const net = ((a << 24) >>> 0) + (b << 16);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if (((n & mask) >>> 0) === net) return "Private, reserved or special-use address";
  }
  if (PRIVATE24.includes(o.slice(0, 3).join("."))) return "Documentation or reserved range";
  return null;
}

const fmt = (s?: string) => (s ? new Date(s).toLocaleString() : "--");
function ago(s: string | undefined, now: number) {
  if (!s) return "never";
  const d = Math.max(0, Math.round((now - new Date(s).getTime()) / 1000));
  return d < 60 ? `${d}s ago` : d < 3600 ? `${Math.round(d / 60)}m ago` : `${Math.round(d / 3600)}h ago`;
}
function agentState(a: Scanner, now: number): "revoked" | "online" | "offline" | "never" {
  if (a.revoked) return "revoked";
  if (!a.lastSeen) return "never";
  return now - new Date(a.lastSeen).getTime() <= 60_000 ? "online" : "offline";
}
const STATE_LABEL = { revoked: "Revoked", online: "Online", offline: "Offline", never: "Never Connected" };
const STATE_TONE = { revoked: "text-muted-foreground border-border", online: "text-primary border-primary/40 bg-primary/10", offline: "text-accent border-accent/40 bg-accent/10", never: "text-muted-foreground border-border bg-muted/30" };
const JOB_TONE: Record<string, string> = { queued: "text-accent", running: "text-primary", cancelling: "text-accent", completed: "text-foreground", failed: "text-destructive", cancelled: "text-muted-foreground" };

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function reportText(j: LiveJob, t?: PublicTarget, a?: Scanner) {
  const lines = [
    isEmb(j) ? "SPECTRE Embedded Live Checks - Evidence Report (REAL, not simulated)" : "SPECTRE Live Public Discovery - Evidence Report",
    "Inventory only. No exploitation performed. Version matches are not vulnerabilities.",
    "", `Job ID: ${j.id}`, `Target: ${j.ip}${t ? ` (${t.label})` : ""}`, `Authorization Reference: ${t?.authorizationReference ?? "--"}`,
    `Engine: ${isEmb(j) ? "embedded (hosting environment, sequential TCP connect / single empty UDP datagram)" : "external agent"}`, `Agent: ${isEmb(j) ? "embedded" : a?.name ?? j.agentId}`, `Profile: ${j.profile} (${fmtPairs(pairsOf(j)) || "no ports"})`, `Status: ${j.status}`,
    `Host Status: ${j.hostStatus ?? "--"}`, `Created: ${j.createdAt}`, `Started: ${j.startedAt ?? "--"}`, `Finished: ${j.finishedAt ?? "--"}`,
    `Agent Version: ${j.agentVersion ?? "--"}`, `Nmap Version: ${j.nmapVersion ?? "--"}`, `Evidence SHA-256: ${j.evidenceSha256 ?? "--"}`,
    j.error ? `Error: ${j.error}` : "", "", "Services:",
    ...(j.services.length ? j.services.map((s) => `  ${s.port}/${protoOf(s)} ${s.state} ${s.service}${s.product ? ` ${s.product}` : ""}${s.version ? ` ${s.version}` : ""}${s.reason ? ` [${s.reason}]` : ""}${s.detail ? ` ${s.detail}` : ""}${s.elapsedMs != null ? ` ${s.elapsedMs}ms` : ""}`) : ["  (none reported)"]),
    "", isEmb(j) ? "Note: timeout/error states are inconclusive. UDP open|filtered means no response (uncertain). Closed means refusal only. Checks originate from the hosting environment." : "Note: absence of open ports does not prove the host is down (scan uses -Pn).",
  ];
  return lines.join("\n");
}

const Btn = ({ children, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
  <button {...p} className={cn("inline-flex items-center justify-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40", className)}>{children}</button>
);
const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) => (
  <label className="block"><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>{children}{hint && <span className="mt-1 block text-[11px]">{hint}</span>}</label>
);
const inputCls = "mt-1 w-full rounded border border-input bg-background/60 px-3 py-2 font-mono text-sm outline-none focus:border-primary";

type Confirm = { kind: "agent" | "target" | "stopall"; id?: string; label: string } | null;

export function LiveDiscovery({ execution = "external" }: { execution?: Execution }) {
  const { user, isLoading: authLoading, isAuthenticated, login, logout } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id ?? "anon";

  // Drop any cached live data that does not belong to the current user.
  const lastUid = useRef<string | null>(null);
  useEffect(() => {
    if (authLoading) return;
    if (lastUid.current !== uid) { qc.removeQueries({ queryKey: getGetLiveDiscoveryQueryKey() }); lastUid.current = uid; }
  }, [uid, authLoading, qc]);

  if (authLoading) return <div className="space-y-3 px-4 md:px-5"><Skel className="h-28" /><Skel className="h-64" /></div>;
  if (!isAuthenticated || !user) return <SignedOut onLogin={login} execution={execution} />;
  return <LiveConsole execution={execution} userId={user.id} userName={[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || user.id}
    onLogout={() => { qc.removeQueries({ queryKey: getGetLiveDiscoveryQueryKey() }); logout(); }} />;
}

function SignedOut({ onLogin, execution }: { onLogin: () => void; execution: Execution }) {
  return (
    <div className="px-4 md:px-5">
      <Panel kicker={execution === "embedded" ? "Embedded Live Checks" : "Live Public Discovery"} title="Sign In Required" className="mx-auto max-w-3xl">
        <div className="grid gap-5 md:grid-cols-[1.3fr_1fr]">
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p className="text-foreground">Live discovery inventories real public IPv4 services you are authorized to assess. It never exploits anything.</p>
            {execution === "embedded"
              ? <p>Embedded checks run sequential TCP connects from this application's hosting environment against approved public IPv4 scopes. No agent or token is needed. Private networks are unreachable from here.</p>
              : <p>Scans are executed by an external scanner agent you install on your own dedicated Linux host. This application does not send packets itself. Without a running agent, nothing is scanned.</p>}
            <p>Every approved scope, job and evidence file is tied to your signed-in identity.</p>
          </div>
          <div className="flex flex-col justify-center gap-2">
            <Btn onClick={onLogin} data-testid="button-live-sign-in" className="border-primary bg-primary py-2.5 text-sm text-primary-foreground hover:opacity-90"><LogIn className="h-4 w-4" />Sign In</Btn>
            <Link href="/scans" data-testid="link-back-demo" className="rounded border border-border px-3 py-2 text-center text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">Back To Demo Scans</Link>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function LiveConsole({ execution, userId, userName, onLogout }: { execution: Execution; userId: string; userName: string; onLogout: () => void }) {
  const canWrite = useCanWrite();
  const emb = execution === "embedded";
  const st = useGetEmbeddedStatus({ query: { queryKey: ["/api/v1/live/embedded-status", userId], enabled: emb, refetchInterval: 30000 } });
  const createEmb = useCreateEmbeddedJob();
  const runtimeOk = !!st.data?.available;
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = [...getGetLiveDiscoveryQueryKey(), userId] as const;
  const q = useGetLiveDiscovery({ query: { queryKey: key, refetchInterval: 5000, refetchIntervalInBackground: false } });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  const refresh = () => qc.invalidateQueries({ queryKey: getGetLiveDiscoveryQueryKey() });
  const fail = (title: string) => (e: unknown) => toast({ title, description: errMsg(e), variant: "destructive" });

  const register = useRegisterScanner({ mutation: { gcTime: 0 } });
  const revokeAgent = useRevokeScanner();
  const approve = useApprovePublicTarget();
  const revokeTarget = useRevokePublicTarget();
  const createJob = useCreateLiveJob();
  const cancelJob = useCancelLiveJob();

  // One-time credential: local state only.
  const [secret, setSecret] = useState<{ name: string; token: string } | null>(null);
  const [agentName, setAgentName] = useState("");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [stopping, setStopping] = useState(false);
  const [selJob, setSelJob] = useState<string | null>(null);

  // target form
  const [ip, setIp] = useState(""); const [label, setLabel] = useState(""); const [ref, setRef] = useState("");
  const [exp, setExp] = useState(""); const [owns, setOwns] = useState(false);
  // job form
  const [tId, setTId] = useState(""); const [aId, setAId] = useState(""); const [profile, setProfile] = useState<Profile>("web"); const [perm, setPerm] = useState(false);
  const [tcpText, setTcpText] = useState(""); const [udpText, setUdpText] = useState("");

  const data: LiveData | undefined = q.data;
  const agents = data?.agents ?? []; const targets = data?.targets ?? [];
  const allJobs = data?.jobs;
  const jobs = useMemo(() => [...(allJobs ?? [])].filter((j) => (emb ? isEmb(j) : !isEmb(j))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [allJobs, emb]);
  const allActive = (allJobs ?? []).filter((j) => ACTIVE.has(j.status));
  const activeTargets = targets.filter((t) => !t.revoked && new Date(t.expiresAt).getTime() > now);
  const liveAgents = agents.filter((a) => agentState(a, now) === "online");
  const busyAgents = new Set(jobs.filter((j) => ACTIVE.has(j.status)).map((j) => j.agentId));
  const activeJobs = jobs.filter((j) => ACTIVE.has(j.status));
  const current = jobs.find((j) => j.id === selJob) ?? jobs[0];

  if (q.isLoading) return <div className="space-y-3 px-4 md:px-5"><Skel className="h-20" /><div className="grid gap-3 xl:grid-cols-2"><Skel className="h-72" /><Skel className="h-72" /></div><Skel className="h-80" /></div>;
  if (q.isError || !data) return <div className="px-4 md:px-5"><ErrorState message={errMsg(q.error)} onRetry={() => q.refetch()} /></div>;

  // validation
  const ipErr = ip ? publicIpv4Error(ip) : null;
  const expMs = exp ? new Date(exp).getTime() : NaN;
  const expErr = !exp ? null : isNaN(expMs) ? "Invalid date" : expMs <= now ? "Must be in the future" : expMs > now + 30 * 86400_000 ? "Maximum 30 days from now" : null;
  const scopeFull = activeTargets.length >= MAX_SCOPES;
  const canApprove = !!ip && !ipErr && label.trim().length > 0 && ref.trim().length >= 5 && !!exp && !expErr && owns && !scopeFull && !approve.isPending;

  const jTarget = activeTargets.find((t) => t.id === tId);
  const jAgent = agents.find((a) => a.id === aId);
  const jAgentOk = !!jAgent && agentState(jAgent, now) === "online" && !busyAgents.has(jAgent.id);
  const embActive = activeJobs.length > 0;
  const lastEmbStart = jobs[0] ? new Date(jobs[0].createdAt).getTime() : 0;
  const cooldown = emb && now - lastEmbStart < 60_000;
  const custom = emb && profile === "custom";
  const cv = validateCustomPorts(tcpText, udpText);
  const canRun = emb
    ? canWrite && !!jTarget && perm && runtimeOk && (!custom || !cv.error) && !embActive && !cooldown && !createEmb.isPending
    : canWrite && !!jTarget && jAgentOk && perm && !createJob.isPending;

  const submitTarget = () => approve.mutate({ data: { ip: ip.trim(), label: label.trim(), authorizationReference: ref.trim(), expiresAt: new Date(exp).toISOString(), authorized: true } }, {
    onSuccess: (t) => { toast({ title: "Scope Approved", description: `${t.ip} until ${fmt(t.expiresAt)}` }); setIp(""); setLabel(""); setRef(""); setExp(""); setOwns(false); refresh(); },
    onError: fail("Scope Rejected"),
  });
  const submitAgent = () => register.mutate({ data: { name: agentName.trim() } }, {
    onSuccess: (r) => { setSecret({ name: r.agent.name, token: r.token }); register.reset(); setAgentName(""); refresh(); },
    onError: fail("Registration Failed"),
  });
  const submitJob = () => emb ? createEmb.mutate({ data: custom ? { targetId: tId, profile: "custom", authorized: true, ...(cv.tcp.length ? { tcpPorts: cv.tcp.join(",") } : {}), ...(cv.udp.length ? { udpPorts: cv.udp.join(",") } : {}) } : { targetId: tId, profile, authorized: true } }, {
    onSuccess: (j) => { setSelJob(j.id); setPerm(false); toast({ title: "Embedded Check Started", description: `${j.ip} · ${j.profile}. Real checks from the hosting environment.` }); refresh(); },
    onError: fail("Embedded Check Rejected"),
  }) : createJob.mutate({ data: { targetId: tId, agentId: aId, profile: profile === "custom" ? "web" : profile, authorized: true } }, {
    onSuccess: (j) => { setSelJob(j.id); setPerm(false); toast({ title: "Live Job Queued", description: `${j.ip} · ${j.profile}. Waiting for the agent to lease it.` }); refresh(); },
    onError: fail("Job Rejected"),
  });
  const doCancel = (id: string) => cancelJob.mutate({ id }, { onSuccess: (j) => { toast({ title: "Cancellation Requested", description: `Server status: ${j.status}` }); refresh(); }, onError: fail("Cancel Failed") });

  const runConfirm = async () => {
    const c = confirm; if (!c) return;
    if (c.kind === "agent" && c.id) revokeAgent.mutate({ id: c.id }, { onSuccess: () => { toast({ title: "Agent Revoked", description: "Its token is disabled. Active jobs stop on their next agent check; termination may not be acknowledged." }); refresh(); }, onError: fail("Revoke Failed") });
    if (c.kind === "target" && c.id) revokeTarget.mutate({ id: c.id }, { onSuccess: () => { toast({ title: "Scope Revoked", description: "Queued jobs are cancelled. Running jobs stop on the next agent check; awaiting acknowledgement." }); refresh(); }, onError: fail("Revoke Failed") });
    if (c.kind === "stopall") {
      setStopping(true);
      try {
        const r = await fetch("/api/v1/live/emergency-stop", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        const body = await r.json().catch(() => null) as { message?: string; error?: string } | null;
        if (!r.ok) throw Object.assign(new Error(body?.error ?? body?.message ?? r.statusText), { status: r.status });
        toast({ title: "Stop All Live Scans Requested", description: body?.message ?? "Cancellation requested for all your active live jobs. Watch statuses for agent acknowledgement." });
      } catch (e) { fail("Stop All Failed")(e); }
      finally { setStopping(false); refresh(); }
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-3 px-4 md:px-5">
      {emb && <LiveExposureRadar jobs={jobs} />}
      {/* Identity / status strip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded border border-primary/25 bg-card/70 px-4 py-3 backdrop-blur" data-testid="live-status-strip">
        <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-primary" /><span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">{emb ? "Real Telemetry · Embedded Engine" : "Real Telemetry"}</span></div>
        {emb ? <Stat k="Runtime" v={st.isLoading ? "checking" : runtimeOk ? `Ready · ${st.data?.engine}` : "Unavailable"} /> : <Stat k="Agents Online" v={`${liveAgents.length}/${agents.filter((a) => !a.revoked).length}`} />}
        <Stat k="Active Scopes" v={`${activeTargets.length}/${MAX_SCOPES}`} />
        <Stat k="Active Jobs" v={String(activeJobs.length)} />
        <Stat k="Last Poll" v={q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleTimeString() : "--"} />
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground" data-testid="text-live-user">{userName}</span>
          <Btn onClick={() => setConfirm({ kind: "stopall", label: "" })} disabled={stopping || allActive.length === 0} data-testid="button-stop-all-live"
            className="border-destructive/60 bg-[hsl(354_60%_14%)] text-destructive hover:bg-destructive/20"><OctagonX className="h-3.5 w-3.5" />{stopping ? "Requesting" : "Stop All Live Scans (Both Engines)"}</Btn>
          <Btn onClick={onLogout} data-testid="button-live-sign-out" className="border-border text-muted-foreground hover:text-foreground"><LogOut className="h-3.5 w-3.5" />Sign Out</Btn>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        {emb ? <RuntimePanel q={st} /> : (
        <Panel kicker="Step 1" title="Scanner Agents" className="xl:col-span-6">
          <div className="space-y-3 text-xs">
            {secret && (
              <div className="rounded border border-accent/50 bg-accent/10 p-3" data-testid="panel-one-time-token">
                <div className="flex items-center gap-2 font-semibold text-accent"><KeyRound className="h-4 w-4" />One-Time Agent Token · {secret.name}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Shown once. SPECTRE stores only a hash and cannot display it again. Place it in the agent host's environment as SPECTRE_AGENT_TOKEN. Do not paste it into tickets or chat. If lost, revoke the agent and register a new one.</p>
                <code className="mt-2 block break-all rounded border border-border bg-background/70 p-2 font-mono text-[11px]" data-testid="text-one-time-token">Credential Hidden — Use Copy To Transfer Securely</code>
                <div className="mt-2 flex gap-2">
                  <Btn data-testid="button-copy-token" className="border-accent/50 text-accent hover:bg-accent/15" onClick={() => navigator.clipboard.writeText(secret.token).then(() => toast({ title: "Token Copied" }), () => toast({ title: "Copy Failed", description: "Select the token text manually.", variant: "destructive" }))}><Copy className="h-3.5 w-3.5" />Copy</Btn>
                  <Btn data-testid="button-dismiss-token" className="border-border text-muted-foreground hover:text-foreground" onClick={() => setSecret(null)}><X className="h-3.5 w-3.5" />Dismiss Permanently</Btn>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <input value={agentName} maxLength={80} onChange={(e) => setAgentName(e.target.value)} placeholder="edge-scanner-sg1" data-testid="input-agent-name" className={cn(inputCls, "mt-0")} />
              <Btn onClick={submitAgent} disabled={!agentName.trim() || register.isPending} data-testid="button-register-agent" className="shrink-0 border-primary bg-primary text-primary-foreground"><Server className="h-3.5 w-3.5" />{register.isPending ? "Registering" : "Register Agent"}</Btn>
            </div>
            {agents.length === 0 ? <EmptyState title="No Agents Registered" body="Register an agent, then install and run it on your external host. It will show Never Connected until its first poll arrives." /> : (
              <ul className="divide-y divide-border/50 rounded border border-border/60">
                {agents.map((a) => { const st = agentState(a, now); return (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={`row-agent-${a.id}`}>
                    <div className="min-w-0 flex-1"><div className="font-mono text-[12px]">{a.name}</div><div className="font-mono text-[10px] text-muted-foreground">seen {ago(a.lastSeen, now)} · agent {a.version ?? "--"} · {a.nmapVersion ?? "nmap --"}</div></div>
                    <span className={cn("rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase", STATE_TONE[st])} data-testid={`status-agent-${a.id}`}>{STATE_LABEL[st]}</span>
                    {!a.revoked && <Btn data-testid={`button-revoke-agent-${a.id}`} onClick={() => setConfirm({ kind: "agent", id: a.id, label: a.name })} className="border-destructive/40 text-destructive hover:bg-destructive/10"><Ban className="h-3.5 w-3.5" />Revoke</Btn>}
                  </li>
                ); })}
              </ul>
            )}
            <details className="rounded border border-border/60 bg-background/40 p-3" data-testid="details-agent-setup">
              <summary className="cursor-pointer font-semibold">External Agent Setup</summary>
              <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
                <p>Requires a dedicated Linux host you control, Python 3.10+, Nmap 7+, outbound HTTPS to this app, and network permission to reach approved IPs. No inbound port is needed. Run as an unprivileged service user. SPECTRE does not provision this host for you.</p>
                <div className="flex flex-wrap gap-2">
                  {[["agent.py", "download-agent-py"], ["README.md", "download-agent-readme"], ["spectre-scanner.service", "download-agent-service"]].map(([f, id]) => (
                    <a key={f} href={`/api/v1/live/agent/${f}`} download={f} data-testid={id} className="inline-flex items-center gap-1 rounded border border-primary/40 px-2 py-1 font-mono text-[11px] text-primary hover:bg-primary/10"><Download className="h-3 w-3" />{f}</a>
                  ))}
                </div>
                <pre className="scrollbar-thin overflow-auto rounded border border-border bg-background/80 p-2 font-mono text-[10.5px] text-foreground" data-testid="text-agent-command">{`export SPECTRE_API_URL="${origin}/api"
export SPECTRE_AGENT_TOKEN="<paste one-time token>"
export SPECTRE_ALLOWED_IPS="203.0.113.10"   # exact approved public IPv4s, comma-separated
python3 agent.py`}</pre>
                <p>SPECTRE_API_URL above is this current origin. If it is a development URL it is temporary; switch to your stable published endpoint later. SPECTRE_ALLOWED_IPS is a local allowlist on the agent and must include the target IP or the agent refuses the job. The agent accepts no arbitrary commands or options.</p>
              </div>
            </details>
          </div>
        </Panel>)}

        {/* Scopes */}
        <Panel kicker="Step 2" title="Approved Public Scopes" className="xl:col-span-6">
          <div className="space-y-3 text-xs">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Public IPv4" hint={ipErr && <span className="text-destructive" data-testid="error-target-ip">{ipErr}</span>}>
                <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="Single public address" data-testid="input-target-ip" className={cn(inputCls, ipErr && "border-destructive")} />
              </Field>
              <Field label="Label"><input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="Corporate VPN gateway" data-testid="input-target-label" className={inputCls} /></Field>
            </div>
            <Field label="Authorization Reference" hint={ref && ref.trim().length < 5 && <span className="text-destructive">Minimum 5 characters</span>}>
              <input value={ref} maxLength={1000} onChange={(e) => setRef(e.target.value)} placeholder="Engagement letter, change ticket or asset register ID" data-testid="input-target-reference" className={inputCls} />
            </Field>
            <Field label="Scope Expiry" hint={expErr ? <span className="text-destructive">{expErr}</span> : <span className="text-muted-foreground">Entered in your local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}); sent as UTC ISO. Max 30 days.</span>}>
              <input type="datetime-local" value={exp} onChange={(e) => setExp(e.target.value)} data-testid="input-target-expiry" className={cn(inputCls, expErr && "border-destructive")} />
            </Field>
            <label className="flex items-start gap-2 rounded border border-accent/25 bg-accent/5 p-2.5">
              <Checkbox checked={owns} onCheckedChange={(c) => setOwns(c === true)} data-testid="checkbox-target-authorized" className="mt-0.5" />
              <span className="text-[11px] leading-relaxed">I own this address or hold written permission from its owner to perform port and service discovery against it.</span>
            </label>
            <Btn onClick={submitTarget} disabled={!canApprove} data-testid="button-approve-target" className="w-full border-primary bg-primary py-2 text-primary-foreground"><Target className="h-3.5 w-3.5" />{approve.isPending ? "Approving" : scopeFull ? "Scope Limit Reached (10)" : "Approve Scope"}</Btn>
            {targets.length === 0 ? <EmptyState title="No Scopes Approved" body="Approve a single public IPv4 address you are authorized to assess." /> : (
              <ul className="scrollbar-thin max-h-56 divide-y divide-border/50 overflow-auto rounded border border-border/60">
                {targets.map((t) => { const expired = new Date(t.expiresAt).getTime() <= now; return (
                  <li key={t.id} className="flex items-center gap-2 px-3 py-2" data-testid={`row-target-${t.id}`}>
                    <div className="min-w-0 flex-1"><div className="font-mono text-[12px]">{t.ip} <span className="text-muted-foreground">· {t.label}</span></div><div className="truncate font-mono text-[10px] text-muted-foreground">ref {t.authorizationReference} · until {fmt(t.expiresAt)}</div></div>
                    <span className={cn("font-mono text-[10px] uppercase", t.revoked ? "text-muted-foreground" : expired ? "text-accent" : "text-primary")}>{t.revoked ? "Revoked" : expired ? "Expired" : "Active"}</span>
                    {!t.revoked && <Btn data-testid={`button-revoke-target-${t.id}`} onClick={() => setConfirm({ kind: "target", id: t.id, label: t.ip })} className="border-destructive/40 text-destructive hover:bg-destructive/10"><Trash2 className="h-3.5 w-3.5" /></Btn>}
                  </li>
                ); })}
              </ul>
            )}
          </div>
        </Panel>

        {/* New job */}
        <Panel kicker="Step 3" title={emb ? "Run Embedded Check" : "Launch Live Job"} className="min-w-0 xl:col-span-4">
          <fieldset disabled={!canWrite || (emb ? createEmb.isPending : createJob.isPending)} className="min-w-0 space-y-3 text-xs disabled:opacity-70">
            <Field label="Approved Scope">
              <select value={tId} onChange={(e) => setTId(e.target.value)} data-testid="select-job-target" className={inputCls}>
                <option value="">Select scope</option>
                {activeTargets.map((t) => <option key={t.id} value={t.id}>{t.ip} · {t.label}</option>)}
              </select>
            </Field>
            {!emb && <Field label="Agent" hint={jAgent && !jAgentOk && <span className="text-destructive">{busyAgents.has(jAgent.id) ? "Agent already has an active job" : `Agent is ${STATE_LABEL[agentState(jAgent, now)]}; needs a poll within 60s`}</span>}>
              <select value={aId} onChange={(e) => setAId(e.target.value)} data-testid="select-job-agent" className={inputCls}>
                <option value="">Select agent</option>
                {agents.filter((a) => !a.revoked).map((a) => <option key={a.id} value={a.id}>{a.name} · {STATE_LABEL[agentState(a, now)]}</option>)}
              </select>
            </Field>}
            <div className={cn("grid gap-1 rounded border border-border bg-background/50 p-0.5 font-mono text-[11px]", emb ? "grid-cols-3" : "grid-cols-2")}>
              {(emb ? (["web", "standard", "custom"] as const) : (["web", "standard"] as const)).map((p) => <button type="button" key={p} onClick={() => setProfile(p)} data-testid={`button-profile-${p}`} className={cn("rounded-sm py-1.5 uppercase tracking-wider", profile === p ? "bg-secondary text-primary" : "text-muted-foreground")}>{p === "web" ? "Web (4)" : p === "standard" ? "Standard (25)" : "Custom"}</button>)}
            </div>
            {profile !== "custom" ? <p className="font-mono text-[10px] leading-relaxed text-muted-foreground" data-testid="text-profile-ports">TCP {PROFILES[profile].join(", ")} · presets are TCP only</p> : (
              <div className="space-y-2" data-testid="panel-custom-ports">
                <Field label="TCP Ports" hint={cv.tcpError ? <span className="text-destructive" data-testid="error-tcp-ports">{cv.tcpError}</span> : <span className="text-muted-foreground">Comma list or ranges, e.g. 22,80,8000-8010</span>}>
                  <input value={tcpText} onChange={(e) => setTcpText(e.target.value)} placeholder="22,443,8000-8005" data-testid="input-tcp-ports" className={cn(inputCls, cv.tcpError && "border-destructive")} />
                </Field>
                <Field label="UDP Ports" hint={cv.udpError ? <span className="text-destructive" data-testid="error-udp-ports">{cv.udpError}</span> : <span className="text-muted-foreground">Comma list or ranges, e.g. 53,123,500-501</span>}>
                  <input value={udpText} onChange={(e) => setUdpText(e.target.value)} placeholder="53,123" data-testid="input-udp-ports" className={cn(inputCls, cv.udpError && "border-destructive")} />
                </Field>
                <p className={cn("font-mono text-[10px]", cv.error && !cv.tcpError && !cv.udpError ? "text-destructive" : "text-muted-foreground")} data-testid="text-custom-count">{cv.tcp.length} TCP + {cv.udp.length} UDP = {cv.total}/{MAX_CUSTOM_CHECKS} checks after de-duplication{cv.error && !cv.tcpError && !cv.udpError ? ` · ${cv.error}` : ""}. The same port on TCP and UDP counts as two checks.</p>
              </div>
            )}
            {emb
              ? <p className="text-[11px] leading-relaxed text-muted-foreground" data-testid="text-embedded-method">Sequential TCP connect, 1.5s timeout per port, from the hosting environment. TLS handshake on 443/8443 verified against the IP identity. Custom UDP checks send a single minimal empty datagram: response is open, no response is open|filtered (uncertain), refusal is closed. No application payloads, no DNS, no Nmap, no scripts, no fingerprinting. Max {MAX_CUSTOM_CHECKS} checks, hard limit 75 seconds.</p>
              : <p className="text-[11px] text-muted-foreground">TCP connect with light service detection. No scripts, no UDP, no brute force. Hard limit 180 seconds.</p>}
            <label className="flex items-start gap-2 rounded border border-accent/25 bg-accent/5 p-2.5">
              <Checkbox checked={perm} onCheckedChange={(c) => setPerm(c === true)} data-testid="checkbox-job-authorized" className="mt-0.5" />
              <span className="text-[11px] leading-relaxed">I explicitly authorize this live scan of the selected address now.</span>
            </label>
            <Btn onClick={submitJob} disabled={!canRun} data-testid="button-launch-live-job" className="w-full border-primary bg-primary py-2 text-primary-foreground"><Play className="h-3.5 w-3.5" />{emb ? (createEmb.isPending ? "Starting" : "Run Embedded Check") : createJob.isPending ? "Queuing" : "Launch Live Job"}</Btn>
            {emb && (
              <div className="space-y-1 text-[11px]" data-testid="text-embedded-caps">
                {!st.isLoading && !runtimeOk && <p className="text-destructive" data-testid="text-embedded-unavailable">Runtime unavailable: {st.isError ? errMsg(st.error) : st.data?.message}</p>}
                {embActive && <p className="text-accent">You already have an active embedded check. Limit: one per owner.</p>}
                {cooldown && !embActive && <p className="text-accent">One start per minute per owner. The server will reject starts within 60s of your last check.</p>}
                <p className="text-muted-foreground">Caps: 2 embedded checks globally, 1 per owner, 1 start per minute. If the global cap is reached the server rejects with 409.</p>
              </div>
            )}
            {!emb && liveAgents.length === 0 && <p className="text-[11px] text-accent" data-testid="text-no-online-agent">No agent is online. Jobs cannot be queued until an agent has polled within the last 60 seconds.</p>}
          </fieldset>
        </Panel>

        {emb && <EmbeddedNetMapper jobs={jobs} selectedId={current?.id} onSelect={setSelJob} />}

        {/* Jobs */}
        <Panel kicker="Evidence" title={emb ? "Key Results" : "Live Jobs"} className={emb ? "xl:col-span-12" : "xl:col-span-8"} bodyClass="p-0">
          {emb && current?.status === "completed" && <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
            <span className="text-xs text-muted-foreground">Generate From This Scan:</span>
            <Link href={`/reports?source=live&scan=${encodeURIComponent(current.id)}&kind=executive`} className="rounded border border-primary px-3 py-2 text-xs text-primary">Executive Summary</Link>
            <Link href={`/reports?source=live&scan=${encodeURIComponent(current.id)}&kind=technical`} className="rounded border border-primary px-3 py-2 text-xs text-primary">Technical Report</Link>
          </div>}
          {jobs.length === 0 ? <EmptyState title={emb ? "No Embedded Checks" : "No Live Jobs"} body={emb ? "Embedded checks persist here; reload or leave and return to see their final state." : "Jobs appear here with their true server status once queued."} /> : (
            <div className="grid md:grid-cols-[230px_1fr]">
              <ul className="scrollbar-thin max-h-[520px] divide-y divide-border/50 overflow-auto border-b border-border/60 md:border-b-0 md:border-r">
                {jobs.map((j) => (
                  <li key={j.id}><button onClick={() => setSelJob(j.id)} data-testid={`row-live-job-${j.id}`} className={cn("w-full px-3 py-2 text-left hover:bg-muted/30", current?.id === j.id && "bg-muted/40")}>
                    <div className="flex justify-between font-mono text-xs"><span>{j.ip}</span><span className={cn("uppercase", JOB_TONE[j.status])}>{j.status}</span></div>
                    <div className="font-mono text-[10px] text-muted-foreground">{j.profile} · {fmt(j.createdAt)}</div>
                  </button></li>
                ))}
              </ul>
              {current && <JobDetail j={current} target={targets.find((t) => t.id === current.targetId)} agent={agents.find((a) => a.id === current.agentId)} onCancel={() => doCancel(current.id)} cancelling={cancelJob.isPending} />}
            </div>
          )}
        </Panel>

        {emb && <EmbeddedGuidance jobs={jobs} current={current} onSelect={setSelJob} />}

        {/* Audit */}
        <Panel kicker="Activity" title="Owner Audit Trail" className="xl:col-span-12" bodyClass="p-0">
          <p className="border-b border-border/50 px-4 py-2 text-[11px] text-muted-foreground">Application activity log for your account (owner id {userId}). Useful context, not an immutable compliance audit.</p>
          {data.audit.length === 0 ? <EmptyState title="No Events Yet" body="Registrations, approvals, jobs and revocations are logged here." /> : (
            <ul className="scrollbar-thin max-h-60 divide-y divide-border/40 overflow-auto font-mono text-[11px]" data-testid="list-live-audit">
              {[...data.audit].sort((a, b) => b.at.localeCompare(a.at)).map((e, i) => (
                <li key={i} className="grid grid-cols-[150px_140px_1fr] gap-2 px-4 py-1.5"><span className="text-muted-foreground">{fmt(e.at)}</span><span className="truncate text-primary">{e.actor}</span><span className="break-words">{e.action}</span></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" />{emb ? "Embedded results are real network observations, kept separate from demo scans. " : ""}Live results are kept separate from demo scans and executive records. No CVEs or findings are generated from them.</div>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="border-destructive/40 bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{confirm?.kind === "agent" ? `Revoke Agent ${confirm.label}?` : confirm?.kind === "target" ? `Revoke Scope ${confirm?.label}?` : "Stop All Live Scans?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "agent" && "Its token is disabled immediately and any of its queued or running jobs are cancelled. This cannot be undone; register a new agent to resume."}
              {confirm?.kind === "target" && "The scope is removed and active jobs against this address are cancelled. New jobs will be refused."}
              {confirm?.kind === "stopall" && `Sends a real cancellation request for all ${allActive.length} of your active live jobs across both engines (external agent and embedded). External jobs stop on the agent's next poll; embedded jobs become terminal once the local process stops.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-live-confirm">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirm} data-testid="button-confirm-live-action" className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const Stat = ({ k, v }: { k: string; v: string }) => <div><div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{k}</div><div className="font-mono text-sm">{v}</div></div>;

function JobDetail({ j, target, agent, onCancel, cancelling }: { j: LiveJob; target?: PublicTarget; agent?: Scanner; onCancel: () => void; cancelling: boolean }) {
  const open = j.services.filter((s) => s.state === "open");
  const canCancel = j.status === "queued" || j.status === "running";
  const e = isEmb(j);
  const elapsed = j.startedAt && j.finishedAt ? `${((new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime()) / 1000).toFixed(2)}s` : "--";
  const meta: [string, string][] = e ? [["Engine", "Embedded (hosting env)"], ["Profile", `${j.profile} · ${pairsOf(j).length} checks`], ["Host Status", j.hostStatus ?? "--"], ["Measured Duration", elapsed], ["Created", fmt(j.createdAt)], ["Started", fmt(j.startedAt)], ["Finished", fmt(j.finishedAt)], ["Runtime", j.agentVersion ?? "--"]] : [["Engine", "External Agent"], ["Agent", agent?.name ?? j.agentId], ["Profile", `${j.profile} · ${j.ports.length} ports`], ["Host Status", j.hostStatus ?? "--"], ["Created", fmt(j.createdAt)], ["Started", fmt(j.startedAt)], ["Finished", fmt(j.finishedAt)], ["Agent Version", j.agentVersion ?? "--"], ["Nmap", j.nmapVersion ?? "--"]];
  return (
    <div className="min-w-0 p-4" data-testid={`detail-live-job-${j.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-base">{j.ip}</span>
        <span className="rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary" data-testid="badge-job-engine">Real · {e ? "Embedded" : "External Agent"}</span>
        <span className={cn("rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase", JOB_TONE[j.status])} data-testid="status-live-job">{j.status}</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {canCancel && <Btn onClick={onCancel} disabled={cancelling} data-testid="button-cancel-live-job" className="border-destructive/50 text-destructive hover:bg-destructive/10"><X className="h-3.5 w-3.5" />Cancel Job</Btn>}
          <Btn data-testid="button-download-report-txt" className="border-border hover:border-primary/40" onClick={() => download(`spectre-live-${j.id}.txt`, reportText(j, target, agent), "text/plain")}><FileText className="h-3.5 w-3.5" />Report TXT</Btn>
          <Btn data-testid="button-download-report-json" className="border-border hover:border-primary/40" onClick={() => download(`spectre-live-${j.id}.json`, JSON.stringify({ job: j, target, agent: agent && { id: agent.id, name: agent.name } }, null, 2), "application/json")}><Download className="h-3.5 w-3.5" />JSON</Btn>
          {j.rawEvidence && <Btn data-testid="button-download-raw-evidence" className="border-border hover:border-primary/40" onClick={() => download(`spectre-embedded-${j.id}-evidence.json`, j.rawEvidence ?? "", "application/json")}><Download className="h-3.5 w-3.5" />Raw Evidence JSON</Btn>}
          {j.rawXml && <Btn data-testid="button-download-raw-xml" className="border-border hover:border-primary/40" onClick={() => download(`spectre-live-${j.id}-nmap.xml.txt`, j.rawXml ?? "", "text/plain")}><Download className="h-3.5 w-3.5" />Raw XML</Btn>}
        </div>
      </div>
      {j.status === "cancelling" && <p className="mt-2 text-[11px] text-accent">Cancellation requested; {e ? "terminal once the local process has stopped." : "awaiting agent acknowledgement."}</p>}
      {j.status === "queued" && <p className="mt-2 text-[11px] text-muted-foreground">{e ? "Queued for the embedded runtime. No progress is estimated." : "Waiting for the agent to lease this job. No progress is estimated."}</p>}
      {j.error && <p className="mt-2 rounded border border-destructive/40 bg-destructive/10 p-2 font-mono text-[11px] text-destructive" data-testid="text-live-job-error">{j.error}</p>}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] sm:grid-cols-4">
        {meta.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</dt><dd className="truncate">{v}</dd></div>)}
      </dl>
      <div className="mt-2 break-all font-mono text-[10px] text-muted-foreground" data-testid="text-evidence-sha">SHA-256 {j.evidenceSha256 ?? "not yet available"}</div>
      {e ? <EmbeddedResultTabs j={j} /> : <table className="mt-3 w-full text-left font-mono text-xs">
        <thead className="text-[10px] uppercase text-muted-foreground"><tr className="border-b border-border/60"><th className="py-1.5">Port</th><th>State</th><th>Service</th><th>Product / Version</th><th>Reason</th>{e && <th>Detail</th>}{e && <th className="text-right">Elapsed</th>}</tr></thead>
        <tbody>{j.services.map((s) => (
          <tr key={`${protoOf(s)}-${s.port}`} className="border-b border-border/30" data-testid={`row-live-service-${s.port}`}><td className="py-1">{s.port}/{protoOf(s)}</td><td className={s.state === "open" ? "text-primary" : s.state === "timeout" || s.state === "error" ? "text-accent" : "text-muted-foreground"}>{s.state}{(s.state === "timeout" || s.state === "error") && " (inconclusive)"}</td><td>{s.service}</td><td className="text-muted-foreground">{[s.product, s.version].filter(Boolean).join(" ") || "--"}</td><td className="text-muted-foreground">{s.reason ?? "--"}</td>{e && <td className="max-w-[220px] break-words text-[10px] text-muted-foreground">{s.detail ?? "--"}</td>}{e && <td className="text-right text-muted-foreground">{s.elapsedMs != null ? `${s.elapsedMs}ms` : "--"}</td>}</tr>
        ))}</tbody>
      </table>}
      {j.status === "completed" && open.length === 0 && <p className="mt-2 text-[11px] text-muted-foreground">No open ports in this profile. {e ? "This does not prove the host is down; timeouts and errors are inconclusive and may reflect filtering or egress limits of the hosting environment." : "This does not prove the host is down; probes skip host discovery (-Pn) and may be filtered."}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">A product or version match is an inventory observation, not a confirmed vulnerability.</p>
      {e ? (j.rawEvidence ? (
        <details className="mt-3"><summary className="cursor-pointer text-[11px] text-primary">Raw Evidence JSON (displayed as plain text)</summary>
          <pre className="scrollbar-thin mt-1 max-h-64 overflow-auto rounded border border-border bg-background/80 p-2 font-mono text-[10px]" data-testid="text-raw-evidence">{prettyJson(j.rawEvidence)}</pre></details>
      ) : j.status === "completed" && <p className="mt-2 text-[11px] text-muted-foreground">Raw evidence is not included in this response.</p>) : j.rawXml ? (
        <details className="mt-3"><summary className="cursor-pointer text-[11px] text-primary">Raw Nmap XML (displayed as plain text)</summary>
          <pre className="scrollbar-thin mt-1 max-h-64 overflow-auto rounded border border-border bg-background/80 p-2 font-mono text-[10px]" data-testid="text-raw-xml">{j.rawXml}</pre></details>
      ) : j.status === "completed" && <p className="mt-2 text-[11px] text-muted-foreground">Raw XML is not included in this response.</p>}
    </div>
  );
}

function prettyJson(raw: string) { try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; } }

function RuntimePanel({ q }: { q: { data?: GetEmbeddedStatus200; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown } }) {
  const d = q.data;
  return (
    <Panel kicker="Step 1" title="Embedded Runtime" className="xl:col-span-6">
      <div className="space-y-3 text-xs" data-testid="panel-embedded-runtime">
        {q.isLoading ? <Skel className="h-16" /> : q.isError ? (
          <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-destructive" data-testid="status-embedded-runtime">Runtime Status Unavailable: {errMsg(q.error)} <button className="ml-2 underline" onClick={() => q.refetch()}>Retry</button></div>
        ) : (
          <div className={cn("flex items-start gap-3 rounded border p-3", d?.available ? "border-primary/40 bg-primary/5" : "border-destructive/50 bg-destructive/10")} data-testid="status-embedded-runtime">
            <Cpu className={cn("mt-0.5 h-5 w-5", d?.available ? "text-primary" : "text-destructive")} />
            <div><div className={cn("font-mono text-[11px] uppercase tracking-wider", d?.available ? "text-primary" : "text-destructive")}>{d?.available ? "Runtime Ready" : "Runtime Unavailable"} · {d?.engine ?? "--"}</div><p className="mt-1 text-muted-foreground">{d?.message}</p></div>
          </div>
        )}
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <li>Readiness reflects the local runtime only. It says nothing about whether a target is reachable.</li>
          <li>Connections originate from this application's hosting environment. Private or internal networks cannot be reached.</li>
          <li>No agent registration, token, download or external scanner server is needed.</li>
          <li>Open, closed, open|filtered, timeout and error are reported as observed. UDP silence is open|filtered (uncertain). Timeouts and socket errors are inconclusive, never proof of closure and never vulnerabilities.</li>
        </ul>
      </div>
    </Panel>
  );
}
