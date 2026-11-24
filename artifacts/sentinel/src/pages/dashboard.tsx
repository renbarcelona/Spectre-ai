import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowUpRight, ChevronRight, ShieldAlert, Scale, TrendingUp, Gavel, FileSearch, Server } from "lucide-react";
import type { Asset, InsightSection, InsightSectionKey, Vulnerability, Workspace } from "@workspace/api-client-react";
import { InsightProvenance } from "@/components/insight-provenance";
import { directionOf, fmtDate, fmtMoney, normalizeConfig, rowVal, sectionMap } from "@/lib/insights";
import { PageHead } from "@/components/shell";
import { Panel, SevBadge, RiskBar, PageSkeleton, ErrorState, EmptyState, Illustrative } from "@/components/kit";
import { useWorkspace, riskColor, tactic, scenario, service } from "@/lib/sentinel";
import { buildThemes, ratingFromThemes, isOpen, themeOf, THEMES, RATING_COLOR, rate, pct, sevWeight, type Rating, type ThemeId, type ThemeSummary } from "@/lib/risk-model";
import { LiveThreatMap } from "@/components/live-threat-map";

type View =
  | { level: "board" }
  | { level: "executive"; theme: ThemeId }
  | { level: "manager"; theme?: ThemeId; assetId: string }
  | { level: "analyst"; theme?: ThemeId; assetId: string; vulnId: string };

const LEVELS = ["Board", "Executive", "Manager", "Analyst"] as const;
const levelIdx = (v: View) => ({ board: 0, executive: 1, manager: 2, analyst: 3 })[v.level];

function Tag({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className="inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider" style={{ color: tone ?? "hsl(215 14% 62%)", borderColor: tone ? tone.replace(")", " / .35)") : "hsl(216 22% 22%)" }}>{children}</span>;
}

function DrillRow({ onClick, children, testId, label }: { onClick: () => void; children: ReactNode; testId?: string; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} data-testid={testId}
      className="group flex w-full items-center gap-3 border-b border-border/40 px-4 py-3 text-left transition-colors last:border-0 hover:bg-primary/[0.06] focus-visible:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60">
      <div className="min-w-0 flex-1">{children}</div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}

function KeyFigure({ icon, label, value, tone, note, badge, meta, testId }: { icon: ReactNode; label: string; value: ReactNode; tone?: string; note: string; badge?: ReactNode; meta?: ReactNode; testId: string }) {
  return (
    <div className="panel rise relative flex flex-col gap-2 p-4" data-testid={`section-${testId}`}>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{icon}{label}</div>
      <div className="font-display text-2xl font-semibold leading-none" style={{ color: tone }} data-testid={`${testId}-value`}>{value}</div>
      <p className="text-[11px] leading-snug text-muted-foreground">{note}</p>
      {badge && <div>{badge}</div>}
      {meta && <div className="mt-auto border-t border-border/40 pt-2">{meta}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { data: ws, isLoading, isError, refetch } = useWorkspace();
  const [view, setView] = useState<View>({ level: "board" });
  const selection = useRef<{ theme?: ThemeId; assetId?: string; vulnId?: string }>({});
  const consoleRef = useRef<HTMLDivElement>(null);
  const themes = useMemo(() => (ws ? buildThemes(ws) : []), [ws]);
  const cfg = useMemo(() => normalizeConfig(ws?.executiveInsights), [ws?.executiveInsights]);
  const ins = useMemo(() => sectionMap(cfg), [cfg]);

  if (isLoading) return <PageSkeleton />;
  if (isError || !ws) return <ErrorState onRetry={() => refetch()} />;

  const go = (v: View) => {
    if (v.level === "executive") {
      if (selection.current.theme !== v.theme) selection.current = { theme: v.theme };
    } else if (v.level === "manager") {
      selection.current = { theme: v.theme, assetId: v.assetId, vulnId: selection.current.assetId === v.assetId ? selection.current.vulnId : undefined };
    } else if (v.level === "analyst") {
      selection.current = { theme: v.theme, assetId: v.assetId, vulnId: v.vulnId };
    }
    setView(v);
    requestAnimationFrame(() => {
      consoleRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
      consoleRef.current?.focus({ preventScroll: true });
    });
  };
  const back = () => {
    if (view.level === "analyst") go({ level: "manager", theme: view.theme, assetId: view.assetId });
    else if (view.level === "manager") go(view.theme ? { level: "executive", theme: view.theme } : { level: "board" });
    else go({ level: "board" });
  };

  const assetById = new Map(ws.assets.map((a) => [a.id, a]));
  const crumbs: { label: string; to?: View }[] = [{ label: "Board", to: { level: "board" } }];
  if (view.level !== "board") {
    const th = view.level === "executive" ? view.theme : view.theme;
    if (th) crumbs.push({ label: THEMES[th].name, to: { level: "executive", theme: th } });
    if (view.level === "manager" || view.level === "analyst") crumbs.push({ label: assetById.get(view.assetId)?.hostname ?? "Unknown asset", to: { level: "manager", theme: view.theme, assetId: view.assetId } });
    if (view.level === "analyst") crumbs.push({ label: ws.vulnerabilities.find((v) => v.id === view.vulnId)?.cve || "Finding" });
  }

  const idx = levelIdx(view);
  const selectedTheme = themes.find(t => t.id === selection.current.theme) ?? themes[0];
  const selectedAsset = ws.assets.find(a => a.id === selection.current.assetId)
    ?? selectedTheme?.assets[0] ?? [...ws.assets].sort((a, b) => b.risk - a.risk)[0];
  const availableFindings = ws.vulnerabilities.filter(v => isOpen(v) && v.assetId === selectedAsset?.id)
    .sort((a, b) => Number(b.kev) - Number(a.kev) || b.score - a.score);
  const selectedFinding = availableFindings.find(v => v.id === selection.current.vulnId) ?? availableFindings[0];
  const destinations: (View | undefined)[] = [
    { level: "board" },
    selectedTheme && { level: "executive", theme: selectedTheme.id },
    selectedAsset && { level: "manager", theme: selectedTheme?.assets.some(a => a.id === selectedAsset.id) ? selectedTheme.id : undefined, assetId: selectedAsset.id },
    selectedFinding && { level: "analyst", theme: themeOf(selectedFinding), assetId: selectedFinding.assetId, vulnId: selectedFinding.id },
  ];

  return (
    <div>
      <PageHead kicker="Cyber Risk Decision Platform" title="Business Risk Briefing" sub={`Assessment evidence from ${ws.assets.length} assets · demo scope 192.168.10.0/24 · mode ${ws.mode}`} />
      <div className="-mt-1 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 font-mono text-[10px] text-muted-foreground md:px-5" data-testid="text-insights-status">
        <span>Executive Insights revision {cfg.revision}</span>
        <span>Last saved {cfg.updatedAt ? fmtDate(cfg.updatedAt) : "never (all defaults automated)"}</span>
        <span>{cfg.sections.filter((x) => x.mode === "manual").length} of {cfg.sections.length} sections manual</span>
        <Link href="/settings?section=executive-insights" className="text-primary hover:underline" data-testid="link-insights-settings">Configure</Link>
      </div>
      <div className="grid gap-3 px-4 pb-8 md:px-5">
        <div ref={consoleRef} tabIndex={-1} className="scroll-mt-16 outline-none" aria-live="polite">
          {/* Level rail + breadcrumb */}
          <nav aria-label="Dashboard drill-down" className="panel mb-3 flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              {view.level !== "board" && (
                <button type="button" onClick={back} data-testid="button-drill-back" className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:border-primary/50 hover:text-primary">
                  <ArrowLeft className="h-3 w-3" /> Back
                </button>
              )}
              <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[12px]">
                {crumbs.map((c, i) => (
                  <li key={i} className="flex min-w-0 items-center gap-1">
                    {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden />}
                    {c.to && i < crumbs.length - 1
                      ? <button type="button" onClick={() => go(c.to!)} className="truncate text-muted-foreground hover:text-primary hover:underline">{c.label}</button>
                      : <span aria-current="page" className="truncate font-medium text-foreground">{c.label}</span>}
                  </li>
                ))}
              </ol>
            </div>
            <ol className="flex shrink-0 items-center gap-1" aria-label="Audience level">
              {LEVELS.map((l, i) => (
                <li key={l} className="flex items-center gap-1">
                  <button type="button" onClick={() => destinations[i] && go(destinations[i]!)}
                    disabled={!destinations[i]} aria-current={i === idx ? "page" : undefined}
                    data-testid={`navigate-${l.toLowerCase()}`}
                    title={destinations[i] ? `Open ${l} detail using the selected or highest-priority available item` : `No ${l.toLowerCase()} evidence available for this selection`}
                    className={`rounded-sm px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40 ${i === idx ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-primary"}`}>{l}</button>
                  {i < 3 && <span className="h-px w-3 bg-border" aria-hidden />}
                </li>
              ))}
            </ol>
          </nav>

          <div key={JSON.stringify(view)} className="rise">
            {view.level === "board" && <BoardView ws={ws} themes={themes} go={go} ins={ins} savedAt={cfg.updatedAt} />}
            {view.level === "executive" && <ExecutiveView theme={themes.find((t) => t.id === view.theme)} go={go} back={back} />}
            {view.level === "manager" && <ManagerView ws={ws} asset={assetById.get(view.assetId)} themeId={view.theme} go={go} back={back} />}
            {view.level === "analyst" && <AnalystView vuln={ws.vulnerabilities.find((v) => v.id === view.vulnId)} asset={assetById.get(view.assetId)} back={back} />}
          </div>
        </div>

        {view.level !== "board" && <PriorityAssets ws={ws} go={go} s={ins.priority} savedAt={cfg.updatedAt} />}

        <div data-testid="section-threatMap">
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
            <Tag tone="hsl(42 92% 58%)">External context</Tag>
            <span className="text-[11px] text-muted-foreground">{ins.threatMap.mode === "manual" ? "Declared external threat observations." : "Global threat activity from a third party."} Not evidence about your assets and not used in any rating above.</span>
          </div>
          <div className="mb-2 px-1"><InsightProvenance section={ins.threatMap} ws={ws} savedAt={cfg.updatedAt} /></div>
          {ins.threatMap.mode === "manual" ? (
            <Panel kicker="External threat map" title="Threat Observations (Manual Entry)" bodyClass="p-0">
              <div className="px-4 pt-3"><ManualNote s={ins.threatMap} /></div>
              {ins.threatMap.rows.length === 0 ? <EmptyState title="No observations entered" body="The owner declared no external threat observations." /> : (
                <ul className="divide-y divide-border/50">
                  {ins.threatMap.rows.map((r) => (
                    <li key={r.id} className="px-4 py-3" data-testid={`threatmap-row-${r.id}`}>
                      <div className="text-[13px] font-medium">{r.label}</div>
                      {r.detail && <p className="mt-0.5 whitespace-pre-line text-[12px] text-muted-foreground">{r.detail}</p>}
                      {r.reference && <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">Reference: {r.reference}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : <LiveThreatMap />}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Board ---------------- */

type Ins = Record<InsightSectionKey, InsightSection>;

function SectionHead({ s, ws, savedAt }: { s: InsightSection; ws: Workspace; savedAt?: string }) {
  return <InsightProvenance section={s} ws={ws} savedAt={savedAt} className="mt-1" />;
}

function ManualNote({ s }: { s: InsightSection }) {
  if (!s.headline && !s.narrative) return null;
  return (
    <div className="mb-3 text-[12px]">
      {s.headline && <div className="font-medium" data-testid={`${s.key}-manual-headline`}>{s.headline}</div>}
      {s.narrative && <p className="mt-0.5 whitespace-pre-line text-muted-foreground">{s.narrative}</p>}
    </div>
  );
}

function BoardView({ ws, themes, go, ins, savedAt }: { ws: Workspace; themes: ThemeSummary[]; go: (v: View) => void; ins: Ins; savedAt?: string }) {
  const open = ws.vulnerabilities.filter(isOpen);
  const overall = ratingFromThemes(themes);
  const decisions = themes.filter((t) => t.rating === "Severe" || t.rating === "Elevated");
  const completedScans = ws.scans.filter((s) => s.status === "completed").length;
  const assetsWithFindings = new Set(open.map((v) => v.assetId)).size;
  const kev = open.filter((v) => v.kev).length;
  const B = ins.briefing, T = ins.technical, F = ins.financial, D = ins.direction, R = ins.decisions, TH = ins.themes;
  const bManual = B.mode === "manual";
  const decisionCount = R.mode === "manual" ? R.rows.length : decisions.length;

  const counts: [string, string, ReactNode][] = bManual
    ? [["openFindings", "Open findings", rowVal(B, "openFindings")], ["knownExploited", "Known exploited", rowVal(B, "knownExploited")], ["awaitingReview", "Awaiting review", rowVal(B, "awaitingReview")], ["scansCompleted", "Scans completed", `${rowVal(B, "scansCompleted")} / ${rowVal(B, "totalScans")}`]]
    : [["openFindings", "Open findings", open.length], ["knownExploited", "Known exploited", kev], ["awaitingReview", "Awaiting review", open.filter((v) => v.status === "pending").length], ["scansCompleted", "Scans completed", `${completedScans} / ${ws.scans.length}`]];

  const dirV = D.mode === "manual" && D.value !== undefined && D.secondaryValue !== undefined ? directionOf(D.value, D.secondaryValue) : null;

  return (
    <div className="grid gap-3">
      {/* Headline */}
      {!bManual && ws.assets.length === 0 ? (
        <Panel title="No Assessment Evidence Yet" kicker="Board"><SectionHead s={B} ws={ws} savedAt={savedAt} /><EmptyState title="Nothing to brief" body="Run a demo scan of 192.168.10.0/24 so SPECTRE has evidence to reason from."><Link href="/scans" className="mt-3 inline-block rounded border border-primary/40 px-3 py-1.5 text-xs text-primary">Go to scans</Link></EmptyState></Panel>
      ) : (
      <section className="panel relative overflow-hidden p-5 md:p-6" aria-labelledby="board-headline" data-testid="section-briefing">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-20 blur-3xl" style={{ background: bManual ? "hsl(var(--accent))" : RATING_COLOR[overall] }} aria-hidden />
        <div className="relative grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Board view · what you need to know</div>
            {bManual ? (
              <>
                <h2 id="board-headline" data-testid="briefing-headline" className="font-display mt-2 text-2xl font-semibold leading-tight md:text-[28px]">{B.headline?.trim() || "Manually Entered Briefing"}</h2>
                <p className="mt-3 max-w-2xl whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground" data-testid="briefing-narrative">{B.narrative?.trim() || "Counts below were declared by the named owner and are not computed from findings in this workspace."}</p>
              </>
            ) : (
              <>
                <h2 id="board-headline" data-testid="briefing-headline" className="font-display mt-2 text-2xl font-semibold leading-tight md:text-[28px]">
                  {open.length ? <>Cyber exposure priority is <span style={{ color: RATING_COLOR[overall] }}>{overall.toLowerCase()}</span></> : <>No open findings recorded</>}
                  {R.mode === "manual" ? <>. Executive recommendations are managed separately below.</> : decisions.length > 0 ? <>, with {decisions.length} matter{decisions.length === 1 ? "" : "s"} recommended for executive decision.</> : <>. Validate coverage before concluding risk is low.</>}
                </h2>
                <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                  Based on {open.length} open finding{open.length === 1 ? "" : "s"} across {assetsWithFindings} of {ws.assets.length} assessed assets
                  {kev > 0 && <>, including <span className="text-foreground">{kev} listed in CISA KEV</span> as exploited in the wild</>}.
                  {TH.mode === "manual" ? "Business themes below are manually declared and do not determine this automated exposure rating." : "Business consequences below are potential scenarios inferred from attack techniques, not observed incidents."}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Demo prioritisation rule: Severe means KEV with a high/critical finding, or multiple critical findings in one theme. Elevated means any high, critical, or KEV finding; Guarded means medium. This is not a validated enterprise risk rating.</p>
              </>
            )}
            <div className="mt-3"><SectionHead s={B} ws={ws} savedAt={savedAt} /></div>
          </div>
          <div className="grid h-fit grid-cols-2 gap-px overflow-hidden rounded border border-border/60 bg-border/60 text-[11px]">
            {counts.map(([id, l, v]) => (
              <div key={id} className="bg-card/80 p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div><div className="font-display mt-1 text-xl font-semibold tabular-nums" data-testid={`briefing-value-${id}`}>{v}</div></div>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* Key figures */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {T.mode === "manual"
          ? <KeyFigure testId="technical" icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Technical exposure index" value={<>{T.value}<span className="text-sm text-muted-foreground"> / 100</span></>} tone={riskColor(T.value ?? 0)}
              note={T.headline || "Declared by the named owner, not measured by SPECTRE. Not a probability of loss or incident."} badge={<Tag tone="hsl(var(--accent))">Declared, not measured</Tag>} meta={<SectionHead s={T} ws={ws} savedAt={savedAt} />} />
          : <KeyFigure testId="technical" icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Technical exposure index" value={<>{ws.riskScore}<span className="text-sm text-muted-foreground"> / 100</span></>} tone={riskColor(ws.riskScore)}
              note="Stored demo seed value, not produced by a calibrated scoring engine. It is not a probability of loss or of an incident." meta={<SectionHead s={T} ws={ws} savedAt={savedAt} />} />}
        {F.mode === "manual"
          ? <KeyFigure testId="financial" icon={<Scale className="h-3.5 w-3.5" />} label="Financial exposure" value={<span className="text-xl">{fmtMoney(F.value ?? 0, F.unit ?? "USD")}<span className="text-muted-foreground"> to </span>{fmtMoney(F.secondaryValue ?? 0, F.unit ?? "USD")}</span>}
              note={F.headline || "Range estimate of potential loss. Not a probability and not an expected loss."} badge={<Tag tone="hsl(var(--accent))">Range estimate</Tag>} meta={<SectionHead s={F} ws={ws} savedAt={savedAt} />} />
          : <KeyFigure testId="financial" icon={<Scale className="h-3.5 w-3.5" />} label="Financial exposure" value={<span className="text-muted-foreground">Not assessed</span>}
              note="Requires validated inputs: asset business value, revenue dependency, recovery cost. None have been provided." badge={<Tag>Inputs needed</Tag>} meta={<SectionHead s={F} ws={ws} savedAt={savedAt} />} />}
        {dirV
          ? <KeyFigure testId="direction" icon={<TrendingUp className="h-3.5 w-3.5" />} label="Direction of travel" value={<>{dirV.label}<span className="ml-2 text-sm text-muted-foreground">{dirV.delta > 0 ? "+" : ""}{dirV.delta}</span></>}
              tone={dirV.delta < 0 ? "hsl(186 70% 55%)" : dirV.delta > 0 ? "hsl(22 90% 60%)" : undefined}
              note={`Index ${D.value} now versus ${D.secondaryValue} previously. ${D.narrative || D.headline || ""}`.trim()} meta={<SectionHead s={D} ws={ws} savedAt={savedAt} />} />
          : <KeyFigure testId="direction" icon={<TrendingUp className="h-3.5 w-3.5" />} label="Direction of travel" value={<span className="text-muted-foreground">Baseline only</span>}
              note="Comparable historical risk snapshots are not available here. Improvement or deterioration cannot yet be established." badge={<Tag>History needed</Tag>} meta={<SectionHead s={D} ws={ws} savedAt={savedAt} />} />}
        <KeyFigure testId="decisions" icon={<Gavel className="h-3.5 w-3.5" />} label="Recommended decisions" value={decisionCount} tone={decisionCount ? "hsl(22 90% 60%)" : undefined}
          note={R.mode === "manual" ? "Count of manually entered recommendations. Not derived from themes or findings." : "Themes rated Severe or Elevated. Recommendations only; approvals are recorded per finding in the Findings workflow."} meta={<SectionHead s={R} ws={ws} savedAt={savedAt} />} />
      </div>

      {R.mode === "manual" && (
        <Panel kicker="Recommended decisions" title="Manually Entered Recommendations" bodyClass="p-0">
          <div className="px-4 pt-3"><ManualNote s={R} /></div>
          {R.rows.length === 0 ? <EmptyState title="No decisions entered" body="The owner declared zero recommended decisions." /> : (
            <ul className="divide-y divide-border/50">
              {R.rows.map((r) => (
                <li key={r.id} className="px-4 py-3" data-testid={`decision-row-${r.id}`}>
                  <div className="text-[13px] font-medium">{r.label}</div>
                  {r.detail && <p className="mt-0.5 text-[12px] text-muted-foreground">{r.detail}</p>}
                  <div className="mt-1 flex flex-wrap gap-x-4 font-mono text-[10px] text-muted-foreground">
                    {r.owner && <span>Proposed function: <span className="text-foreground">{r.owner}</span></span>}
                    {r.reference && <span>Evidence: {r.reference}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {/* Risk themes */}
      {TH.mode === "manual" ? (
        <Panel kicker="Business risk themes" title="Where The Business Is Exposed" bodyClass="p-0">
          <div className="border-b border-border/40 px-4 py-2"><SectionHead s={TH} ws={ws} savedAt={savedAt} /></div>
          <div className="px-4 pt-3"><ManualNote s={TH} /></div>
          {TH.rows.length === 0 ? <EmptyState title="No themes entered" body="The owner declared no business risk themes." /> : (
            <ul>
              {TH.rows.map((r) => {
                const rt = (r.rating ?? "Low") as Rating;
                return (
                  <li key={r.id} className="border-b border-border/40 px-4 py-3 last:border-0" data-testid={`theme-manual-${r.id}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: RATING_COLOR[rt] }} aria-hidden />
                      <span className="font-display text-[14px] font-semibold">{r.label}</span>
                      <Tag tone={RATING_COLOR[rt]}>{rt}</Tag>
                      <Tag>Manual · not linked to findings</Tag>
                    </div>
                    {r.detail && <p className="mt-1 text-[12px] text-muted-foreground">{r.detail}</p>}
                    {r.reference && <div className="mt-1 font-mono text-[10px] text-muted-foreground">Evidence reference: {r.reference}</div>}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-border/50 px-4 py-2 text-[11px] text-muted-foreground">Computed theme drill-down remains available from the Executive level control above.</div>
        </Panel>
      ) : (
      <Panel kicker="Business risk themes" title="Where the business is exposed" bodyClass="p-0"
        action={<span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">Select a theme to drill down</span>}>
        <div className="border-b border-border/40 px-4 py-2"><SectionHead s={TH} ws={ws} savedAt={savedAt} /></div>
        {themes.length === 0 ? <EmptyState title="No open findings recorded" body="Absence of findings does not establish absence of risk. Confirm assessment coverage and reassess." /> : (
          <ul>
            {themes.map((t) => (
              <li key={t.id}>
                <DrillRow onClick={() => go({ level: "executive", theme: t.id })} label={`Open ${t.name} for executive detail`} testId={`theme-${t.id}`}>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: RATING_COLOR[t.rating] }} aria-hidden />
                        <span className="font-display text-[14px] font-semibold">{t.name}</span>
                        <Tag tone={RATING_COLOR[t.rating]}>{t.rating}</Tag>
                      </div>
                      <p className="mt-1 text-[12px] text-muted-foreground">{t.question}</p>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
                      <span><span className="text-foreground">{t.vulns.length}</span> findings</span>
                      <span><span className="text-foreground">{t.assets.length}</span> assets</span>
                      {t.kev > 0 && <span style={{ color: "hsl(42 92% 58%)" }}>{t.kev} KEV</span>}
                      <span>finding confidence {t.confidenceLabel.toLowerCase()}</span>
                    </div>
                  </div>
                </DrillRow>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      )}

      <PriorityAssets ws={ws} go={go} s={ins.priority} savedAt={savedAt} />
    </div>
  );
}

/* ---------------- Executive ---------------- */

function ExecutiveView({ theme: t, go, back }: { theme?: ThemeSummary; go: (v: View) => void; back: () => void }) {
  if (!t) return <Panel title="Theme no longer open" kicker="Executive"><EmptyState title="No open findings in this theme" body="Findings may have been closed since you opened this view."><button type="button" onClick={back} className="mt-3 rounded border border-primary/40 px-3 py-1.5 text-xs text-primary">Return to board</button></EmptyState></Panel>;
  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <section className="panel p-5 lg:col-span-7" aria-labelledby="exec-title">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Executive view · CEO, CFO, CISO</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 id="exec-title" className="font-display text-xl font-semibold">{t.name}</h2>
          <Tag tone={RATING_COLOR[t.rating]}>{t.rating}</Tag>
        </div>
        <dl className="mt-4 grid gap-4 text-[13px]">
          <div><dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Recommended decision</dt><dd className="mt-1 font-medium">{t.decision}</dd><dd className="mt-1 text-[11px] text-muted-foreground">Suggested accountable function: {t.owner} (recommendation, not an assigned owner).</dd></div>
          <div><dt className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Potential business consequence <Illustrative>Inferred scenario</Illustrative></dt><dd className="mt-1 leading-relaxed text-muted-foreground">{t.consequence}</dd></div>
          <div><dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Why we believe this</dt><dd className="mt-1 text-muted-foreground">{t.rationale} {t.kev > 0 ? `${t.kev} of ${t.vulns.length} are in CISA KEV.` : "None are in CISA KEV."} Highest CVSS {t.maxScore.toFixed(1)}.</dd></div>
          <div><dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</dt><dd className="mt-1 text-muted-foreground"><span className="text-foreground">{t.confidenceLabel}</span> · average detection confidence {pct(t.confidence)} across {t.vulns.length} finding{t.vulns.length === 1 ? "" : "s"}. Financial impact and likelihood are not assessed.</dd></div>
        </dl>
      </section>
      <Panel kicker="Manager view" title={`Affected assets (${t.assets.length})`} className="lg:col-span-5" bodyClass="p-0">
        {t.assets.length === 0 ? <EmptyState title="Assets not in inventory" body="Findings reference assets missing from the inventory." /> : (
          <ul>
            {t.assets.map((a) => {
              const vs = t.vulns.filter((v) => v.assetId === a.id);
              return (
                <li key={a.id}>
                  <DrillRow onClick={() => go({ level: "manager", theme: t.id, assetId: a.id })} label={`Open asset ${a.hostname}`} testId={`exec-asset-${a.id}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0"><div className="truncate text-[13px] font-medium">{a.hostname}</div><div className="font-mono text-[10px] text-muted-foreground">{a.zone} zone · {a.type} · {vs.length} in theme</div></div>
                      <div className="w-24 shrink-0"><RiskBar value={a.risk} /></div>
                    </div>
                  </DrillRow>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border/50 px-4 py-2 text-[11px] text-muted-foreground">
          {t.pending} of {t.vulns.length} findings await remediation review in <Link href="/vulnerabilities" className="text-primary hover:underline">Findings</Link>.
        </div>
      </Panel>
    </div>
  );
}

/* ---------------- Manager ---------------- */

function ManagerView({ ws, asset, themeId, go, back }: { ws: Workspace; asset?: Asset; themeId?: ThemeId; go: (v: View) => void; back: () => void }) {
  if (!asset) return <Panel title="Asset not found" kicker="Manager"><EmptyState title="This asset is no longer in inventory" body="It may have been removed by a newer scan."><button type="button" onClick={back} className="mt-3 rounded border border-primary/40 px-3 py-1.5 text-xs text-primary">Go back</button></EmptyState></Panel>;
  const all = ws.vulnerabilities.filter((v) => v.assetId === asset.id);
  const open = all.filter(isOpen).sort((a, b) => Number(b.kev) - Number(a.kev) || sevWeight(b.severity) - sevWeight(a.severity) || b.score - a.score);
  const closed = all.length - open.length;
  const rating = open.length ? rate(open) : "Low";
  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <section className="panel p-5 lg:col-span-5" aria-labelledby="mgr-title">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Manager view · architects, IT leads</div>
        <div className="mt-2 flex items-center gap-2"><Server className="h-4 w-4 text-muted-foreground" aria-hidden /><h2 id="mgr-title" className="font-display truncate text-xl font-semibold">{asset.hostname}</h2></div>
        <dl className="mt-4 grid grid-cols-2 gap-3 font-mono text-[11px]">
          {[["Address", asset.ip], ["Zone", asset.zone], ["Type", asset.type], ["OS", asset.os]].map(([k, v]) => (
            <div key={k}><dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt><dd className="mt-0.5 truncate text-foreground">{v}</dd></div>
          ))}
        </dl>
        <div className="mt-4"><div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Technical risk index</div><RiskBar value={asset.risk} /></div>
        <div className="mt-4 flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Assessed rating</span><Tag tone={RATING_COLOR[rating]}>{rating}</Tag></div>
        <div className="mt-4 rounded border border-primary/25 bg-primary/[0.05] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-primary/80">Recommended action</div><p className="mt-1 text-[13px]">{asset.recommendation}</p></div>
        <div className="mt-4"><div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Exposed services</div>
          {asset.ports.length === 0 ? <span className="text-xs text-muted-foreground">None observed</span> : (
            <div className="flex flex-wrap gap-1">{asset.ports.map((p) => <span key={p} className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px]">{p}/{service(p)[0]}</span>)}</div>
          )}
        </div>
      </section>
      <Panel kicker="Analyst view" title={`Open findings on this asset (${open.length})`} className="lg:col-span-7" bodyClass="p-0">
        {open.length === 0 ? <EmptyState title="No open findings" body={closed ? `${closed} finding(s) are closed.` : "No vulnerabilities recorded for this asset."} /> : (
          <ul>
            {open.map((v) => {
              const inTheme = themeId && themeOf(v) === themeId;
              return (
                <li key={v.id}>
                  <DrillRow onClick={() => go({ level: "analyst", theme: themeId, assetId: asset.id, vulnId: v.id })} label={`Open evidence for ${v.cve || v.title}`} testId={`mgr-vuln-${v.id}`}>
                    <div className="flex flex-wrap items-center gap-2"><SevBadge sev={v.severity} />{v.kev && <Tag tone="hsl(42 92% 58%)">KEV</Tag>}{inTheme && <Tag tone="hsl(186 70% 55%)">In selected theme</Tag>}<span className="ml-auto font-mono text-[10px] uppercase text-muted-foreground">{v.status}</span></div>
                    <div className="mt-1 text-[13px] font-medium">{v.title}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{v.cve || "no CVE"} · CVSS {v.score.toFixed(1)} · {v.technique} {tactic(v.technique)}</div>
                  </DrillRow>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ---------------- Analyst ---------------- */

function AnalystView({ vuln: v, asset, back }: { vuln?: Vulnerability; asset?: Asset; back: () => void }) {
  if (!v) return <Panel title="Finding not found" kicker="Analyst"><EmptyState title="This finding is no longer recorded" body="It may have been superseded by a newer scan."><button type="button" onClick={back} className="mt-3 rounded border border-primary/40 px-3 py-1.5 text-xs text-primary">Go back</button></EmptyState></Panel>;
  const fields: [string, ReactNode][] = [
    ["Finding ID", v.id], ["CVE", v.cve || "None assigned"], ["CVSS score", v.score.toFixed(1)], ["Severity", <SevBadge key="s" sev={v.severity} />],
    ["CISA KEV", v.kev ? "Listed: exploited in the wild" : "Not listed"], ["ATT&CK technique", `${v.technique} · ${tactic(v.technique)}`],
    ["Detection confidence", pct(v.confidence)], ["Review status", v.status], ["Asset", asset ? `${asset.hostname} (${asset.ip})` : v.assetId], ["Business theme", THEMES[themeOf(v)].name],
  ];
  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <section className="panel p-5 lg:col-span-7" aria-labelledby="ana-title">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">Analyst view · SOC, engineers</div>
        <h2 id="ana-title" className="font-display mt-2 text-xl font-semibold">{v.title}</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {fields.map(([k, val]) => (
            <div key={k} className="min-w-0"><dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt><dd className="mt-0.5 break-words font-mono text-[12px]">{val}</dd></div>
          ))}
        </dl>
      </section>
      <div className="grid gap-3 lg:col-span-5">
        <Panel kicker="Remediation" title="Technical recommendation"><p className="text-[13px] leading-relaxed">{v.recommendation}</p></Panel>
        <Panel kicker="Attack scenario" title={<span className="flex items-center gap-2">Inferred pathway <Illustrative>Scenario</Illustrative></span>}><p className="text-[12px] leading-relaxed text-muted-foreground">{scenario(v, asset)}</p></Panel>
        <Link href="/vulnerabilities" data-testid="link-finding-workflow" className="panel flex items-center justify-between gap-2 px-4 py-3 text-[13px] text-primary hover:bg-primary/[0.06]">
          <span className="flex items-center gap-2"><FileSearch className="h-4 w-4" /> Review and decide in Findings workflow</span><ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

/* ---------------- Priority ---------------- */

function PriorityAssets({ ws, go, s, savedAt }: { ws: Workspace; go: (v: View) => void; s: InsightSection; savedAt?: string }) {
  const top = [...ws.assets].sort((a, b) => b.risk - a.risk).slice(0, 10);
  const open = ws.vulnerabilities.filter(isOpen);
  const byId = new Map(ws.assets.map((a) => [a.id, a]));
  if (s.mode === "manual") {
    const rows = [...s.rows].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 10);
    return (
      <Panel kicker="Priority" title="Top Assets And Services (Manual Entry)" bodyClass="p-0">
        <div className="border-b border-border/40 px-4 py-2"><InsightProvenance section={s} ws={ws} savedAt={savedAt} /></div>
        <div className="px-4 pt-3"><ManualNote s={s} /></div>
        {rows.length === 0 ? <EmptyState title="No priorities entered" body="The owner declared no priority assets or services." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><tr className="border-b border-border/60">
                <th scope="col" className="px-4 py-2">#</th><th scope="col" className="px-2">Asset or service</th><th scope="col" className="px-2">Declared index</th><th scope="col" className="px-2 pr-4">Recommendation</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const linked = r.reference ? byId.get(r.reference.trim()) : undefined;
                  return (
                    <tr key={r.id} className="border-b border-border/40" data-testid={`priority-row-${r.id}`}>
                      <td className="px-4 py-2 font-mono text-muted-foreground">{String(i + 1).padStart(2, "0")}</td>
                      <td className="px-2">
                        {linked ? <button type="button" onClick={() => go({ level: "manager", assetId: linked.id })} className="text-left font-medium hover:text-primary hover:underline">{r.label}</button> : <span className="font-medium">{r.label}</span>}
                        <div className="font-mono text-[10px] text-muted-foreground">{linked ? `Linked to inventory ${linked.hostname}` : r.reference ? `Reference ${r.reference} (not in inventory)` : "No inventory link"}</div>
                      </td>
                      <td className="px-2" data-testid={`priority-value-${r.id}`}><RiskBar value={r.value ?? 0} /></td>
                      <td className="max-w-[380px] px-2 pr-4 text-muted-foreground">{r.detail || "No recommendation entered"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    );
  }
  return (
    <Panel kicker="Priority" title="Top 10 Assets By Technical Risk" bodyClass="p-0"
      action={<Link href="/vulnerabilities" className="flex items-center gap-1 font-mono text-[11px] text-primary" data-testid="link-all-findings">All findings <ArrowUpRight className="h-3 w-3" /></Link>}>
      <div className="border-b border-border/40 px-4 py-2"><InsightProvenance section={s} ws={ws} savedAt={savedAt} /></div>
      {top.length === 0 ? <EmptyState title="No assets inventoried" body="Launch a demo scan of 192.168.10.0/24 to discover hosts." /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <caption className="sr-only">Assets ranked by technical risk index. Select an asset to open its manager view.</caption>
            <thead className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"><tr className="border-b border-border/60">
              <th scope="col" className="px-4 py-2">#</th><th scope="col" className="px-2">Asset</th><th scope="col" className="px-2">Zone</th><th scope="col" className="px-2">Risk index</th><th scope="col" className="px-2">Worst open</th><th scope="col" className="px-2 pr-4">Recommendation</th>
            </tr></thead>
            <tbody>
              {top.map((a, i) => {
                const mine = open.filter((x) => x.assetId === a.id);
                const worst = [...mine].sort((p, q) => q.score - p.score)[0];
                return (
                  <tr key={a.id} className="cursor-pointer border-b border-border/40 hover:bg-primary/[0.05]" data-testid={`row-asset-${a.id}`} onClick={() => go({ level: "manager", assetId: a.id })}>
                    <td className="px-4 py-2 font-mono text-muted-foreground">{String(i + 1).padStart(2, "0")}</td>
                    <td className="px-2"><button type="button" onClick={(e) => { e.stopPropagation(); go({ level: "manager", assetId: a.id }); }} className="text-left font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60">{a.hostname}</button><div className="font-mono text-[10px] text-muted-foreground">{a.ip} · {a.type} · {mine.length} open</div></td>
                    <td className="px-2 text-muted-foreground">{a.zone}</td>
                    <td className="px-2"><RiskBar value={a.risk} /></td>
                    <td className="px-2">{worst ? <SevBadge sev={worst.severity} /> : <span className="text-muted-foreground">none</span>}</td>
                    <td className="max-w-[340px] px-2 pr-4 text-muted-foreground">{a.recommendation}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
