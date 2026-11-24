import { fmtTime } from "@/lib/sentinel";
import type { ExecutiveInsightsConfig, InsightRow, InsightSection, InsightSectionKey, Workspace } from "@workspace/api-client-react";
import { buildThemes, isOpen, ratingFromThemes } from "@/lib/risk-model";

export const SECTION_KEYS: InsightSectionKey[] = ["briefing", "technical", "financial", "direction", "decisions", "themes", "priority", "threatMap"];

export const BRIEFING_ROWS = [
  { id: "openFindings", label: "Open Findings" },
  { id: "knownExploited", label: "Known Exploited" },
  { id: "awaitingReview", label: "Awaiting Review" },
  { id: "scansCompleted", label: "Scans Completed" },
  { id: "totalScans", label: "Total Scans" },
] as const;

export type RowField = "label" | "value" | "secondaryValue" | "detail" | "reference" | "owner" | "observedAt" | "rating";
export interface RowCol { f: RowField; label: string; kind: "text" | "textarea" | "number" | "date" | "rating"; required?: boolean; placeholder?: string; wide?: boolean }

export interface SectionMeta {
  title: string;
  what: string;
  why: string;
  auto: { where: string; who: string; how: string };
  manualHow: string;
  rowNoun?: string;
  rowCols?: RowCol[];
  maxRows?: number;
}

const CLIENT = "Computed in the SPECTRE web client each time the workspace loads. No named individual authored it.";

export const META: Record<InsightSectionKey, SectionMeta> = {
  briefing: {
    title: "Business Risk Briefing",
    what: "Headline statement of overall cyber exposure priority with five supporting counts.",
    why: "Gives the board a single reading of whether matters need executive attention.",
    auto: {
      where: "Workspace vulnerabilities, scans and assets records.",
      who: CLIENT,
      how: "Open findings = findings whose status is not resolved, fixed, closed, remediated or verified (approved and rejected are review decisions, not fixes, so they stay open). Known exploited = open findings flagged CISA KEV. Awaiting review = open findings with status pending. Scans completed = scans with status completed, over all scans. Headline rating = worst theme rating from the Business Risk Themes heuristic.",
    },
    manualHow: "Counts and headline are declared by the named owner. They replace the automated counts entirely; nothing is recomputed from findings.",
  },
  technical: {
    title: "Technical Exposure Index",
    what: "A 0 to 100 technical severity index for the workspace.",
    why: "Signals relative technical exposure. It is not a probability of loss or of an incident.",
    auto: {
      where: "The stored workspace.riskScore field.",
      who: "Seeded demonstration value stored by the assessment API. No transparent calibrated scoring engine produces it.",
      how: "Displayed as stored. No formula is applied in the client; the value is a demo seed, not a measurement.",
    },
    manualHow: "Value declared by the named owner. It is an asserted index, not a measurement taken by SPECTRE.",
  },
  financial: {
    title: "Financial Exposure",
    what: "A low to high range estimate of potential financial loss.",
    why: "Translates technical exposure into a business figure for budgeting conversations.",
    auto: {
      where: "No inputs. Asset business value, revenue dependency and recovery cost are not captured.",
      who: "Nobody. SPECTRE does not estimate financial exposure automatically.",
      how: "Shown as Not Assessed. No figure is fabricated.",
    },
    manualHow: "Lower and upper bounds in a declared currency. A range estimate of potential loss, not a probability and not an expected value.",
  },
  direction: {
    title: "Direction Of Travel",
    what: "Whether the exposure index is improving, stable or deteriorating between two comparable periods.",
    why: "Shows whether security investment is changing the position.",
    auto: {
      where: "No historical snapshots are stored.",
      who: "Nobody. No history is recorded.",
      how: "Shown as Baseline Only. No trend is inferred.",
    },
    manualHow: "Delta = current index minus previous index. Negative is Improving, positive is Deteriorating, zero is Stable (higher index means more exposure). Use the narrative and source to state the comparison periods.",
  },
  decisions: {
    title: "Recommended Decisions",
    what: "Matters recommended for executive decision.",
    why: "Turns findings into actions that need an accountable function.",
    auto: {
      where: "Business Risk Themes computed from open findings.",
      who: CLIENT + " Suggested owners come from fixed theme definitions, not assignments.",
      how: "Count of themes rated Severe or Elevated. Each carries its predefined decision text. Approvals are recorded per finding in the Findings workflow.",
    },
    manualHow: "Each row is a declared recommendation. Count = number of rows (zero allowed). Not derived from themes or findings.",
    rowNoun: "Decision",
    rowCols: [
      { f: "label", label: "Recommendation", kind: "text", required: true, wide: true },
      { f: "detail", label: "Rationale", kind: "textarea", wide: true },
      { f: "owner", label: "Proposed Function", kind: "text" },
      { f: "reference", label: "Evidence Reference", kind: "text" },
    ],
  },
  themes: {
    title: "Business Risk Themes",
    what: "Groups of exposure described as business consequences.",
    why: "Lets non-technical leaders see where the business is exposed.",
    auto: {
      where: "Open findings and their MITRE ATT&CK technique IDs, plus the asset inventory.",
      who: CLIENT,
      how: "Heuristic in risk-model.ts. Theme = tactic of the technique (T1078 is identity; Initial Access intrusion; Credential Access identity; Lateral Movement spread; Impact disruption; Execution, Privilege Escalation, Persistence, Defense Evasion control; anything else recon). Rating: Severe if KEV with a high or critical finding, or two or more criticals; Elevated if any critical, high or KEV; Guarded if any medium; else Low. Rank = 100 x KEV + 20 x critical + 6 x high + highest CVSS. Confidence = mean detection confidence; High if at least 0.8 with two or more findings, Moderate if at least 0.6, else Low.",
    },
    manualHow: "Each row is a declared theme with a rating and business consequence. Manual themes are not linked to findings or assets and cannot be drilled into.",
    rowNoun: "Theme",
    rowCols: [
      { f: "label", label: "Theme", kind: "text", required: true },
      { f: "rating", label: "Rating", kind: "rating", required: true },
      { f: "detail", label: "Business Consequence", kind: "textarea", wide: true },
      { f: "reference", label: "Evidence Reference", kind: "text", wide: true },
    ],
  },
  priority: {
    title: "Priority",
    what: "Top 10 assets or services ranked by technical index.",
    why: "Tells managers where to act first.",
    auto: {
      where: "Asset inventory and open findings.",
      who: "Asset risk is a stored demonstration value from the assessment API.",
      how: "Assets sorted by stored asset.risk descending, top 10. Worst open = highest CVSS open finding per asset; its severity is shown.",
    },
    manualHow: "Rows sorted by declared index descending, top 10. If the reference matches an inventory asset ID the row links to that asset; otherwise the manual detail is shown.",
    rowNoun: "Asset Or Service",
    maxRows: 10,
    rowCols: [
      { f: "label", label: "Asset Or Service", kind: "text", required: true },
      { f: "value", label: "Technical Index", kind: "number", required: true },
      { f: "detail", label: "Recommendation", kind: "textarea", wide: true },
      { f: "reference", label: "Inventory Asset ID", kind: "text" },
    ],
  },
  threatMap: {
    title: "External Threat Map",
    what: "Global threat activity context from outside the organisation.",
    why: "Situational awareness only.",
    auto: {
      where: "Third-party global threat map provider, loaded at view time.",
      who: "The external provider.",
      how: "Embedded as provided. Never used in any score or rating.",
    },
    manualHow: "Text observations only. No embeds, scripts or links are rendered. Never used in any score or rating.",
    rowNoun: "Observation",
    rowCols: [
      { f: "label", label: "Observation", kind: "text", required: true, wide: true },
      { f: "detail", label: "Detail", kind: "textarea", wide: true },
      { f: "reference", label: "Reference", kind: "text", wide: true },
    ],
  },
};

export function blankSection(key: InsightSectionKey): InsightSection {
  return { key, mode: "automated", rows: key === "briefing" ? BRIEFING_ROWS.map((r) => ({ id: r.id, label: r.label, value: 0 })) : [] };
}

export function normalizeConfig(c?: ExecutiveInsightsConfig | null): ExecutiveInsightsConfig {
  return {
    revision: c?.revision ?? 0,
    updatedAt: c?.updatedAt,
    sections: SECTION_KEYS.map((k) => {
      const s = c?.sections?.find((x) => x.key === k);
      if (!s) return blankSection(k);
      if (k === "briefing") {
        return { ...s, rows: BRIEFING_ROWS.map((r) => s.rows.find((x) => x.id === r.id) ?? { id: r.id, label: r.label, value: 0 }) };
      }
      return { ...s, rows: s.rows ?? [] };
    }),
  };
}

export const sectionMap = (c: ExecutiveInsightsConfig) => Object.fromEntries(c.sections.map((s) => [s.key, s])) as Record<InsightSectionKey, InsightSection>;
export const rowVal = (s: InsightSection, id: string) => s.rows.find((r) => r.id === id)?.value ?? 0;
export const newRowId = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export const validDate = (s?: string) => !!s && s.trim() !== "" && !isNaN(Date.parse(s));
const isInt = (n?: number) => n !== undefined && Number.isInteger(n) && n >= 0 && n <= 1_000_000;

export function directionOf(cur: number, prev: number) {
  const delta = Math.round((cur - prev) * 100) / 100;
  return { delta, label: delta < 0 ? "Improving" : delta > 0 ? "Deteriorating" : "Stable" } as const;
}

export function fmtMoney(n: number, unit: string) {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: unit, maximumFractionDigits: 0 }).format(n); }
  catch { return `${unit} ${n.toLocaleString("en-US")}`; }
}
export const fmtDate = (s?: string) => (s ? fmtTime(s) : "Not recorded");

/** Errors keyed by field ("source", "value", "row.<id>.<field>", "rows"). Only manual sections are validated. */
export function validateSection(s: InsightSection): Record<string, string> {
  const e: Record<string, string> = {};
  if (s.mode !== "manual") return e;
  if (!s.source?.trim()) e.source = "Source is required.";
  if (!s.owner?.trim()) e.owner = "Owner is required.";
  if (!validDate(s.asOf)) e.asOf = "A valid date is required.";
  if (!s.reason?.trim()) e.reason = "Reason for manual entry is required.";
  const idx = (n?: number) => n !== undefined && n >= 0 && n <= 100;
  const meta = META[s.key];
  if (meta.rowCols) {
    for (const r of s.rows) {
      for (const c of meta.rowCols) {
        if (c.required && c.kind !== "number" && !String(r[c.f] ?? "").trim()) e[`row.${r.id}.${c.f}`] = "Required.";
      }
      if (r.observedAt && !validDate(r.observedAt)) e[`row.${r.id}.observedAt`] = "Invalid date.";
    }
    if (meta.maxRows && s.rows.length > meta.maxRows) e.rows = `At most ${meta.maxRows} rows.`;
  }
  switch (s.key) {
    case "briefing": {
      for (const r of BRIEFING_ROWS) { const v = s.rows.find((x) => x.id === r.id)?.value; if (!isInt(v) || v! > 1e6) e[`row.${r.id}.value`] = "Whole number 0 to 1,000,000."; }
      const o = rowVal(s, "openFindings");
      if (rowVal(s, "knownExploited") > o) e["row.knownExploited.value"] = "Cannot exceed open findings.";
      if (rowVal(s, "awaitingReview") > o) e["row.awaitingReview.value"] = "Cannot exceed open findings.";
      if (rowVal(s, "scansCompleted") > rowVal(s, "totalScans")) e["row.scansCompleted.value"] = "Cannot exceed total scans.";
      break;
    }
    case "technical": if (!idx(s.value)) e.value = "Index 0 to 100 required."; break;
    case "financial":
      if (s.value === undefined || !Number.isFinite(s.value) || s.value < 0 || s.value > 1e12) e.value = "Lower bound required, from 0 to 1 trillion.";
      if (s.secondaryValue === undefined || !Number.isFinite(s.secondaryValue) || s.secondaryValue > 1e12 || (s.value !== undefined && s.secondaryValue < s.value)) e.secondaryValue = "Upper bound required, at least the lower bound, up to 1 trillion.";
      if (!/^[A-Z]{3}$/.test(s.unit ?? "")) e.unit = "Three-letter currency code, for example PHP.";
      break;
    case "direction":
      if (!idx(s.value)) e.value = "Current index 0 to 100 required.";
      if (!idx(s.secondaryValue)) e.secondaryValue = "Previous index 0 to 100 required.";
      break;
    case "priority":
      for (const r of s.rows) if (!idx(r.value)) e[`row.${r.id}.value`] = "Index 0 to 100 required.";
      break;
  }
  return e;
}

/** Actual "when" for automated sections, derived from real record timestamps. */
export function autoWhen(key: InsightSectionKey, ws: Workspace): string {
  const latestScan = [...ws.scans].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const scanNote = latestScan ? `latest scan created ${fmtTime(latestScan.createdAt)}` : "no scans recorded";
  switch (key) {
    case "technical": return "Stored value with no recorded timestamp. Read on each workspace load.";
    case "financial": case "direction": return "Not applicable. Nothing is computed.";
    case "threatMap": return "Requested when viewed. The provider controls update timing; SPECTRE does not verify feed freshness.";
    default: return `Recomputed on every workspace load (refreshes every 3 to 15 seconds); ${scanNote}.`;
  }
}

/** Raw automated values computed from the original workspace, never from manual entries. */
export function autoPreview(key: InsightSectionKey, ws: Workspace): [string, string][] {
  const open = ws.vulnerabilities.filter(isOpen);
  const themes = buildThemes(ws);
  switch (key) {
    case "briefing": return [
      ["Headline Rating", open.length ? ratingFromThemes(themes) : "No open findings"],
      ["Open Findings", String(open.length)], ["Known Exploited", String(open.filter((v) => v.kev).length)],
      ["Awaiting Review", String(open.filter((v) => v.status === "pending").length)],
      ["Scans Completed", `${ws.scans.filter((s) => s.status === "completed").length} / ${ws.scans.length}`],
    ];
    case "technical": return [["Stored Risk Score", `${ws.riskScore} / 100`]];
    case "financial": return [["Displayed", "Not Assessed"]];
    case "direction": return [["Displayed", "Baseline Only"]];
    case "decisions": return [["Recommended Decisions", String(themes.filter((t) => t.rating === "Severe" || t.rating === "Elevated").length)], ...themes.filter((t) => t.rating === "Severe" || t.rating === "Elevated").map((t) => [t.name, t.decision] as [string, string])];
    case "themes": return themes.length ? themes.map((t) => [t.name, `${t.rating} · ${t.vulns.length} findings · ${t.assets.length} assets`]) : [["Themes", "None (no open findings)"]];
    case "priority": return [...ws.assets].sort((a, b) => b.risk - a.risk).slice(0, 5).map((a) => [a.hostname, `risk ${a.risk}`]);
    case "threatMap": return [["Displayed", "Official external threat map"]];
  }
}

export type { InsightRow };
