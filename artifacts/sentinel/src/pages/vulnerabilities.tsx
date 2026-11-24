import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateRemediation, getGetWorkspaceQueryKey } from "@workspace/api-client-react";
import { Search, Check, X, RotateCcw } from "lucide-react";
import { PageHead } from "@/components/shell";
import { Panel, SevBadge, PageSkeleton, ErrorState, EmptyState, Topology, Illustrative } from "@/components/kit";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace, sevColor, scenario, tactic, service } from "@/lib/sentinel";
import { cn } from "@/lib/utils";

const SEVS = ["all", "critical", "high", "medium", "low"];

export default function Vulnerabilities() {
  const { data: ws, isLoading, isError, refetch } = useWorkspace();
  const qc = useQueryClient();
  const { toast } = useToast();
  const upd = useUpdateRemediation();
  const [q, setQ] = useState("");
  const [sev, setSev] = useState("all");
  const [kevOnly, setKevOnly] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const list = useMemo(() => {
    if (!ws) return [];
    const t = q.toLowerCase();
    return ws.vulnerabilities.filter((v) => {
      const a = ws.assets.find((x) => x.id === v.assetId);
      const hay = `${v.title} ${v.cve} ${v.technique} ${a?.hostname} ${a?.ip} ${a?.os} ${a?.ports.join(" ")}`.toLowerCase();
      return (!t || hay.includes(t)) && (sev === "all" || v.severity.toLowerCase() === sev) && (!kevOnly || v.kev);
    }).sort((a, b) => b.score - a.score);
  }, [ws, q, sev, kevOnly]);

  if (isLoading) return <PageSkeleton />;
  if (isError || !ws) return <ErrorState onRetry={() => refetch()} />;
  const v = list.find((x) => x.id === sel) ?? list[0];
  const asset = v ? ws.assets.find((a) => a.id === v.assetId) : undefined;

  const decide = (id: string, status: "approved" | "rejected" | "pending") => {
    upd.mutate({ id, data: { status } }, {
      onSuccess: () => { toast({ title: `Remediation ${status}`, description: "Review decision recorded. No patch is applied by this workspace." }); qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() }); },
      onError: () => toast({ title: "Update failed", description: "Decision was not saved. Retry.", variant: "destructive" }),
    });
  };

  return (
    <div>
      <PageHead kicker="Findings" title="Vulnerability Intelligence" sub="Search by title, CVE, host, OS, open port or ATT&CK technique. Approvals are review decisions only and never deploy patches." />
      <div className="grid gap-3 px-4 md:px-5 xl:grid-cols-12">
        <Panel className="xl:col-span-5" bodyClass="p-0">
          <div className="space-y-2 border-b border-border/60 p-3">
            <div className="relative"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="CVE-2024, T1190, 445, Windows..." data-testid="input-search" className="w-full rounded border border-input bg-background/60 py-2 pl-8 pr-3 text-xs outline-none focus:border-primary" /></div>
            <div className="flex flex-wrap gap-1 font-mono text-[10px]">
              {SEVS.map((s) => <button key={s} onClick={() => setSev(s)} data-testid={`filter-${s}`} className={cn("rounded-sm border px-2 py-0.5 uppercase", sev === s ? "border-primary text-primary" : "border-border text-muted-foreground")}>{s}</button>)}
              <button onClick={() => setKevOnly(!kevOnly)} data-testid="filter-kev" className={cn("rounded-sm border px-2 py-0.5 uppercase", kevOnly ? "border-accent text-accent" : "border-border text-muted-foreground")}>KEV only</button>
              <span className="ml-auto text-muted-foreground">{list.length} results</span>
            </div>
          </div>
          <ul className="scrollbar-thin max-h-[640px] divide-y divide-border/40 overflow-auto">
            {list.length === 0 && <EmptyState title="No Matching Findings" body="Adjust the search or severity filter." />}
            {list.map((x) => {
              const a = ws.assets.find((y) => y.id === x.assetId);
              return (
                <li key={x.id}>
                  <button onClick={() => setSel(x.id)} data-testid={`row-vuln-${x.id}`} className={cn("relative w-full px-4 py-2.5 text-left hover:bg-muted/30", v?.id === x.id && "bg-muted/40")}>
                    <span className="absolute left-0 top-0 h-full w-0.5" style={{ background: sevColor(x.severity) }} />
                    <div className="flex items-center gap-2"><SevBadge sev={x.severity} />{x.kev && <span className="font-mono text-[9px] text-accent">KEV</span>}<span className="ml-auto font-mono text-[10px] uppercase text-muted-foreground">{x.status}</span></div>
                    <div className="mt-1 truncate text-[13px]">{x.title}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{x.cve} · {a?.hostname} · {x.technique} · CVSS {x.score.toFixed(1)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="space-y-3 xl:col-span-7">
          {v ? (
            <Panel kicker={v.cve} title={<span className="capitalize">{v.title}</span>}>
              <div className="grid gap-4 text-xs md:grid-cols-2">
                <dl className="grid grid-cols-[90px_1fr] gap-y-1.5 font-mono text-[11px]">
                  <dt className="text-muted-foreground">Severity</dt><dd><SevBadge sev={v.severity} /></dd>
                  <dt className="text-muted-foreground">CVSS</dt><dd style={{ color: sevColor(v.severity) }}>{v.score.toFixed(1)}</dd>
                  <dt className="text-muted-foreground">CISA KEV</dt><dd className={v.kev ? "text-accent" : ""}>{v.kev ? "Listed" : "Not listed"}</dd>
                  <dt className="text-muted-foreground">Technique</dt><dd>{v.technique} · {tactic(v.technique)}</dd>
                  <dt className="text-muted-foreground">Confidence</dt><dd>{Math.round(v.confidence <= 1 ? v.confidence * 100 : v.confidence)}%</dd>
                  <dt className="text-muted-foreground">Host</dt><dd>{asset?.hostname} ({asset?.ip})</dd>
                  <dt className="text-muted-foreground">OS</dt><dd>{asset?.os}</dd>
                  <dt className="text-muted-foreground">Ports</dt><dd className="flex flex-wrap gap-1">{asset?.ports.map((p) => <span key={p} className="rounded-sm bg-muted px-1">{p}/{service(p)[0]}</span>)}</dd>
                </dl>
                <div className="space-y-3">
                  <div><div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Risk scenario</div><p className="mt-1 leading-relaxed">{scenario(v, asset)}</p></div>
                  <div><div className="font-mono text-[10px] uppercase tracking-wider text-primary">Recommendation</div><p className="mt-1 leading-relaxed">{v.recommendation}</p></div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                <span className="mr-auto font-mono text-[11px] text-muted-foreground">Remediation review: <span className="uppercase text-foreground">{v.status}</span></span>
                <button disabled={upd.isPending || v.status === "approved"} onClick={() => decide(v.id, "approved")} data-testid="button-approve" className="flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs text-primary disabled:opacity-40"><Check className="h-3.5 w-3.5" />Approve</button>
                <button disabled={upd.isPending || v.status === "rejected"} onClick={() => decide(v.id, "rejected")} data-testid="button-reject" className="flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive disabled:opacity-40"><X className="h-3.5 w-3.5" />Reject</button>
                {v.status !== "pending" && <button disabled={upd.isPending} onClick={() => decide(v.id, "pending")} data-testid="button-reset" className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs text-muted-foreground"><RotateCcw className="h-3.5 w-3.5" />Reset</button>}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">Review only. Approving records intent; SPECTRE never applies patches or configuration changes.</p>
            </Panel>
          ) : <Panel><EmptyState title="Select A Finding" body="Choose a vulnerability to inspect its detail." /></Panel>}
          <Panel kicker="Dynamic" title="Threat Topology" action={<Illustrative />}>
            <Topology assets={ws.assets} vulns={ws.vulnerabilities} highlight={asset?.id} onSelect={(a) => { const f = list.find((x) => x.assetId === a.id); if (f) setSel(f.id); }} height={340} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
