import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { LiveJob } from "@workspace/api-client-react";
import { ZoomIn, ZoomOut, RotateCcw, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Panel, EmptyState } from "@/components/kit";
import { cn } from "@/lib/utils";
import { protoOf, fmtPairs } from "@/lib/live-exposure";

const PAGE = 24;
const PENDING = new Set(["queued", "running", "cancelling"]);

type Kind = "open" | "closed" | "uncertain" | "pending" | "failed" | "cancelled" | "empty";
/** Measured state only: derived from job status and observed service states. No risk scoring. */
function kindOf(j: LiveJob): Kind {
  if (PENDING.has(j.status)) return "pending";
  if (j.status === "failed") return "failed";
  if (j.status === "cancelled") return "cancelled";
  if (j.services.some((s) => s.state === "open")) return "open";
  if (j.services.some((s) => s.state !== "closed")) return "uncertain";
  return j.services.length ? "closed" : "empty";
}
const KIND: Record<Kind, { color: string; label: string }> = {
  open: { color: "hsl(38 92% 60%)", label: "Open Ports Observed" },
  closed: { color: "hsl(172 60% 50%)", label: "Observed Ports Closed" },
  uncertain: { color: "hsl(210 40% 65%)", label: "Inconclusive Observations" },
  empty: { color: "hsl(200 20% 60%)", label: "Completed, No Results" },
  pending: { color: "hsl(210 15% 55%)", label: "Check In Progress" },
  failed: { color: "hsl(0 70% 62%)", label: "Check Failed" },
  cancelled: { color: "hsl(260 12% 58%)", label: "Cancelled" },
};
const STATE_COLOR: Record<string, string> = { open: "text-amber-300", closed: "text-teal-300", filtered: "text-slate-300" };

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(m.matches);
    const f = () => setR(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return r;
}

/** One check per IP (latest, or the selected historical job). Observational only: no routes, no LAN inference. */
export function EmbeddedNetMapper({ jobs, selectedId, onSelect }: { jobs: LiveJob[]; selectedId?: string; onSelect: (id: string) => void }) {
  const reduced = useReducedMotion();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [focusIp, setFocusIp] = useState<string | null>(null);
  const lastSelection = useRef<string | undefined>(undefined);

  const selJob = jobs.find((j) => j.id === selectedId);
  const selIp = selJob?.ip;
  useEffect(() => { setFocusIp(null); }, [selectedId]);

  const hosts = useMemo(() => {
    const m = new Map<string, LiveJob>();
    const counts = new Map<string, number>();
    for (const j of jobs) {
      counts.set(j.ip, (counts.get(j.ip) ?? 0) + 1);
      const p = m.get(j.ip);
      if (!p || j.createdAt > p.createdAt) m.set(j.ip, j);
    }
    const latestIds = new Map([...m].map(([ip, j]) => [ip, j.id]));
    if (selJob) m.set(selJob.ip, selJob);
    return [...m.values()]
      .sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }))
      .map((j) => ({ j, historical: latestIds.get(j.ip) !== j.id, checks: counts.get(j.ip) ?? 1 }));
  }, [jobs, selJob]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? hosts.filter(({ j }) => j.ip.includes(q) || j.status.includes(q) || j.profile.includes(q)) : hosts;
  }, [hosts, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const curPage = Math.min(page, pages - 1);
  useEffect(() => { setPage(0); }, [query]);
  // Jump to the page holding the selected host.
  useEffect(() => {
    if (!selIp || lastSelection.current === selectedId) return;
    const i = filtered.findIndex((h) => h.j.ip === selIp);
    if (i >= 0) { setPage(Math.floor(i / PAGE)); lastSelection.current = selectedId; }
  }, [selectedId, selIp, filtered]);

  const shown = filtered.slice(curPage * PAGE, curPage * PAGE + PAGE);
  const W = 640, H = 400, cx = W / 2, cy = H / 2;
  const nodes = shown.map((h, i) => {
    const inner = Math.min(8, shown.length);
    const ring = i < inner ? 0 : 1;
    const idx = ring === 0 ? i : i - inner;
    const n = ring === 0 ? inner : shown.length - inner;
    const ang = (idx / n) * Math.PI * 2 - Math.PI / 2 + (ring ? Math.PI / n : 0);
    const rx = ring ? 270 : 150, ry = ring ? 165 : 95;
    return { ...h, x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry };
  });
  const detail = hosts.find((h) => h.j.ip === (focusIp ?? selIp))?.j ?? null;
  const detailHist = hosts.find((h) => h.j.ip === detail?.ip)?.historical;

  const onNodeKey = (e: KeyboardEvent<SVGGElement>, i: number) => {
    const go = (k: number) => {
      const t = nodes[(k + nodes.length) % nodes.length];
      setFocusIp(t.j.ip);
      (document.querySelector(`[data-testid="node-netmap-${t.j.ip}"]`) as SVGGElement | null)?.focus();
    };
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(nodes[i].j.id); }
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); go(i + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); go(i - 1); }
  };

  const btn = "inline-flex h-7 w-7 items-center justify-center rounded border border-border/60 text-muted-foreground hover:border-primary/50 hover:text-primary disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

  return (
    <Panel kicker="Network Overview" title="NetMapper" className="min-w-0 xl:col-span-8">
      <div data-testid="panel-embedded-netmapper">
        <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">Logical view: the backend vantage (this app's hosting environment) and public IPv4 targets, one check per IP (latest, or the historical job you select in Evidence). Lines associate checks with targets; they do not prove reachability and are <strong className="text-foreground">not measured network routes, hops or lateral-movement paths</strong>. Colours reflect measured job status and port states only. No internal network is shown or inferred.</p>
        {hosts.length === 0 ? <EmptyState title="No Hosts Observed" body="Run an approved embedded check. Each checked public IP appears here with its open-port summary." /> : (
          <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <label className="relative min-w-[140px] flex-1">
                  <span className="sr-only">Search Hosts</span>
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by IP, status or profile" data-testid="input-netmap-search" className="h-7 w-full rounded border border-border/60 bg-background/60 pl-7 pr-2 font-mono text-[11px] outline-none focus:border-primary/60" />
                </label>
                <div className="flex items-center gap-1" role="group" aria-label="Zoom Controls">
                  <button className={btn} onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))} disabled={zoom >= 2.5} aria-label="Zoom In" data-testid="button-netmap-zoom-in"><ZoomIn className="h-3.5 w-3.5" /></button>
                  <button className={btn} onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.25).toFixed(2)))} disabled={zoom <= 0.75} aria-label="Zoom Out" data-testid="button-netmap-zoom-out"><ZoomOut className="h-3.5 w-3.5" /></button>
                  <button className={btn} onClick={() => setZoom(1)} aria-label="Reset Zoom" data-testid="button-netmap-zoom-reset"><RotateCcw className="h-3.5 w-3.5" /></button>
                  <span className="w-10 text-right font-mono text-[10px] text-muted-foreground" aria-live="polite">{Math.round(zoom * 100)}%</span>
                </div>
              </div>
              <div className="grid-bg relative h-[300px] w-full overflow-auto rounded border border-border/60 bg-background/60 sm:h-[380px]">
                {shown.length === 0 ? <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground" data-testid="text-netmap-no-match">No hosts match "{query}".</div> : (
                  <svg viewBox={`0 0 ${W} ${H}`} style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} className="mx-auto max-w-none" preserveAspectRatio="xMidYMid meet" role="group" aria-label={`Backend vantage logically associated with ${shown.length} of ${filtered.length} public hosts. Use arrow keys to move between hosts and Enter to select.`} data-testid="graphic-netmap">
                    <style>{reduced ? "" : ".nm-edge{transition:stroke-opacity .2s}"}</style>
                    {[95, 165].map((r) => <ellipse key={r} cx={cx} cy={cy} rx={r === 95 ? 150 : 270} ry={r} fill="none" stroke="hsl(216 22% 22%)" strokeDasharray="2 6" />)}
                    <ellipse cx={cx} cy={cy} rx={75} ry={48} fill="none" stroke="hsl(216 22% 18%)" strokeDasharray="2 6" />
                    {nodes.map(({ j, x, y, historical }, i) => {
                      const k = kindOf(j), c = KIND[k].color, sel = j.ip === selIp, foc = j.ip === focusIp;
                      const open = j.services.filter((s) => s.state === "open").length;
                      const below = y > cy;
                      return (
                        <g key={j.ip} tabIndex={i === 0 || sel ? 0 : -1} role="button" aria-pressed={sel}
                          aria-label={`${j.ip}, ${KIND[k].label}, ${open} open of ${j.services.length} observed, status ${j.status}${historical ? ", historical check" : ""}`}
                          className="cursor-pointer outline-none [&:focus-visible>.nm-ring]:opacity-100"
                          onClick={() => onSelect(j.id)} onKeyDown={(e) => onNodeKey(e, i)}
                          onMouseEnter={() => setFocusIp(j.ip)} onFocus={() => setFocusIp(j.ip)}
                          data-testid={`node-netmap-${j.ip}`}>
                          <line className={cn("nm-edge", !reduced && k === "pending" && "edge-flow")} x1={cx} y1={cy} x2={x} y2={y} stroke={c} strokeOpacity={sel || foc ? 0.9 : 0.3} strokeDasharray={k === "pending" ? "3 4" : undefined} />
                          <circle cx={x} cy={y} r={18} fill="transparent" />
                          <circle className="nm-ring" cx={x} cy={y} r={14} fill="none" stroke="hsl(188 80% 60%)" strokeWidth={1.5} opacity={sel ? 1 : 0} />
                          {!reduced && k === "pending" && <circle cx={x} cy={y} r={9} fill="none" stroke={c} className="ping-soft" />}
                          <circle cx={x} cy={y} r={sel || foc ? 9 : 7} fill="hsl(222 32% 7%)" stroke={c} strokeWidth={sel ? 2.5 : 1.5} strokeDasharray={k === "pending" ? "2 2" : undefined} />
                          <circle cx={x} cy={y} r={2.5} fill={c} />
                          {open > 0 && <text x={x + 9} y={y - 7} fontSize="7" fill={c} fontFamily="IBM Plex Mono">{open}</text>}
                          <text x={x} y={y + (below ? 22 : -15)} textAnchor="middle" fontSize="10" fill={sel ? "hsl(188 80% 65%)" : "hsl(210 24% 85%)"} fontFamily="monospace">{j.ip}</text>
                          <text x={x} y={y + (below ? 33 : -27)} textAnchor="middle" fontSize="8" fill="hsl(215 14% 65%)" fontFamily="monospace">{historical ? "historical · " : ""}{j.status}</text>
                        </g>
                      );
                    })}
                    <circle cx={cx} cy={cy} r={18} fill="hsl(222 32% 7%)" stroke="hsl(42 92% 58%)" strokeWidth={1.5} />
                    {!reduced && <circle cx={cx} cy={cy} r={18} fill="none" stroke="hsl(42 92% 58%)" className="ping-soft" />}
                    <text x={cx} y={cy + 1} textAnchor="middle" fontSize="6.5" fill="hsl(42 92% 70%)" fontFamily="IBM Plex Mono">VANTAGE</text>
                    <text x={cx} y={cy + 30} textAnchor="middle" fontSize="6" fill="hsl(215 14% 55%)" fontFamily="IBM Plex Mono">backend hosting env</text>
                  </svg>
                )}
                <div className="pointer-events-none absolute bottom-2 left-2 rounded border border-border/50 bg-background/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Logical associations · not measured routes</div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Legend">
                  {(Object.keys(KIND) as Kind[]).map((k) => (
                    <li key={k} className="flex items-center gap-1 font-mono text-[9.5px] text-muted-foreground"><span className="h-2 w-2 rounded-full border" style={{ borderColor: KIND[k].color, background: k === "pending" ? "transparent" : KIND[k].color }} />{KIND[k].label}</li>
                  ))}
                </ul>
                <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                  <span data-testid="text-netmap-count">Showing {shown.length} of {filtered.length}{filtered.length !== hosts.length ? ` (${hosts.length} total)` : ""}</span>
                  {pages > 1 && <>
                    <button className={btn} onClick={() => setPage(curPage - 1)} disabled={curPage === 0} aria-label="Previous Page" data-testid="button-netmap-prev"><ChevronLeft className="h-3.5 w-3.5" /></button>
                    <span>{curPage + 1}/{pages}</span>
                    <button className={btn} onClick={() => setPage(curPage + 1)} disabled={curPage >= pages - 1} aria-label="Next Page" data-testid="button-netmap-next"><ChevronRight className="h-3.5 w-3.5" /></button>
                  </>}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <section className="rounded border border-border/60 bg-background/40 p-3" aria-live="polite" data-testid="panel-netmap-detail">
                {!detail ? <p className="font-mono text-[11px] text-muted-foreground">Select or hover a host to inspect its measured services.</p> : (() => {
                  const k = kindOf(detail);
                  return <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="truncate font-mono text-sm text-foreground" data-testid="text-netmap-detail-ip">{detail.ip}</h4>
                        <p className="font-mono text-[10px] uppercase text-muted-foreground">{detail.profile} · {detail.status} · {new Date(detail.createdAt).toLocaleString()}</p>
                      </div>
                      <span className="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase" style={{ borderColor: KIND[k].color, color: KIND[k].color }}>{KIND[k].label}</span>
                    </div>
                    {detailHist && <p className="mt-2 rounded border border-amber-400/30 bg-amber-400/5 px-2 py-1 text-[10.5px] text-amber-200" data-testid="text-netmap-historical">Showing the selected historical check, not the latest for this IP.</p>}
                    <div className="mt-2">
                      {k === "pending" && <p className="mb-2 text-[11px] text-muted-foreground">Check is {detail.status}; observations are incomplete until the check finishes.</p>}
                      {detail.services.length === 0 ? <p className="text-[11px] text-muted-foreground">{k === "pending" ? "No observations recorded yet." : "No service observations were recorded for this check."}</p>
                        : <ul className="scrollbar-thin max-h-40 space-y-0.5 overflow-auto">
                            {[...detail.services].sort((a, b) => (a.state === "open" ? -1 : 0) - (b.state === "open" ? -1 : 0) || a.port - b.port).map((s) => (
                              <li key={`${protoOf(s)}${s.port}`} className="flex justify-between gap-2 font-mono text-[10.5px]">
                                <span className="text-foreground">{protoOf(s).toUpperCase()} {s.port} <span className="text-muted-foreground">{s.service}{s.product ? ` · ${s.product}` : ""}</span></span>
                                <span className={cn("uppercase", STATE_COLOR[s.state] ?? "text-muted-foreground")}>{s.state}</span>
                              </li>
                            ))}
                          </ul>}
                    </div>
                    {detail.id !== selectedId && <button onClick={() => onSelect(detail.id)} className="mt-2 font-mono text-[10px] uppercase text-primary hover:underline" data-testid="button-netmap-open-detail">Open Evidence</button>}
                  </>;
                })()}
              </section>
              <ul className="scrollbar-thin max-h-[300px] space-y-1.5 overflow-auto" aria-label="Hosts">
                {shown.map(({ j, historical, checks }) => {
                  const open = j.services.filter((s) => s.state === "open").map((s) => ({ protocol: protoOf(s), port: s.port })), sel = j.ip === selIp, k = kindOf(j);
                  return (
                    <li key={j.ip}><button onClick={() => onSelect(j.id)} onMouseEnter={() => setFocusIp(j.ip)} aria-pressed={sel} data-testid={`button-netmap-host-${j.ip}`} className={cn("w-full rounded border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", sel ? "border-primary/60 bg-primary/10" : "border-border/60 hover:border-primary/40")}>
                      <div className="flex justify-between gap-2 font-mono text-xs"><span className={cn("flex items-center gap-1.5", sel && "text-primary")}><span className="h-1.5 w-1.5 rounded-full" style={{ background: KIND[k].color }} />{j.ip}</span><span className="text-muted-foreground uppercase">{j.profile} · {j.status}</span></div>
                      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{open.length ? `Open ${fmtPairs(open)}` : !j.services.length ? (k === "pending" ? "No observations yet" : "No results recorded") : KIND[k].label} · {checks} check{checks === 1 ? "" : "s"}{historical ? " · historical" : ""}</div>
                    </button></li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
