import { useLocation, useSearch } from "wouter";
import { useGetLiveDiscovery, getGetLiveDiscoveryQueryKey } from "@workspace/api-client-react";
import type { Workspace } from "@workspace/api-client-react";
import { Download, Printer, FileText } from "lucide-react";
import { PageHead } from "@/components/shell";
import { Panel, PageSkeleton, ErrorState } from "@/components/kit";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace } from "@/lib/sentinel";
import { cn } from "@/lib/utils";
import { buildExecutiveReport } from "@/lib/executive-report";
import { buildTechnicalReport } from "@/lib/technical-report";
import { buildLiveReport, isReportableLiveJob } from "@/lib/live-report";
import { useTeamAuth } from "@/lib/team-auth";

type Kind = "executive" | "technical";
function build(ws: Workspace, kind: Kind) {
  return kind === "executive" ? buildExecutiveReport(ws) : buildTechnicalReport(ws);
}

export default function Reports() {
  const { data: ws, isLoading, isError, refetch } = useWorkspace();
  const { toast } = useToast();
  const { user } = useTeamAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const source = params.get("source") === "demo" ? "demo" : "live";
  const kind: Kind = params.get("kind") === "technical" ? "technical" : "executive";
  const selectedId = params.get("scan") ?? "";
  const live = useGetLiveDiscovery({ query: { queryKey: [...getGetLiveDiscoveryQueryKey(), user?.id], enabled: source === "live" && !!user, refetchInterval: 5000 } });
  const jobs = (live.data?.jobs ?? []).filter(isReportableLiveJob).sort((a,b)=>(b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt));
  const selected = jobs.find(j => j.id === selectedId);
  const update = (values: Record<string,string>) => {
    const next = new URLSearchParams(search);
    for (const [key,value] of Object.entries(values)) value ? next.set(key,value) : next.delete(key);
    navigate(`/reports?${next.toString()}`);
  };
  if (source === "demo" && isLoading) return <PageSkeleton />;
  if (source === "demo" && (isError || !ws)) return <ErrorState onRetry={() => refetch()} />;
  const html = source === "demo" && ws ? build(ws, kind) : selected ? buildLiveReport(selected, kind, live.data?.targets.find(t=>t.id===selected.targetId), ws?.settings.organization) : "";
  const ready = !!html && !(source === "live" && (live.isError || live.isLoading));

  const download = () => {
    if (!ready) return;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url; a.download = `spectre-${kind}-${source === "live" ? `LIVE-${selected!.id.replace(/[^a-zA-Z0-9_-]/g,"_")}` : "DEMO"}-${new Date().toISOString().slice(0, 10)}.html`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast({ title: "Report Downloaded", description: `${source === "live" ? "Live scan" : "Demo"} HTML report saved.` });
  };
  const print = () => {
    if (!ready) return;
    const w = window.open("", "_blank");
    if (!w) { toast({ title: "Pop-up blocked", description: "Allow pop-ups to print to PDF.", variant: "destructive" }); return; }
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };

  return (
    <div>
      <PageHead kicker="Deliverables" title="Report Studio" sub="Generate reports from a completed Intelligent VAPT scan or explicitly choose demonstration records. Sources are never mixed." />
      <div className="grid gap-3 px-4 md:px-5 lg:grid-cols-12">
        <Panel kicker="Format" title="Report Type" className="lg:col-span-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium">Evidence Source
              <select aria-label="Evidence Source" value={source} onChange={e=>update({source:e.target.value,scan:""})} className="mt-2 w-full rounded border border-border bg-background p-2">
                <option value="live">Intelligent VAPT Live Scan</option><option value="demo">Demonstration Workspace</option>
              </select>
            </label>
            {source === "live" && <>
              <label className="block text-xs font-medium">Completed Scan
                <select aria-label="Completed Scan" value={selectedId} onChange={e=>update({scan:e.target.value})} className="mt-2 w-full rounded border border-border bg-background p-2">
                  <option value="">Select A Completed Scan</option>
                  {selectedId && !selected && <option value={selectedId}>Requested Scan Unavailable</option>}
                  {jobs.map(j=><option key={j.id} value={j.id}>{j.ip} · {j.profile} · {j.finishedAt ?? j.createdAt} · {j.id}</option>)}
                </select>
              </label>
              {live.isLoading ? <p className="text-xs">Loading Saved Scan Evidence…</p> : live.isError ? <div role="alert" className="text-xs text-destructive">Unable To Load Live Evidence. <button onClick={()=>live.refetch()} className="underline">Retry</button> No demo fallback is used.</div> : selectedId && !selected ? <p role="alert" className="text-xs text-destructive">This scan is unavailable, incomplete or not accessible. Select a completed scan; no substitute is selected automatically.</p> : jobs.length === 0 ? <p className="text-xs text-muted-foreground">No completed Intelligent VAPT scans are available. Complete an authorized scan in Scans first.</p> : null}
              {selected && <p className="break-all text-xs text-muted-foreground">Live Evidence · {selected.id} · {selected.services.length} observations. CVE/CVSS: Not Assessed.</p>}
            </>}
            {([["executive", "Executive Summary", "Two-page board and C-suite briefing: exposure, threats, five business-impact dimensions, financial uncertainty and decisions."], ["technical", "Technical Report", "Full technical findings, vulnerability scores, risks, impacts, remediation steps, verification guidance, inventory and scan history."]] as const).map(([k, t, d]) => (
              <button key={k} onClick={() => update({kind:k})} data-testid={`button-kind-${k}`} className={cn("w-full rounded border p-3 text-left transition-colors", kind === k ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                <div className="flex items-center gap-2 text-[13px] font-medium"><FileText className={cn("h-4 w-4", kind === k ? "text-primary" : "text-muted-foreground")} />{t}</div>
                <p className="mt-1 text-[11px] text-muted-foreground">{d}</p>
              </button>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button disabled={!ready} onClick={download} data-testid="button-download" className="flex items-center justify-center gap-2 rounded bg-primary py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"><Download className="h-3.5 w-3.5" />Download</button>
              <button disabled={!ready} onClick={print} data-testid="button-print" className="flex items-center justify-center gap-2 rounded border border-border py-2 text-xs disabled:opacity-40"><Printer className="h-3.5 w-3.5" />Print to PDF</button>
            </div>
            {source === "demo" && ws && <p className="font-mono text-[10px] text-muted-foreground">{ws.vulnerabilities.length} demo findings · {ws.assets.length} assets · {ws.scans.length} scans included</p>}
            {kind === "executive" && <p className="text-xs leading-relaxed text-muted-foreground">Two A4 pages. Download saves the printable HTML; Print To PDF creates the document. Use A4, 100% scale, no margins, enable Background Graphics, and disable browser headers/footers. The brief shows up to three priority themes; detailed records remain in the Technical Report.</p>}
            {kind === "technical" && <p className="text-xs leading-relaxed text-muted-foreground">Includes every recorded finding; length expands with the assessment. Guidance distinguishes recorded recommendations from supplemental technique-based advice and identifies missing evidence. Download saves HTML; Print To PDF creates an A4 document — enable Background Graphics to keep the briefing theme.</p>}
          </div>
        </Panel>
        <Panel kicker="Preview" title="Live Document" className="lg:col-span-8" bodyClass="p-2">
          {ready ? <iframe title="Report Preview" srcDoc={html} className="h-[70vh] w-full rounded bg-[#f6f8fa]" data-testid="frame-report-preview" /> : <p className="p-6 text-sm text-muted-foreground">{live.isFetching ? "Refreshing Saved Evidence…" : "Select an available completed scan to generate its report."}</p>}
        </Panel>
      </div>
    </div>
  );
}
