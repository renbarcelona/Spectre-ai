import { useMemo } from "react";
import type { LiveJob } from "@workspace/api-client-react";
import { AlertTriangle } from "lucide-react";
import { Panel, EmptyState } from "@/components/kit";
import { aggregateLiveExposure, RETENTION_LIMIT, type JobLike } from "@/lib/live-exposure";

const W = 320, C = W / 2, R = 112;
const pt = (i: number, r: number) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 6; return [C + r * Math.cos(a), C + r * Math.sin(a)] as const; };
const fmtT = (s: string | null) => (s ? new Date(s).toLocaleString() : "--");

export function LiveExposureRadar({ jobs }: { jobs: LiveJob[] }) {
  const snap = useMemo(() => aggregateLiveExposure(jobs as unknown as JobLike[]), [jobs]);
  const { metrics, scaleMax } = snap;
  const allMeasured = metrics.every((m) => m.count !== null);
  const missing = metrics.filter((m) => m.count === null);
  const r = (n: number) => (n / scaleMax) * R;
  const ticks = [0.25, 0.5, 0.75, 1];

  return (
    <Panel kicker="Measured Evidence" title="Live Exposure Radar">
      <div data-testid="panel-live-exposure-radar">
        {snap.targetCount === 0 ? (
          <EmptyState title="No Completed Embedded Checks" body="The radar plots only persisted results from completed embedded checks. Run an approved check; failed, running and cancelled checks are never counted." />
        ) : (
          <div className="grid items-center gap-5 md:grid-cols-[minmax(0,340px)_1fr]">
            <figure className="mx-auto w-full max-w-[340px]">
              <svg viewBox={`0 0 ${W} ${W}`} className="w-full" role="img" aria-label={`Observed counts on a 0 to ${scaleMax} scale. ${metrics.map((m) => `${m.label}: ${m.count ?? "Not Assessed"}`).join(". ")}.`}>
                {ticks.map((t) => <polygon key={t} points={[0, 1, 2, 3, 4, 5].map((i) => pt(i, R * t).join(",")).join(" ")} fill="none" stroke="hsl(190 40% 30% / .45)" />)}
                {metrics.map((m, i) => { const [x, y] = pt(i, R); const [lx, ly] = pt(i, R + 22); return (
                  <g key={m.key}>
                    <line x1={C} y1={C} x2={x} y2={y} stroke="hsl(190 40% 30% / .45)" strokeDasharray={m.count === null ? "3 3" : undefined} />
                    <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={9.5} fontFamily="monospace" fill={m.count === null ? "#6b7f8e" : "#a7bfcc"}>{m.axis}</text>
                  </g>); })}
                {ticks.map((t) => <text key={t} x={C + 3} y={C - R * t + 3} fontSize={8} fill="#8399aa" fontFamily="monospace">{+(scaleMax * t).toFixed(2)}</text>)}
                {allMeasured && <polygon points={metrics.map((m, i) => pt(i, r(m.count as number)).join(",")).join(" ")} fill="#38d9ed" fillOpacity={0.15} stroke="#38d9ed" strokeWidth={2} />}
                {metrics.map((m, i) => { if (m.count === null) { const [x, y] = pt(i, R); return <text key={m.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="#6b7f8e">×</text>; }
                  const [x, y] = pt(i, r(m.count)); return <circle key={m.key} cx={x} cy={y} r={4} fill="#e8bc68" stroke="#0b1a22"><title>{`${m.label}: ${m.count}`}</title></circle>; })}
              </svg>
              <figcaption className="mt-1 text-center font-mono text-[10px] text-muted-foreground">Count scale 0 to {scaleMax} · {allMeasured ? "All six axes measured" : `Dots only: ${missing.length} axis${missing.length > 1 ? "es" : ""} Not Assessed (×), no polygon drawn`}</figcaption>
            </figure>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px]" data-testid="text-radar-meta">
                <span><span className="text-muted-foreground">Targets </span>{snap.targetCount}</span>
                <span><span className="text-muted-foreground">Protocol/Port Checks </span>{snap.checkCount}</span>
                <span><span className="text-muted-foreground">Snapshot </span>{fmtT(snap.start)} → {fmtT(snap.end)}</span>
              </div>
              <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {metrics.map((m) => (
                  <div key={m.key} className="rounded border border-border/60 bg-background/35 px-3 py-2.5" data-testid={`card-radar-${m.key}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-xs text-muted-foreground">{m.label}</dt>
                      <dd className={m.count === null ? "font-mono text-[11px] uppercase text-muted-foreground" : "font-display text-xl font-semibold tabular-nums text-foreground"}>{m.count === null ? "Not Assessed" : m.count}</dd>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">{m.attempted ? `Coverage: ${m.attempted} relevant check${m.attempted > 1 ? "s" : ""}` : "Coverage: no relevant check attempted"}</div>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
        {snap.excludedNewer.length > 0 && (
          <div className="mt-3 flex gap-2 rounded border border-accent/40 bg-accent/5 p-2.5 text-[11px] text-accent" data-testid="text-radar-excluded">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Newer checks excluded (not completed): {snap.excludedNewer.map((e) => `${e.ip} ${e.status}`).join(", ")}. The radar shows the latest completed check per IP, which may be older.</span>
          </div>
        )}
        <details className="mt-3 rounded border border-border/60 bg-background/30 p-2.5 text-[11px]" data-testid="details-radar-provenance">
          <summary className="cursor-pointer text-primary">How These Counts Are Derived</summary>
          <div className="mt-2 space-y-1.5 leading-relaxed text-muted-foreground">
            <p>Uses the latest completed embedded check per IP (finished time, falling back to created time; ties resolved by check ID). Demo scans, external-agent jobs and running, queued, failed or cancelled checks are excluded. Counts are distinct host + protocol + port observations with a recognised state{snap.invalidCount ? `; ${snap.invalidCount} unrecognised record(s) ignored` : ""}.</p>
            <ul className="list-disc pl-4">{metrics.map((m) => <li key={m.key}><span className="text-foreground">{m.label}:</span> {m.definition}</li>)}</ul>
            <p>Categories overlap (an open TCP 443 counts in Open TCP and Open Web); they are observed counts, not an additive risk score. Port numbers are conventional categories, not proven service identities or vulnerabilities. Not Assessed means no relevant check was attempted and is never shown as zero.</p>
            <p>History is limited to the most recent {RETENTION_LIMIT} jobs returned by the server{snap.retentionMayTruncate ? ` (${snap.historyCount} loaded, so older checks for some IPs may be missing)` : ""}.</p>
            {snap.includedJobs.length > 0 && <ul className="font-mono text-[10px]">{snap.includedJobs.map((j) => <li key={j.id} className="break-all">{j.ip} · {j.id} · {fmtT(j.at)} · {j.observations} observations</li>)}</ul>}
          </div>
        </details>
      </div>
    </Panel>
  );
}
