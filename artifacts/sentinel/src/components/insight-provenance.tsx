import type { InsightSection, Workspace } from "@workspace/api-client-react";
import { Cpu, PenLine } from "lucide-react";
import { META, autoWhen, fmtDate } from "@/lib/insights";

export function ModeBadge({ section }: { section: InsightSection }) {
  const manual = section.mode === "manual";
  return (
    <span data-testid={`insight-mode-${section.key}`} data-mode={section.mode}
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${manual ? "border-accent/40 bg-accent/10 text-accent" : "border-primary/30 bg-primary/[0.06] text-primary/90"}`}>
      {manual ? <PenLine className="h-2.5 w-2.5" /> : <Cpu className="h-2.5 w-2.5" />}
      {manual ? "Manual Entry" : "Automated Computation"}
    </span>
  );
}

/** Collapsible What / Where / When / Who / Why / How explainer. */
export function InsightProvenance({ section, ws, savedAt, className }: { section: InsightSection; ws: Workspace; savedAt?: string; className?: string }) {
  const m = META[section.key];
  const manual = section.mode === "manual";
  const rows: [string, string][] = manual
    ? [
        ["What", m.what],
        ["Where", section.source || "Not declared"],
        ["When", `As of ${fmtDate(section.asOf)} · saved ${fmtDate(savedAt)}`],
        ["Who", `${section.owner || "Not declared"} (declared, not authenticated)`],
        ["Why", section.reason || m.why],
        ["How", m.manualHow],
        ...(section.headline ? [["Statement", section.headline] as [string, string]] : []),
        ...(section.narrative ? [["Context", section.narrative] as [string, string]] : []),
      ]
    : [
        ["What", m.what], ["Where", m.auto.where], ["When", autoWhen(section.key, ws)],
        ["Who", m.auto.who], ["Why", m.why], ["How", m.auto.how],
      ];
  return (
    <details className={`group text-[11px] ${className ?? ""}`} data-testid={`provenance-${section.key}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground hover:text-primary [&::-webkit-details-marker]:hidden">
        <ModeBadge section={section} />
        <span className="font-mono text-[10px] underline decoration-dotted underline-offset-2">Sources And Method</span>
        {manual && <span className="hidden font-mono text-[10px] sm:inline">· {section.owner} · {fmtDate(section.asOf)}</span>}
      </summary>
      <dl className="mt-2 grid gap-1.5 rounded border border-border/60 bg-background/40 p-3">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[52px_1fr] gap-2">
            <dt className="font-mono text-[10px] uppercase tracking-wider text-primary/70">{k}</dt>
            <dd className="leading-relaxed text-muted-foreground">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
