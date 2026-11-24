import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Asset, Vulnerability } from "@workspace/api-client-react";
import { Play, Pause, SkipForward, RotateCcw, ExternalLink } from "lucide-react";
import { EmptyState, SevBadge } from "@/components/kit";
import { buildScenarios, attackUrl, EMERGENCY_STOP_EVENT } from "@/lib/attack-paths";
import { cn } from "@/lib/utils";

const STEP_MS = 2200;

export function AttackPathWalkthrough({ scanId, hosts, findings }: { scanId: string; hosts: Asset[]; findings: Vulnerability[] }) {
  const scenarios = useMemo(() => buildScenarios(hosts, findings), [hosts, findings]);
  const [scId, setScId] = useState<string | null>(null);
  const sc = scenarios.find((s) => s.id === scId) ?? scenarios[0];
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);
  const reduced = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);

  const clear = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };
  const reset = useCallback(() => { clear(); setPlaying(false); setStep(0); setDone(false); }, []);

  useEffect(() => { reset(); }, [scanId, sc?.id, reset]);
  useEffect(() => {
    const h = () => reset();
    window.addEventListener(EMERGENCY_STOP_EVENT, h);
    return () => { window.removeEventListener(EMERGENCY_STOP_EVENT, h); clear(); };
  }, [reset]);

  const n = sc?.steps.length ?? 0;
  useEffect(() => {
    clear();
    if (!playing || !n) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (step >= n - 1) { setPlaying(false); setDone(true); } else setStep(step + 1);
    }, reduced ? 1200 : STEP_MS);
    return clear;
  }, [playing, step, n, reduced]);

  if (!sc) return <div className="p-4"><EmptyState title="No Attack Paths" body="No findings are linked to the hosts in this job, so no hypothetical walkthrough can be derived." /></div>;

  const next = () => { if (step >= n - 1) { setPlaying(false); setDone(true); } else setStep(step + 1); };
  const play = () => { if (done) { setStep(0); setDone(false); } setPlaying(true); };
  const cur = sc.steps[Math.min(step, n - 1)];
  const btn = "flex items-center gap-1 rounded-sm border border-border px-2 py-1 hover:border-primary/50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:opacity-40";

  return (
    <div className="space-y-3 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2 rounded-sm border border-accent/30 bg-accent/5 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-accent">
        <span className="font-semibold">Hypothetical demo</span><span className="text-accent/70">No traffic · No execution · Not an observed attack</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="scenario-select">Scenario</label>
        <select id="scenario-select" value={sc.id} onChange={(e) => setScId(e.target.value)} data-testid="select-scenario"
          className="min-w-0 max-w-full flex-1 rounded border border-input bg-background/60 px-2 py-1.5 font-mono text-[11px] outline-none focus:border-primary">
          {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <div className="flex gap-1 font-mono text-[10px] uppercase">
          {playing
            ? <button type="button" onClick={() => setPlaying(false)} className={btn} data-testid="button-path-pause"><Pause className="h-3 w-3" />Pause</button>
            : <button type="button" onClick={play} className={btn} data-testid="button-path-play"><Play className="h-3 w-3" />Play</button>}
          <button type="button" onClick={next} disabled={done} className={btn} data-testid="button-path-next"><SkipForward className="h-3 w-3" />Next</button>
          <button type="button" onClick={reset} className={btn} data-testid="button-path-reset"><RotateCcw className="h-3 w-3" />Reset</button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{sc.summary}</p>

      <div className="scrollbar-thin overflow-x-auto pb-1">
        <ol className="flex min-w-max items-stretch gap-0">
          {sc.steps.map((s, i) => (
            <li key={s.id} className="flex items-center">
              <button type="button" onClick={() => { setPlaying(false); setDone(false); setStep(i); }} aria-current={i === step ? "step" : undefined} data-testid={`node-step-${i}`}
                className={cn("w-40 rounded border px-2.5 py-2 text-left font-mono text-[10px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary",
                  !reduced && "transition-[transform,opacity] duration-300",
                  i === step ? "scale-[1.03] border-primary bg-primary/10" : i < step ? "border-primary/30 opacity-90" : "border-border opacity-60",
                  s.basis === "assumed" && "border-dashed")}>
                <div className="flex items-center justify-between"><span className="text-primary">{s.technique}</span><span className={s.basis === "observed" ? "text-accent" : "text-muted-foreground"}>{s.basis === "observed" ? "DEMO FINDING" : "ASSUMED"}</span></div>
                <div className="mt-1 truncate text-[11px] text-foreground">{s.name}</div>
                <div className="truncate text-muted-foreground">{s.asset?.hostname ?? "--"} · {s.zone}</div>
              </button>
              {i < sc.steps.length - 1 && <span aria-hidden className={cn("mx-1 h-px w-6", i < step ? "bg-primary" : "border-t border-dashed border-border")} />}
            </li>
          ))}
        </ol>
      </div>

      <div key={cur.id + step} className={cn("grid gap-3 rounded border border-border bg-background/40 p-3 text-xs md:grid-cols-2", !reduced && "rise")} aria-live="polite">
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Step {step + 1} of {n} · {cur.tactic}</div>
          <div className="font-display text-sm font-semibold">{cur.technique} {cur.name}</div>
          <div><span className="text-muted-foreground">Asset / zone. </span>{cur.asset ? `${cur.asset.hostname} (${cur.asset.ip})` : "Unspecified"} · {cur.zone}</div>
          <div>
            <span className="text-muted-foreground">Supporting finding. </span>
            {cur.finding ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <SevBadge sev={cur.finding.severity} />
                <span>{cur.finding.title}</span>
                {/^CVE-\d{4}-\d+$/i.test(cur.finding.cve) && <a href={`https://nvd.nist.gov/vuln/detail/${cur.finding.cve}`} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">{cur.finding.cve}</a>}
                {cur.finding.kev && <span className="rounded-sm bg-accent/15 px-1.5 font-mono text-[10px] text-accent">KEV</span>}
                <span className="font-mono text-muted-foreground">CVSS {cur.finding.score.toFixed(1)}</span>
              </span>
            ) : <span className="text-accent">None. No supporting evidence.</span>}
          </div>
          <a href={attackUrl(cur.technique)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline">ATT&amp;CK {cur.technique} <ExternalLink className="h-3 w-3" /></a>
        </div>
        <div className="space-y-2">
          <div><div className="text-muted-foreground">Prerequisites</div><ul className="mt-0.5 list-disc pl-4">{cur.prerequisites.map((p) => <li key={p}>{p}</li>)}</ul></div>
          <div><span className="text-muted-foreground">Uncertainty. </span>{cur.uncertainty}</div>
          <div><span className="text-primary">Mitigation. </span>{cur.mitigation}</div>
        </div>
      </div>
      {done && <div className="rounded-sm border border-primary/30 bg-primary/5 px-3 py-1.5 font-mono text-[11px] text-primary" data-testid="status-walkthrough-complete">Walkthrough complete. Illustrative sequence only; nothing was executed.</div>}
    </div>
  );
}
