import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateScan, getGetWorkspaceQueryKey } from "@workspace/api-client-react";
import type { Scan } from "@workspace/api-client-react";
import { Play, ShieldCheck, Crosshair, Cpu, ArrowRight } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { LiveDiscovery } from "@/components/live-discovery/live-discovery";
import { PageHead } from "@/components/shell";
import { Panel, SevBadge, PageSkeleton, ErrorState, EmptyState, Topology, Illustrative, RiskBar } from "@/components/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace, SPEEDS, ipInScope, assetsForScan, service, hopsFor, isActive, fmtTime, scenario } from "@/lib/sentinel";
import { cn } from "@/lib/utils";
import { AttackPathWalkthrough } from "@/components/attack-path-walkthrough";
import { ExposureRadar } from "@/components/exposure-radar";

type ScanType = "single" | "subnet" | "ports";
type Speed = "T1" | "T2" | "T3" | "T4" | "T5";

export default function Scans() {
  const search = useSearch();
  const [, nav] = useLocation();
  const mode = new URLSearchParams(search).get("mode");
  const emb = mode === "embedded";
  const demo = !emb;
  useEffect(() => {
    if (mode === "live") nav("/scans", { replace: true });
  }, [mode, nav]);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 md:px-5" role="tablist" aria-label="Scan mode">
        <button role="tab" aria-selected={demo} onClick={() => nav("/scans")} data-testid="tab-mode-demo" className={cn("rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider", demo ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted-foreground hover:text-foreground")}>Demo Scans</button>
        <button role="tab" aria-selected={emb} onClick={() => nav("/scans?mode=embedded")} data-testid="tab-mode-embedded" className={cn("rounded border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider", emb ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>INTELLIGENT VAPT SCANS</button>
        <span className="font-mono text-[10px] text-muted-foreground">{emb ? "Real TCP and UDP checks from the hosting environment, no agent" : "Simulated, no packets sent"}</span>
      </div>
      {emb ? <><PageHead kicker="LIVE ASSESSMENTS" title="INTELLIGENT VAPT SCANS" sub="Real TCP connect and minimal UDP checks of approved public IPv4 scopes, run from this application's hosting environment. No agent required. Inventory only; nothing is exploited." /><LiveDiscovery execution="embedded" /></> : <DemoScans />}
    </div>
  );
}

function DemoScans() {
  const { data: ws, isLoading, isError, refetch } = useWorkspace();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateScan();
  const [type, setType] = useState<ScanType>("subnet");
  const [target, setTarget] = useState("192.168.10.0/24");
  const [ports, setPorts] = useState("1-1024");
  const [speed, setSpeed] = useState<Speed>("T3");
  const [auth, setAuth] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<"ports" | "analysis" | "paths" | "hops">(() => { const t = new URLSearchParams(window.location.search).get("tab"); return t === "paths" || t === "analysis" || t === "hops" ? t : "ports"; });

  useEffect(() => { if (type === "subnet") setTarget("192.168.10.0/24"); else if (target.includes("/")) setTarget("192.168.10.20"); }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const validTarget = type === "subnet" ? target === "192.168.10.0/24" : ipInScope(target) || (type === "ports" && target === "192.168.10.0/24");
  const validPorts = /^(\d{1,5}(-\d{1,5})?)(,\s*\d{1,5}(-\d{1,5})?)*$/.test(ports.trim()) || (type !== "ports" && ports.trim() === "");
  const canRun = validTarget && validPorts && auth && !create.isPending;

  const scans = useMemo(() => [...(ws?.scans ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [ws]);
  const current: Scan | undefined = scans.find((s) => s.id === sel) ?? scans[0];

  const hostsMemo = useMemo(() => (current && ws ? assetsForScan(current, ws.assets) : []), [current, ws]);
  const findingsMemo = useMemo(() => { const ids = new Set(hostsMemo.map((h) => h.id)); return (ws?.vulnerabilities ?? []).filter((v) => ids.has(v.assetId)).sort((a, b) => b.score - a.score); }, [hostsMemo, ws]);

  if (isLoading) return <PageSkeleton />;
  if (isError || !ws) return <ErrorState onRetry={() => refetch()} />;

  const submit = () => {
    create.mutate({ data: { target: target.trim(), type, speed, ports: ports.trim(), authorized: auth } }, {
      onSuccess: (s) => { setSel(s.id); toast({ title: "Demo scan queued", description: `${s.target} · ${s.speed}. Simulated, no packets sent.` }); qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() }); },
      onError: (e) => toast({ title: "Scan rejected", description: (e as Error)?.message ?? "Target must be inside 192.168.10.0/24.", variant: "destructive" }),
    });
  };

  const hosts = hostsMemo;
  const running = current ? isActive(current) : false;
  const findings = findingsMemo;
  const assetOf = (id: string) => ws.assets.find((a) => a.id === id);

  return (
    <div>
      <PageHead kicker="Assessment" title="Demo Scan Console" sub="Simulated discovery against the fixed demonstration range 192.168.10.0/24. Results are derived from workspace assets; no network traffic is generated."
        right={<Link href="/simulations" data-testid="link-red-team" className="flex items-center gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20"><Crosshair className="h-3.5 w-3.5" />Red Team simulations</Link>} />
      <div className="grid gap-3 px-4 md:px-5 xl:grid-cols-12">
        <div className="xl:col-span-12"><ExposureRadar /></div>
        <div className="space-y-3 xl:col-span-4">
          <Panel kicker="New Job" title="Configure Demo Scan">
            <div className="space-y-3 text-xs">
              <div className="rounded border border-primary/35 bg-primary/5 p-2.5" data-testid="panel-embedded-entry">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-primary"><Cpu className="h-3.5 w-3.5" />Need Real Evidence Instead?</div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">This form is a simulation. Embedded Live Checks send real TCP connects to your approved public IPs from the hosting environment. Sign-in required, no agent needed.</p>
                <Link href="/scans?mode=embedded" data-testid="link-embedded-live-checks" className="mt-2 flex items-center justify-center gap-1.5 rounded border border-primary/60 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10">Start Embedded Live Checks<ArrowRight className="h-3.5 w-3.5" /></Link>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-accent">Simulated Demo Job</div>
              <div className="grid grid-cols-3 gap-1 rounded border border-border bg-background/50 p-0.5 font-mono text-[11px]">
                {(["single", "subnet", "ports"] as const).map((t) => (
                  <button key={t} onClick={() => setType(t)} data-testid={`button-type-${t}`} className={cn("rounded-sm py-1.5 uppercase tracking-wider", type === t ? "bg-secondary text-primary" : "text-muted-foreground")}>{t === "single" ? "Single IP" : t === "subnet" ? "Subnet" : "Port range"}</button>
                ))}
              </div>
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Target</span>
                <input value={target} onChange={(e) => setTarget(e.target.value)} disabled={type === "subnet"} data-testid="input-target"
                  className={cn("mt-1 w-full rounded border bg-background/60 px-3 py-2 font-mono text-sm outline-none focus:border-primary", validTarget ? "border-input" : "border-destructive")} />
                {!validTarget && <span className="mt-1 block text-[11px] text-destructive">Outside authorized demo scope 192.168.10.0/24</span>}
              </label>
              <label className="block">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Ports</span>
                <input value={ports} onChange={(e) => setPorts(e.target.value)} placeholder="22,80,443 or 1-1024" data-testid="input-ports"
                  className={cn("mt-1 w-full rounded border bg-background/60 px-3 py-2 font-mono text-sm outline-none focus:border-primary", validPorts ? "border-input" : "border-destructive")} />
              </label>
              <div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Timing template</span>
                <div className="mt-1 grid grid-cols-5 gap-1">
                  {SPEEDS.map((s) => (
                    <button key={s.v} onClick={() => setSpeed(s.v)} data-testid={`button-speed-${s.v}`} title={s.d}
                      className={cn("rounded border py-1.5 text-center transition-colors", speed === s.v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40")}>
                      <div className="font-mono text-xs font-semibold">{s.v}</div><div className="text-[9px]">{s.name}</div>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{SPEEDS.find((s) => s.v === speed)?.d} (simulated pacing)</p>
              </div>
              <label className="flex items-start gap-2 rounded border border-accent/25 bg-accent/5 p-2.5">
                <Checkbox checked={auth} onCheckedChange={(c) => setAuth(c === true)} data-testid="checkbox-authorized" className="mt-0.5" />
                <span className="text-[11px] leading-relaxed">I confirm this demo job is within the authorized assessment scope 192.168.10.0/24 and understand it is a simulation only.</span>
              </label>
              <button onClick={submit} disabled={!canRun} data-testid="button-launch-scan"
                className="flex w-full items-center justify-center gap-2 rounded bg-primary py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40">
                <Play className="h-4 w-4" /> {create.isPending ? "Queuing" : "Launch demo scan"}
              </button>
            </div>
          </Panel>

          <Panel kicker="History" title="Demo Jobs" bodyClass="p-0">
            {scans.length === 0 ? <EmptyState title="No Scans Yet" body="Configure and launch a simulated scan above." /> : (
              <ul className="scrollbar-thin max-h-[320px] divide-y divide-border/50 overflow-auto">
                {scans.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => setSel(s.id)} data-testid={`row-scan-${s.id}`} className={cn("w-full px-4 py-2 text-left hover:bg-muted/30", current?.id === s.id && "bg-muted/40")}>
                      <div className="flex items-center justify-between font-mono text-xs"><span>{s.target}</span><span className={cn("uppercase", isActive(s) ? "text-primary" : s.status === "completed" ? "text-muted-foreground" : "text-accent")}>{s.status}</span></div>
                      <div className="mt-1 h-0.5 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-[width] duration-700" style={{ width: `${s.progress}%` }} /></div>
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground">{s.type} · {s.speed} · {s.ports || "default"} · {s.findings} findings · {fmtTime(s.createdAt)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-3 xl:col-span-8">
          <Panel kicker="NetMapper" title={current ? `Topology · ${current.target}` : "Topology"} action={running ? <span className="font-mono text-[11px] text-primary">{current?.progress}% simulated</span> : undefined}>
            {hosts.length ? <Topology assets={hosts} vulns={ws.vulnerabilities} scanning={running} height={320} /> : <EmptyState title="No Hosts In Selection" body="This job's target has no matching demo assets. Try the full 192.168.10.0/24 subnet." />}
          </Panel>

          <Panel kicker="Results" title={current ? `Job ${current.id.slice(0, 8)} · ${hosts.length} host(s)` : "Results"} bodyClass="p-0"
            action={<div className="flex flex-wrap justify-end gap-1 font-mono text-[10px]">{(["ports", "analysis", "paths", "hops"] as const).map((t) => <button key={t} onClick={() => setTab(t)} data-testid={`tab-${t}`} className={cn("rounded-sm px-2 py-1 uppercase", tab === t ? "bg-secondary text-primary" : "text-muted-foreground")}>{t === "paths" ? "MITRE Attack Paths" : t}</button>)}</div>}>
            {!current ? <EmptyState title="Nothing Selected" body="Launch or select a demo job to view results." /> : running && current.progress < 30 ? (
              <div className="p-6 text-center font-mono text-xs text-muted-foreground">Simulating host discovery... {current.progress}%</div>
            ) : (
              <div className="scrollbar-thin max-h-[640px] overflow-auto">
                {tab === "ports" && (
                  <table className="w-full text-left font-mono text-xs">
                    <thead className="sticky top-0 bg-card text-[10px] uppercase text-muted-foreground"><tr className="border-b border-border/60"><th className="px-4 py-2">Host</th><th>Hostname</th><th>Port</th><th>State</th><th>Service</th><th className="pr-4">Proto</th></tr></thead>
                    <tbody>
                      {hosts.flatMap((h) => h.ports.map((p) => {
                        const [svc, proto] = service(p);
                        return (
                          <tr key={h.id + p} className="border-b border-border/30 hover:bg-muted/30" data-testid={`row-port-${h.id}-${p}`}>
                            <td className="px-4 py-1.5">{h.ip}</td><td className="text-muted-foreground">{h.hostname}</td><td>{p}</td><td className="text-primary">open</td><td>{svc}</td><td className="pr-4 text-muted-foreground">{proto}</td>
                          </tr>
                        );
                      }))}
                    </tbody>
                  </table>
                )}
                {tab === "ports" && hosts.every((h) => h.ports.length === 0) && <EmptyState title="No Open Ports In Range" body="The selected port range excludes all ports on matching demo assets." />}
                {tab === "ports" && <div className="px-4 py-2"><Illustrative>Service names inferred from port registry</Illustrative></div>}
                {tab === "analysis" && (
                  <div className="divide-y divide-border/40">
                    {findings.length === 0 && <EmptyState title="No Findings" body="No vulnerabilities are linked to these hosts." />}
                    {findings.map((v) => (
                      <div key={v.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_1.2fr]">
                        <div><div className="flex items-center gap-2"><SevBadge sev={v.severity} /><span className="font-mono text-[11px] text-muted-foreground">{assetOf(v.assetId)?.hostname}</span></div><div className="mt-1 text-[13px] font-medium">{v.title}</div><div className="mt-1"><RiskBar value={Math.round(v.score * 10)} /></div></div>
                        <div className="text-xs text-muted-foreground"><div><span className="text-foreground/80">Scenario. </span>{scenario(v, assetOf(v.assetId))}</div><div className="mt-1"><span className="text-primary">Recommendation. </span>{v.recommendation}</div></div>
                      </div>
                    ))}
                  </div>
                )}
                {tab === "paths" && current && <AttackPathWalkthrough scanId={current.id} hosts={hosts} findings={findings} />}
                {tab === "hops" && (
                  <div className="space-y-3 p-4">
                    {hosts.map((h) => (
                      <div key={h.id} className="font-mono text-[11px]">
                        <div className="mb-1 text-foreground">{h.hostname}</div>
                        <div className="flex flex-wrap items-center gap-1">
                          {hopsFor(h).map((hp, i) => <span key={i} className="flex items-center gap-1"><span className="rounded-sm border border-border px-2 py-0.5">{i + 1} {hp.ip} <span className="text-muted-foreground">{hp.rtt.toFixed(2)}ms</span></span>{i < 2 && <span className="text-primary">-&gt;</span>}</span>)}
                        </div>
                      </div>
                    ))}
                    <Illustrative>Hops and RTT are illustrative</Illustrative>
                  </div>
                )}
              </div>
            )}
          </Panel>
          <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> No exploitation or attack execution is performed by this workspace.</div>
        </div>
      </div>
    </div>
  );
}
