import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSaveExecutiveInsights, getGetWorkspaceQueryKey, InsightRowRating } from "@workspace/api-client-react";
import type { ExecutiveInsightsConfig, InsightRow, InsightSection, InsightSectionKey, Workspace } from "@workspace/api-client-react";
import { AlertTriangle, Cpu, PenLine, Plus, RotateCcw, Save, Trash2, Undo2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCanWrite } from "@/lib/team-auth";
import { BRIEFING_ROWS, META, SECTION_KEYS, autoPreview, autoWhen, directionOf, fmtDate, fmtMoney, newRowId, normalizeConfig, validateSection, type RowCol } from "@/lib/insights";

const inputCls = "mt-1 w-full rounded border border-input bg-background/60 px-2.5 py-1.5 text-[13px] outline-none focus:border-primary aria-[invalid=true]:border-destructive";
const lbl = "font-mono text-[10px] uppercase tracking-wider text-muted-foreground";

function Field({ label, error, children, hint, className }: { label: string; error?: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className={lbl}>{label}</span>
      {children}
      {error ? <span className="mt-0.5 block text-[11px] text-destructive">{error}</span> : hint ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function NumInput({ value, onChange, testId, invalid, step }: { value?: number; onChange: (n?: number) => void; testId: string; invalid?: boolean; step?: string }) {
  return <input type="number" min={0} step={step ?? "any"} value={value ?? ""} aria-invalid={invalid} data-testid={testId}
    onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className={inputCls} />;
}

const dateOnly = (s?: string) => (s && !isNaN(Date.parse(s)) ? new Date(s).toISOString().slice(0, 10) : s ?? "");

export function ExecutiveInsightsEditor({ ws, refetch }: { ws: Workspace; refetch: () => Promise<{ data?: Workspace }> }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const save = useSaveExecutiveInsights();
  const serverJson = JSON.stringify(ws.executiveInsights ?? null);
  const server = useMemo(() => normalizeConfig(ws.executiveInsights), [serverJson]); // eslint-disable-line react-hooks/exhaustive-deps
  const [base, setBase] = useState<ExecutiveInsightsConfig>(server);
  const [draft, setDraft] = useState<ExecutiveInsightsConfig>(server);
  const [active, setActive] = useState<InsightSectionKey>("briefing");
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft.sections) !== JSON.stringify(base.sections);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Adopt server changes only when there is no unsaved draft; dirty drafts survive polling.
  useEffect(() => {
    if (!dirtyRef.current && server.revision !== base.revision) { setBase(server); setDraft(server); }
  }, [server]); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = useMemo(() => Object.fromEntries(draft.sections.map((s) => [s.key, validateSection(s)])) as Record<InsightSectionKey, Record<string, string>>, [draft]);
  const errorCount = Object.values(errors).reduce((n, e) => n + Object.keys(e).length, 0);
  const newerOnServer = dirty && server.revision > base.revision;

  const patch = (key: InsightSectionKey, fn: (s: InsightSection) => InsightSection) =>
    setDraft((d) => ({ ...d, sections: d.sections.map((s) => (s.key === key ? fn(s) : s)) }));

  const reload = async () => {
    try {
      const r = await refetch();
      if (!r.data || ("isError" in r && r.isError)) throw new Error("Could not reload the saved configuration. Your draft is kept.");
      const n = normalizeConfig(r.data.executiveInsights);
      setBase(n); setDraft(n); setConflict(false); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reload failed. Your draft is kept.");
    }
  };

  const submit = () => {
    setError(null);
    save.mutate({ data: { ...draft, revision: base.revision } }, {
      onSuccess: (cfg) => {
        const n = normalizeConfig(cfg);
        setBase(n); setDraft(n); setConflict(false);
        qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
        toast({ title: "Executive Insights Saved", description: `Revision ${n.revision}` });
      },
      onError: (e) => {
        const status = (e as { status?: number })?.status;
        if (status === 409) setConflict(true);
        else setError(e instanceof Error ? e.message : "The server rejected the configuration.");
      },
    });
  };

  const s = draft.sections.find((x) => x.key === active)!;
  const sErr = errors[active];
  const sDirty = JSON.stringify(s) !== JSON.stringify(base.sections.find((x) => x.key === active));
  const m = META[active];
  const ro = !useCanWrite();

  return (
    <fieldset disabled={save.isPending} className="grid min-w-0 gap-3" data-testid="settings-executive-insights">
      {/* Status bar */}
      <div className="panel flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="text-xs">
          <div className="font-display text-[13px] font-semibold">Executive Insights Control</div>
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground" data-testid="text-insights-revision">
            Revision {base.revision} · last saved {fmtDate(base.updatedAt)} · {draft.sections.filter((x) => x.mode === "manual").length} of 10 manual
            {dirty && <span className="ml-2 text-accent" data-testid="text-insights-dirty">Unsaved changes</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {errorCount > 0 && dirty && <span className="font-mono text-[10px] text-destructive" data-testid="text-insights-errors">{errorCount} field{errorCount === 1 ? "" : "s"} need attention</span>}
          <button type="button" onClick={() => { setDraft(base); setError(null); }} disabled={ro || !dirty || save.isPending} data-testid="button-insights-reset"
            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" />Discard All Changes</button>
          <button type="button" onClick={submit} disabled={ro || !dirty || errorCount > 0 || save.isPending || conflict} data-testid="button-insights-save"
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"><Save className="h-3.5 w-3.5" />{save.isPending ? "Saving" : "Save Insights"}</button>
        </div>
      </div>

      {conflict && (
        <div role="alert" data-testid="alert-insights-conflict" className="flex flex-col gap-2 rounded border border-destructive/50 bg-destructive/10 p-3 text-xs md:flex-row md:items-center">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1"><div className="font-semibold">Save Conflict</div>Someone saved a newer revision since you started editing. Your draft is kept and nothing was saved. Reloading replaces your draft with the server version.</div>
          <button type="button" onClick={reload} data-testid="button-insights-reload" className="rounded border border-destructive/50 px-3 py-1.5 text-destructive hover:bg-destructive/10">Reload Server Version</button>
        </div>
      )}
      {error && <div role="alert" data-testid="alert-insights-error" className="rounded border border-destructive/50 bg-destructive/10 p-3 text-xs"><span className="font-semibold">Save Failed. </span>{error} Your draft is kept.</div>}
      {newerOnServer && !conflict && (
        <div data-testid="alert-insights-newer" className="flex items-center gap-2 rounded border border-accent/40 bg-accent/10 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-accent" /><span className="flex-1">Revision {server.revision} is now on the server. Saving this draft will be rejected.</span>
          <button type="button" onClick={reload} className="rounded border border-accent/50 px-2 py-1 text-accent">Reload Server Version</button>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[240px_1fr]">
        {/* Section index */}
        <nav aria-label="Insight sections" className="panel h-fit p-1.5">
          <ol>
            {SECTION_KEYS.map((k, i) => {
              const sec = draft.sections.find((x) => x.key === k)!;
              const bad = Object.keys(errors[k]).length > 0;
              const changed = JSON.stringify(sec) !== JSON.stringify(base.sections.find((x) => x.key === k));
              return (
                <li key={k}>
                  <button type="button" onClick={() => setActive(k)} data-testid={`insight-nav-${k}`} aria-current={active === k ? "true" : undefined}
                    className={`flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[12px] transition-colors ${active === k ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`}>
                    <span className="w-4 font-mono text-[10px] text-muted-foreground/70">{String(i + 1).padStart(2, "0")}</span>
                    <span className="flex-1 truncate">{META[k].title}</span>
                    {changed && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Unsaved" />}
                    {bad && <AlertTriangle className="h-3 w-3 text-destructive" />}
                    {sec.mode === "manual" ? <PenLine className="h-3 w-3 text-accent" /> : <Cpu className="h-3 w-3 text-primary/70" />}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Section editor */}
        <fieldset disabled={ro} aria-describedby={ro ? "insights-readonly-note" : undefined} className="min-w-0">
        {ro && <p id="insights-readonly-note" data-testid="text-insights-readonly" className="mb-2 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">Read-Only View. Fields are shown for reference; only administrators can change Executive Insights.</p>}
        <section className="panel p-4 md:p-5" data-testid={`insight-editor-${active}`} key={active}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="font-display text-lg font-semibold">{m.title}</h3>
              <p className="mt-0.5 max-w-xl text-[12px] text-muted-foreground">{m.what} {m.why}</p>
            </div>
            <div role="radiogroup" aria-label={`${m.title} mode`} className="flex flex-wrap rounded border border-border p-0.5">
              {(["automated", "manual"] as const).map((mode) => (
                <button key={mode} type="button" role="radio" aria-checked={s.mode === mode} data-testid={`mode-${active}-${mode}`}
                  onClick={() => patch(active, (x) => ({ ...x, mode }))}
                  className={`flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs ${s.mode === mode ? (mode === "manual" ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary") : "text-muted-foreground hover:text-foreground"}`}>
                  {mode === "manual" ? <PenLine className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}{mode === "manual" ? "Manual Entry" : "Automated Computation"}
                </button>
              ))}
            </div>
          </div>
          {sDirty && <button type="button" onClick={() => patch(active, () => base.sections.find((x) => x.key === active)!)} data-testid={`button-revert-${active}`} className="mt-2 flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-primary"><Undo2 className="h-3 w-3" />Revert This Section</button>}

          {/* Automated reference: always from raw workspace */}
          <div className={`mt-4 rounded border ${s.mode === "automated" ? "border-primary/30 bg-primary/[0.04]" : "border-border/60 bg-muted/10"} p-3`}>
            <div className={lbl}>{s.mode === "automated" ? "Live Automated Preview" : "Automated Reference (raw workspace, not shown while manual)"}</div>
            <dl className="mt-2 grid gap-1 text-[12px]" data-testid={`auto-preview-${active}`}>
              {autoPreview(active, ws).map(([k, v], i) => (
                <div key={i} className="grid grid-cols-[minmax(120px,200px)_1fr] gap-3"><dt className="truncate text-muted-foreground">{k}</dt><dd className="font-mono text-[11px]">{v}</dd></div>
              ))}
            </dl>
            <div className="mt-3 grid gap-1.5 border-t border-border/50 pt-2 text-[11px] text-muted-foreground">
              <div><span className="text-primary/80">Where </span>{m.auto.where}</div>
              <div><span className="text-primary/80">When </span>{autoWhen(active, ws)}</div>
              <div><span className="text-primary/80">Who </span>{m.auto.who}</div>
              <div><span className="text-primary/80">How </span>{m.auto.how}</div>
            </div>
          </div>

          {s.mode === "manual" && (
            <div className="mt-4 grid gap-4">
              <div className="rounded border border-accent/30 bg-accent/[0.05] p-3 text-[11px] text-muted-foreground"><span className="text-accent">How manual entry is interpreted. </span>{m.manualHow} Manual values never modify scans, findings, assets or drill-down evidence.</div>
              <fieldset className="grid gap-3 md:grid-cols-2">
                <legend className={`${lbl} mb-2`}>Provenance (Required)</legend>
                <Field label="Source" error={sErr.source} hint="Where the figures come from."><input value={s.source ?? ""} maxLength={1000} aria-invalid={!!sErr.source} data-testid={`field-${active}-source`} onChange={(e) => patch(active, (x) => ({ ...x, source: e.target.value }))} className={inputCls} /></Field>
                <Field label="Owner" error={sErr.owner} hint="Declared, not authenticated."><input value={s.owner ?? ""} maxLength={200} aria-invalid={!!sErr.owner} data-testid={`field-${active}-owner`} onChange={(e) => patch(active, (x) => ({ ...x, owner: e.target.value }))} className={inputCls} /></Field>
                <Field label="As Of" error={sErr.asOf}><input type="date" value={dateOnly(s.asOf)} aria-invalid={!!sErr.asOf} data-testid={`field-${active}-asOf`} onChange={(e) => patch(active, (x) => ({ ...x, asOf: e.target.value }))} className={inputCls} /></Field>
                <Field label="Reason For Manual Entry" error={sErr.reason}><input value={s.reason ?? ""} maxLength={1000} aria-invalid={!!sErr.reason} data-testid={`field-${active}-reason`} onChange={(e) => patch(active, (x) => ({ ...x, reason: e.target.value }))} className={inputCls} /></Field>
                <Field label="Headline (Optional)" className="md:col-span-2"><input value={s.headline ?? ""} maxLength={300} data-testid={`field-${active}-headline`} onChange={(e) => patch(active, (x) => ({ ...x, headline: e.target.value || undefined }))} className={inputCls} /></Field>
                <Field label={active === "direction" ? "Narrative (State Comparison Periods)" : "Narrative (Optional)"} className="md:col-span-2"><textarea rows={3} value={s.narrative ?? ""} maxLength={3000} data-testid={`field-${active}-narrative`} onChange={(e) => patch(active, (x) => ({ ...x, narrative: e.target.value || undefined }))} className={inputCls} /></Field>
              </fieldset>
              <SpecificFields s={s} err={sErr} patch={(fn) => patch(active, fn)} />
            </div>
          )}
        </section>
        </fieldset>
      </div>
    </fieldset>
  );
}

function SpecificFields({ s, err, patch }: { s: InsightSection; err: Record<string, string>; patch: (fn: (s: InsightSection) => InsightSection) => void }) {
  const k = s.key;
  const setRow = (id: string, p: Partial<InsightRow>) => patch((x) => ({ ...x, rows: x.rows.map((r) => (r.id === id ? { ...r, ...p } : r)) }));

  if (k === "briefing") return (
    <fieldset className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <legend className={`${lbl} mb-2`}>Briefing Counts</legend>
      {BRIEFING_ROWS.map((r) => (
        <Field key={r.id} label={r.label} error={err[`row.${r.id}.value`]}>
          <NumInput step="1" value={s.rows.find((x) => x.id === r.id)?.value} invalid={!!err[`row.${r.id}.value`]} testId={`field-briefing-${r.id}`} onChange={(n) => setRow(r.id, { value: n })} />
        </Field>
      ))}
    </fieldset>
  );
  if (k === "technical") return (
    <Field label="Index (0 To 100)" error={err.value} hint="Will be labelled as declared, not measured." className="max-w-xs">
      <NumInput value={s.value} invalid={!!err.value} testId="field-technical-value" onChange={(n) => patch((x) => ({ ...x, value: n }))} />
    </Field>
  );
  if (k === "financial") return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Currency" error={err.unit}><input value={s.unit ?? ""} maxLength={3} aria-invalid={!!err.unit} data-testid="field-financial-unit" onChange={(e) => patch((x) => ({ ...x, unit: e.target.value.toUpperCase() }))} className={inputCls} placeholder="PHP" /></Field>
        <Field label="Lower Bound" error={err.value}><NumInput value={s.value} invalid={!!err.value} testId="field-financial-value" onChange={(n) => patch((x) => ({ ...x, value: n }))} /></Field>
        <Field label="Upper Bound" error={err.secondaryValue}><NumInput value={s.secondaryValue} invalid={!!err.secondaryValue} testId="field-financial-secondaryValue" onChange={(n) => patch((x) => ({ ...x, secondaryValue: n }))} /></Field>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">A range estimate of potential loss. It is not a probability and not an expected annual loss.
        {s.value !== undefined && s.secondaryValue !== undefined && /^[A-Z]{3}$/.test(s.unit ?? "") && <> Preview: <span className="text-foreground">{fmtMoney(s.value, s.unit!)} to {fmtMoney(s.secondaryValue, s.unit!)}</span></>}</p>
    </div>
  );
  if (k === "direction") {
    const d = s.value !== undefined && s.secondaryValue !== undefined ? directionOf(s.value, s.secondaryValue) : null;
    return (
      <div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Current Index (0 To 100)" error={err.value}><NumInput value={s.value} invalid={!!err.value} testId="field-direction-value" onChange={(n) => patch((x) => ({ ...x, value: n }))} /></Field>
          <Field label="Previous Index (0 To 100)" error={err.secondaryValue}><NumInput value={s.secondaryValue} invalid={!!err.secondaryValue} testId="field-direction-secondaryValue" onChange={(n) => patch((x) => ({ ...x, secondaryValue: n }))} /></Field>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground" data-testid="preview-direction">Delta = current minus previous. {d ? <>Result: <span className="text-foreground">{d.delta > 0 ? "+" : ""}{d.delta} · {d.label}</span></> : "Enter both values to preview."}</p>
      </div>
    );
  }
  return <RowsEditor s={s} err={err} patch={patch} setRow={setRow} />;
}

function RowsEditor({ s, err, patch, setRow }: { s: InsightSection; err: Record<string, string>; patch: (fn: (s: InsightSection) => InsightSection) => void; setRow: (id: string, p: Partial<InsightRow>) => void }) {
  const m = META[s.key];
  const cols = m.rowCols!;
  const max = m.maxRows ?? 100;
  const add = () => patch((x) => ({ ...x, rows: [...x.rows, { id: newRowId(), label: "", ...(s.key === "themes" ? { rating: "Elevated" as const } : {}) }] }));
  const cell = (r: InsightRow, c: RowCol) => {
    const e = err[`row.${r.id}.${c.f}`];
    const tid = `field-${s.key}-row-${r.id}-${c.f}`;
    let input: ReactNode;
    if (c.kind === "number") input = <NumInput value={r[c.f] as number | undefined} invalid={!!e} testId={tid} onChange={(n) => setRow(r.id, { [c.f]: n })} />;
    else if (c.kind === "rating") input = (
      <select value={r.rating ?? ""} aria-invalid={!!e} data-testid={tid} onChange={(ev) => setRow(r.id, { rating: ev.target.value as InsightRow["rating"] })} className={inputCls}>
        <option value="" disabled>Select</option>{Object.values(InsightRowRating).map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    );
    else if (c.kind === "textarea") input = <textarea rows={2} value={(r[c.f] as string) ?? ""} maxLength={2000} aria-invalid={!!e} data-testid={tid} onChange={(ev) => setRow(r.id, { [c.f]: ev.target.value || undefined })} className={inputCls} />;
    else if (c.kind === "date") input = <input type="date" value={dateOnly(r.observedAt)} aria-invalid={!!e} data-testid={tid} onChange={(ev) => setRow(r.id, { observedAt: ev.target.value || undefined })} className={inputCls} />;
    else input = <input value={(r[c.f] as string) ?? ""} maxLength={c.f === "label" ? 200 : c.f === "owner" ? 200 : 500} aria-invalid={!!e} data-testid={tid} onChange={(ev) => setRow(r.id, { [c.f]: c.f === "label" ? ev.target.value : ev.target.value || undefined })} className={inputCls} />;
    return <Field key={c.f} label={c.label + (c.required ? "" : " (Optional)")} error={e} className={c.wide ? "sm:col-span-2" : ""}>{input}</Field>;
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className={lbl}>{m.rowNoun} Rows ({s.rows.length}{m.maxRows ? ` of ${max}` : ""})</span>
        <button type="button" onClick={add} disabled={s.rows.length >= max} data-testid={`button-add-row-${s.key}`} className="flex items-center gap-1 rounded border border-primary/40 px-2.5 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-40"><Plus className="h-3 w-3" />Add {m.rowNoun}</button>
      </div>
      {err.rows && <div className="mb-2 text-[11px] text-destructive">{err.rows}</div>}
      {s.rows.length === 0 ? (
        <div className="rounded border border-dashed border-border p-6 text-center text-[12px] text-muted-foreground" data-testid={`empty-rows-${s.key}`}>
          No rows. {s.key === "decisions" ? "Zero manual decisions will be displayed." : `Add a ${m.rowNoun!.toLowerCase()} to display it.`}
        </div>
      ) : (
        <ol className="grid gap-2">
          {s.rows.map((r, i) => (
            <li key={r.id} className="rounded border border-border/70 bg-background/30 p-3" data-testid={`row-editor-${s.key}-${r.id}`}>
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[10px] text-muted-foreground">{m.rowNoun} {String(i + 1).padStart(2, "0")}
                  </span>
                <button type="button" onClick={() => patch((x) => ({ ...x, rows: x.rows.filter((y) => y.id !== r.id) }))} data-testid={`button-remove-row-${s.key}-${r.id}`} aria-label={`Remove ${m.rowNoun} ${i + 1}`} className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3 w-3" />Remove</button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">{cols.map((c) => cell(r, c))}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
