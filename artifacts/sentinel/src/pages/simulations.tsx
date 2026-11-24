import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListExercises, getListExercisesQueryKey, useCreateExercise, useActOnExercise, getGetWorkspaceQueryKey } from "@workspace/api-client-react";
import type { Exercise, ExerciseActionAction, ExerciseInputScenario, Asset } from "@workspace/api-client-react";
import { Crosshair, Download, Play, ShieldCheck, Square, StepForward, TriangleAlert, Check } from "lucide-react";
import { PageHead } from "@/components/shell";
import { Panel, PageSkeleton, ErrorState, EmptyState, Skel } from "@/components/kit";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useWorkspace, fmtTime } from "@/lib/sentinel";
import { cn } from "@/lib/utils";
import { ExerciseRecommendations } from "@/components/exercise-recommendations";

const IT = "Enterprise IT";
const DMZ = "Industrial DMZ";

type Scenario = { id: ExerciseInputScenario; title: string; objective: string; prereqs: string[]; rule: string };
const SCENARIOS: Scenario[] = [
  {
    id: "application",
    title: "Application Exposure",
    objective: "Walk through how an exposed web or remote-access service on an in-scope host could be reached, and which controls would be expected to block or detect each stage.",
    prereqs: ["At least one Enterprise IT or Industrial DMZ demo asset in scope", "Named owner acknowledgement for the demo", "No production system is touched — tabletop only"],
    rule: "Select at least 1 Enterprise IT or Industrial DMZ asset.",
  },
  {
    id: "boundary",
    title: "IT-To-DMZ Boundary",
    objective: "Rehearse a lateral-movement narrative from the corporate network toward the industrial DMZ and review segmentation, jump-host and monitoring controls at the boundary.",
    prereqs: ["At least one Enterprise IT asset (origin)", "At least one Industrial DMZ asset (destination)", "OT owner acknowledgement for the demo"],
    rule: "Select at least 1 Enterprise IT and 1 Industrial DMZ asset.",
  },
];

const DISCLAIMER = "DEMONSTRATION ONLY. No network traffic was generated and no commands, exploits or payloads were executed. Step outcomes (success / blocked / detected) are pre-scripted simulated examples, not measured results. Detection is Not assessed: no monitoring telemetry is connected. Approval is a demo acknowledgement, not a real RBAC authorization.";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const st = (s: string) => s.toLowerCase();
const isTerminal = (e: Exercise) => ["completed", "stopped"].includes(st(e.status));

function validate(scenario: ExerciseInputScenario, sel: Asset[]): string | null {
  const it = sel.filter((a) => a.zone === IT).length, dmz = sel.filter((a) => a.zone === DMZ).length;
  if (scenario === "application") return it + dmz >= 1 ? null : SCENARIOS[0].rule;
  return it >= 1 && dmz >= 1 ? null : SCENARIOS[1].rule;
}

function outcomeTone(o: string) {
  const v = st(o);
  if (v.includes("block")) return "text-primary border-primary/40 bg-primary/10";
  if (v.includes("detect")) return "text-accent border-accent/40 bg-accent/10";
  if (v.includes("success")) return "text-destructive border-destructive/40 bg-destructive/10";
  return "text-muted-foreground border-border";
}
function statusTone(s: string) {
  const v = st(s);
  if (v === "running") return "text-primary";
  if (v === "completed") return "text-foreground/70";
  if (v === "stopped") return "text-destructive";
  return "text-accent";
}

function buildReport(e: Exercise, assets: Asset[]) {
  const scope = e.assetIds.map((id) => assets.find((a) => a.id === id));
  const rows = e.steps.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.title)}</td><td>${esc(s.technique)}</td><td>${esc(s.status)}</td><td>${s.status === "completed" ? `${esc(s.outcome)} <em>(simulated)</em>` : "Not performed"}</td><td>${s.status === "completed" ? esc(s.evidence || "—") : "No checkpoint result"}</td><td>${esc(s.mitigation || "—")}</td><td>${esc(s.timestamp || "—")}</td></tr>`).join("");
  const scopeRows = e.assetIds.map((id, i) => { const a = scope[i]; return `<tr><td>${esc(id)}</td><td>${esc
(a?.hostname ?? "unknown")}</td><td>${esc(a?.ip ?? "")}</td><td>${esc(a?.zone ?? "")}</td></tr>`; }).join("");
  const css = "body{font-family:Georgia,serif;max-width:960px;margin:32px auto;padding:0 20px;color:#1d2226;background:#f6f3ec}h1{margin-bottom:4px}table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0 20px}td,th{border:1px solid #c9c2b2;padding:6px;text-align:left;vertical-align:top}th{background:#e8e2d4}.warn{border:2px solid #b3261e;background:#fbe9e7;padding:12px;font-weight:bold}dt{font-weight:bold;float:left;width:160px}dd{margin:0 0 6px 170px}";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(e.title)} — demo exercise report</title><style>${css}</style></head><body>
<p class="warn">${esc(DISCLAIMER)}</p>
<h1>${esc(e.title)}</h1><p>SPECTRE Red Team Simulation — demo exercise report</p>
<dl><dt>Exercise ID</dt><dd>${esc(e.id)}</dd><dt>Scenario</dt><dd>${esc(e.scenario)}</dd><dt>Status</dt><dd>${esc(e.status)}${isTerminal(e) ? "" : " (partial — exercise not finished)"}</dd><dt>Created</dt><dd>${esc(e.createdAt)}</dd><dt>Approved (demo ack)</dt><dd>${esc(e.approvedAt || "Not approved")}</dd><dt>Detection</dt><dd>${esc(e.detection || "Not assessed")} — no monitoring telemetry connected</dd><dt>Report generated</dt><dd>${esc(new Date().toISOString())}</dd></dl>
<h2>Objective</h2><p>${esc(e.objective)}</p>
<h2>Scope (${e.assetIds.length} demo asset(s))</h2><table><tr><th>Asset ID</th><th>Hostname</th><th>IP</th><th>Zone</th></tr>${scopeRows}</table>
<h2>Step timeline</h2><table><tr><th>#</th><th>Step</th><th>Technique</th><th>Status</th><th>Outcome</th><th>Evidence (illustrative)</th><th>Mitigation</th><th>Timestamp</th></tr>${rows}</table>
<p class="warn">${esc(DISCLAIMER)}</p></body></html>`;
}

function download(e: Exercise, assets: Asset[]) {
  const blob = new Blob([buildReport(e, assets)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `spectre-exercise-${e.id.slice(0, 8)}-${st(e.status)}.html`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const readId = () => new URLSearchParams(window.location.search).get("id");

export default function Simulations() {
  const ws = useWorkspace();
  const list = useListExercises({ query: { queryKey: getListExercisesQueryKey(), refetchInterval: 3000 } });
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateExercise();
  const act = useActOnExercise();
  const [scenario, setScenario] = useState<ExerciseInputScenario>("application");
  const [picked, setPicked] = useState<string[]>([]);
  const [auth, setAuth] = useState(false);
  const [sel, setSelState] = useState<string | null>(readId);

  const setSel = (id: string) => {
    setSelState(id);
    const u = new URL(window.location.href); u.searchParams.set("id", id); window.history.replaceState(null, "", u.toString());
  };

  const assets = ws.data?.assets ?? [];
  const eligible = useMemo(() => assets.filter((a) => a.zone === IT || a.zone === DMZ), [assets]);
  useEffect(() => { setPicked((p) => p.filter((id) => eligible.some((a) => a.id === id))); }, [eligible]);

  const exercises = useMemo(() => [...(list.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [list.data]);
  const current = exercises.find((e) => e.id === sel) ?? exercises[0];

  const invalidate = () => { qc.invalidateQueries({ queryKey: getListExercisesQueryKey() }); qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() }); };

  if (ws.isLoading) return <PageSkeleton />;
  if (ws.isError || !ws.data) return <ErrorState onRetry={() => ws.refetch()} />;

  const selAssets = eligible.filter((a) => picked.includes(a.id));
  const err = validate(scenario, selAssets);
  const tooMany = picked.length > 10;
  const canCreate = !err && !tooMany && auth && !create.isPending;
  const sc = SCENARIOS.find((s) => s.id === scenario)!;

  const submit = () => create.mutate({ data: { scenario, assetIds: picked, authorized: auth } }, {
    onSuccess: (e) => { setSel(e.id); setAuth(false); toast({ title: "Demo exercise drafted", description: `${e.title}. Awaiting demo approval. Nothing has executed.` }); },
    onError: (e) => toast({ title: "Exercise rejected", description: (e as Error)?.message ?? "Check scope and authorization.", variant: "destructive" }),
    onSettled: invalidate,
  });
  const doAct = (action: ExerciseActionAction) => current && act.mutate({ id: current.id, data: { action } }, {
    onSuccess: (e) => toast({ title: action === "approve" ? "Demo approval recorded" : action === "advance" ? "Simulated step recorded" : "Exercise stopped", description: `${e.title} · ${e.status}` }),
    onError: (e) => toast({ title: "Action failed", description: (e as Error)?.message ?? "Retry.", variant: "destructive" }),
    onSettled: invalidate,
  });

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const status = current ? st(current.status) : "";
  const busy = act.isPending;
  const hasPending = current?.steps.some((s) => st(s.status) === "pending") ?? false;
  const done = current?.steps.filter((s) => st(s.status) === "completed").length ?? 0;
  const assetOf = (id: string) => assets.find((a) => a.id === id);

  return (
    <div>
      <PageHead kicker="Red Team" title="Adversary Simulation Exercises" sub="Tabletop walk-throughs of attacker behaviour against demo assets. Every step is a human checkpoint; nothing runs on its own." />
      <div className="mx-4 mb-3 flex items-start gap-3 rounded border border-destructive/40 bg-destructive/10 p-3 md:mx-5" data-testid="notice-demo">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="text-xs leading-relaxed">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-destructive">Demo only · no traffic · no execution</div>
          No packets are sent and no commands, exploits or payloads are executed. Outcomes are scripted <b>simulated</b> examples, never measured results. Detection is <b>Not assessed</b> — no monitoring telemetry is connected. "Approve" is a demo acknowledgement, not real RBAC authorization.
        </div>
      </div>
      <div className="grid gap-3 px-4 md:px-5 xl:grid-cols-12">
        <div className="space-y-3 xl:col-span-5">
          <Panel kicker="Scenario Library" title="Plan An Exercise">
            <div className="space-y-3 text-xs">
              <div className="grid gap-2 sm:grid-cols-2">
                {SCENARIOS.map((s) => (
                  <button key={s.id} onClick={() => setScenario(s.id)} data-testid={`button-scenario-${s.id}`}
                    className={cn("rounded border p-3 text-left transition-colors", scenario === s.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40")}>
                    <div className="flex items-center gap-2 font-display text-[13px] font-semibold"><Crosshair className={cn("h-3.5 w-3.5", scenario === s.id ? "text-primary" : "text-muted-foreground")} />{s.title}</div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{s.id}</div>
                  </button>
                ))}
              </div>
              <div className="rounded border border-border bg-background/40 p-3">
                <div className="font-mono text-[10px] uppercase tracking-wider text-primary">Objective</div>
                <p className="mt-1 leading-relaxed text-foreground/85">{sc.objective}</p>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-primary">Prerequisites</div>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">{sc.prereqs.map((p) => <li key={p} className="flex gap-1.5"><span className="text-primary">·</span>{p}</li>)}</ul>
              </div>
              <div>
                <div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Asset scope</span><span className="font-mono text-[10px] text-muted-foreground">{picked.length}/10 selected</span></div>
                {eligible.length === 0 ? <EmptyState title="No Eligible Assets" body="No Enterprise IT or Industrial DMZ demo assets exist in this workspace." /> : (
                  <ul className="scrollbar-thin mt-1 max-h-56 divide-y divide-border/40 overflow-auto rounded border border-border">
                    {eligible.map((a) => (
                      <li key={a.id}>
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted/30">
                          <Checkbox checked={picked.includes(a.id)} onCheckedChange={() => toggle(a.id)} data-testid={`checkbox-asset-${a.id}`} />
                          <span className="font-mono">{a.hostname}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{a.ip}</span>
                          <span className={cn("ml-auto rounded-sm px-1.5 font-mono text-[9px] uppercase", a.zone === DMZ ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary")}>{a.zone === DMZ ? "DMZ" : "IT"}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {(err || tooMany) && <p className="mt-1 text-[11px] text-destructive" data-testid="text-scope-error">{tooMany ? "Select at most 10 assets." : err}</p>}
              </div>
              <label className="flex items-start gap-2 rounded border border-accent/25 bg-accent/5 p-2.5">
                <Checkbox checked={auth} onCheckedChange={(c) => setAuth(c === true)} data-testid="checkbox-exercise-authorized" className="mt-0.5" />
                <span className="text-[11px] leading-relaxed">I confirm the selected demo assets are within the authorized scope 192.168.10.0/24 and understand this is a tabletop simulation — no traffic, no execution.</span>
              </label>
              <button onClick={submit} disabled={!canCreate} data-testid="button-create-exercise" className="flex w-full items-center justify-center gap-2 rounded bg-primary py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40">
                <Play className="h-4 w-4" />{create.isPending ? "Drafting" : "Draft demo exercise"}
              </button>
            </div>
          </Panel>

          <Panel kicker="History" title="Saved Exercises" bodyClass="p-0">
            {list.isLoading ? <div className="space-y-2 p-4"><Skel className="h-10" /><Skel className="h-10" /></div>
              : list.isError ? <ErrorState onRetry={() => list.refetch()} message="Could not load exercises." />
              : exercises.length === 0 ? <EmptyState title="No Exercises Yet" body="Pick a scenario, scope assets and draft your first demo exercise." />
              : (
                <ul className="scrollbar-thin max-h-[320px] divide-y divide-border/50 overflow-auto">
                  {exercises.map((e) => {
                    const d = e.steps.filter((s) => st(s.status) === "completed").length;
                    return (
                      <li key={e.id}>
                        <button onClick={() => setSel(e.id)} data-testid={`row-exercise-${e.id}`} className={cn("w-full px-4 py-2 text-left hover:bg-muted/30", current?.id === e.id && "bg-muted/40")}>
                          <div className="flex items-center justify-between gap-2 text-xs"><span className="truncate font-medium">{e.title}</span><span className={cn("font-mono uppercase", statusTone(e.status))}>{e.status}</span></div>
                          <div className="mt-1 h-0.5 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${e.steps.length ? (d / e.steps.length) * 100 : 0}%` }} /></div>
                          <div className="mt-1 font-mono text-[10px] text-muted-foreground">{e.scenario} · {e.assetIds.length} asset(s) · {d}/{e.steps.length} steps · {fmtTime(e.createdAt)}</div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
          </Panel>
        </div>

        <div className="space-y-3 xl:col-span-7">
          {!current ? (
            <Panel kicker="Detail" title="No Exercise Selected"><EmptyState title="Nothing To Review" body="Draft or select an exercise to see its checkpoint timeline." /></Panel>
          ) : (
            <Panel kicker={`Exercise ${current.id.slice(0, 8)}`} title={<span className="capitalize">{current.title}</span>}
              action={<button onClick={() => download(current, assets)} data-testid="button-download-report" className="flex items-center gap-1.5 rounded border border-border px-2 py-1 font-mono text-[10px] uppercase text-muted-foreground hover:border-primary/50 hover:text-primary"><Download className="h-3 w-3" />Report</button>}>
              <div className="space-y-4 text-xs">
                <p className="leading-relaxed text-foreground/85">{current.objective}</p>
                <div className="grid grid-cols-2 gap-2 font-mono text-[10px] sm:grid-cols-4">
                  {[["Status", <span className={cn("uppercase", statusTone(current.status))}>{current.status}</span>], ["Created", fmtTime(current.createdAt)], ["Demo approval", current.approvedAt ? fmtTime(current.approvedAt) : "pending"], ["Detection", <span className="text-accent">{current.detection || "Not assessed"}</span>]].map(([k, v]) => (
                    <div key={k as string} className="rounded border border-border bg-background/40 p-2"><div className="uppercase tracking-wider text-muted-foreground">{k}</div><div className="mt-0.5 text-[11px] text-foreground">{v}</div></div>
                  ))}
                </div>
                <p className="font-mono text-[10px] text-muted-foreground">Detection: Not assessed — no monitoring telemetry connected.</p>
                <div className="flex flex-wrap gap-1">{current.assetIds.map((id) => { const a = assetOf(id); return <span key={id} className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px]">{a ? `${a.hostname} · ${a.zone}` : id}</span>; })}</div>

                <div className="flex flex-wrap gap-2">
                  <button onClick={() => doAct("approve")} disabled={busy || status !== "draft"} data-testid="button-approve" className="flex items-center gap-1.5 rounded border border-accent/50 bg-accent/10 px-3 py-1.5 font-semibold text-accent disabled:opacity-35"><ShieldCheck className="h-3.5 w-3.5" />Acknowledge (demo approve)</button>
                  <button onClick={() => doAct("advance")} disabled={busy || status !== "running" || !hasPending} data-testid="button-advance" className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-35"><StepForward className="h-3.5 w-3.5" />Run next simulated step</button>
                  <button onClick={() => doAct("stop")} disabled={busy || isTerminal(current)} data-testid="button-stop" className="flex items-center gap-1.5 rounded border border-destructive/50 px-3 py-1.5 font-semibold text-destructive disabled:opacity-35"><Square className="h-3.5 w-3.5" />Stop</button>
                </div>
                <p className="text-[11px] text-muted-foreground">{status === "draft" ? "Draft — acknowledge to begin. No step proceeds without your click." : status === "running" ? `Checkpoint ${done + 1} of ${current.steps.length}. Review, then advance manually.` : status === "completed" ? "All simulated steps reviewed." : "Stopped. Remaining steps cancelled. Report remains downloadable."}</p>

                <ol className="relative space-y-3 border-l border-border pl-5">
                  {current.steps.map((s, i) => {
                    const v = st(s.status);
                    return (
                      <li key={i} className="relative" data-testid={`step-${i}`}>
                        <span className={cn("absolute -left-[27px] top-0.5 grid h-4 w-4 place-items-center rounded-full border text-[9px]", v === "completed" ? "border-primary bg-primary text-primary-foreground" : v === "cancelled" ? "border-destructive/50 text-destructive" : "border-border bg-card text-muted-foreground")}>{v === "completed" ? <Check className="h-2.5 w-2.5" /> : i + 1}</span>
                        <div className="flex flex-wrap items-center gap-2"><span className={cn("font-medium", v === "cancelled" && "text-muted-foreground line-through")}>{s.title}</span><span className="font-mono text-[10px] text-muted-foreground">{s.technique}</span><span className="ml-auto font-mono text-[10px] uppercase text-muted-foreground">{s.status}</span></div>
                        {v === "completed" && (
                          <div className="mt-1.5 space-y-1.5 rounded border border-border/60 bg-background/40 p-2.5">
                            {s.outcome && <span className={cn("inline-block rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase", outcomeTone(s.outcome))}>Simulated · {s.outcome}</span>}
                            {s.evidence && <div><span className="text-foreground/80">Illustrative evidence. </span><span className="text-muted-foreground">{s.evidence}</span></div>}
                            {s.mitigation && <div><span className="text-primary">Mitigation. </span><span className="text-muted-foreground">{s.mitigation}</span></div>}
                            {s.timestamp && <div className="font-mono text-[10px] text-muted-foreground">{fmtTime(s.timestamp)}</div>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </Panel>
          )}
          {!list.isLoading && !list.isError && <ExerciseRecommendations exercise={current} />}
          <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> Simulated outcomes only. No exploitation, traffic or command execution occurs.</div>
        </div>
      </div>
    </div>
  );
}
