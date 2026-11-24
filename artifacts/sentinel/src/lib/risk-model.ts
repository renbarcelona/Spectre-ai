import type { Asset, Vulnerability, Workspace } from "@workspace/api-client-react";
import { tactic } from "@/lib/sentinel";

/** Statuses that mean a finding is no longer open exposure. Current API uses pending/approved/rejected; none of these mean "fixed". */
const CLOSED = new Set(["resolved", "fixed", "closed", "remediated", "verified"]);
export const isOpen = (v: Vulnerability) => !CLOSED.has(v.status.toLowerCase());

const SEV_W: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
export const sevWeight = (s: string) => SEV_W[s.toLowerCase()] ?? 0;

export type ThemeId = "intrusion" | "identity" | "spread" | "control" | "disruption" | "recon";

export interface ThemeDef {
  id: ThemeId;
  name: string;
  question: string;
  consequence: string;
  rationale: string;
  decision: string;
  owner: string;
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  intrusion: {
    id: "intrusion", name: "External intrusion pathway",
    question: "Can an outsider get in through what we expose?",
    consequence: "Potential scenario: unauthorised entry to systems that support customer-facing or core operations, which may trigger incident response costs and, if personal data is reached, Data Privacy Act (RA 10173) breach-notification duties.",
    rationale: "Findings map to MITRE ATT&CK Initial Access techniques on discovered hosts.",
    decision: "Prioritise remediation or compensating controls on exposed services before lower-severity hygiene work.",
    owner: "CISO with infrastructure leads",
  },
  identity: {
    id: "identity", name: "Credential and identity compromise",
    question: "Could stolen or guessed credentials hand over access?",
    consequence: "Potential scenario: an attacker operating as a legitimate user, making misuse harder to detect and widening access to sensitive records.",
    rationale: "Findings map to Credential Access or Valid Accounts techniques.",
    decision: "Endorse a credential hardening push (MFA coverage, protocol hardening) scoped to the affected systems.",
    owner: "CISO with identity team",
  },
  spread: {
    id: "spread", name: "Internal spread between zones",
    question: "If one system falls, how far can it travel?",
    consequence: "Potential scenario: a single compromise moving laterally across zones, turning a contained incident into a business-wide one.",
    rationale: "Findings map to Lateral Movement techniques (remote services, exploitation of remote services).",
    decision: "Request an architecture review of zone segmentation for the affected hosts.",
    owner: "Security architecture",
  },
  control: {
    id: "control", name: "Attacker control of systems",
    question: "Could an attacker run code or gain admin rights?",
    consequence: "Potential scenario: privileged control enabling data tampering, persistence, or staging for further attacks.",
    rationale: "Findings map to Execution, Privilege Escalation, Persistence or Defense Evasion techniques.",
    decision: "Direct patching of privilege and execution weaknesses into the next change window, with SOC monitoring until closed.",
    owner: "IT operations with SOC",
  },
  disruption: {
    id: "disruption", name: "Operational disruption",
    question: "Could this stop us from operating?",
    consequence: "Potential scenario: encryption or destruction of systems (ransomware-style impact) causing service downtime. Duration and cost are not assessed.",
    rationale: "Findings map to Impact-tactic techniques.",
    decision: "Confirm recovery readiness (tested backups, restore time) for affected systems.",
    owner: "CIO / business continuity",
  },
  recon: {
    id: "recon", name: "Reconnaissance exposure",
    question: "How much can an attacker learn about us?",
    consequence: "Potential scenario: information disclosure that shortens attacker planning. Low direct business impact on its own.",
    rationale: "Findings map to Discovery or unclassified techniques.",
    decision: "Track through normal hygiene; no board action required.",
    owner: "Security operations",
  },
};

export function themeOf(v: Vulnerability): ThemeId {
  if (v.technique.split(".")[0] === "T1078") return "identity";
  const t = tactic(v.technique);
  if (t === "Initial Access") return "intrusion";
  if (t === "Credential Access") return "identity";
  if (t === "Lateral Movement") return "spread";
  if (t === "Impact") return "disruption";
  if (["Privilege Escalation", "Execution", "Persistence", "Defense Evasion"].includes(t)) return "control";
  return "recon";
}

export type Rating = "Severe" | "Elevated" | "Guarded" | "Low";
export const RATING_COLOR: Record<Rating, string> = {
  Severe: "hsl(354 78% 60%)", Elevated: "hsl(22 90% 60%)", Guarded: "hsl(42 92% 58%)", Low: "hsl(186 70% 55%)",
};

export interface ThemeSummary extends ThemeDef {
  vulns: Vulnerability[];
  assets: Asset[];
  critical: number;
  high: number;
  kev: number;
  pending: number;
  maxScore: number;
  confidence: number;
  confidenceLabel: "High" | "Moderate" | "Low";
  rating: Rating;
  rank: number;
}

export function rate(vs: Vulnerability[]): Rating {
  const kev = vs.some((v) => v.kev);
  const crit = vs.some((v) => v.severity.toLowerCase() === "critical");
  const high = vs.some((v) => v.severity.toLowerCase() === "high");
  if ((kev && (crit || high)) || vs.filter((v) => v.severity.toLowerCase() === "critical").length >= 2) return "Severe";
  if (crit || kev || high) return "Elevated";
  if (vs.some((v) => v.severity.toLowerCase() === "medium")) return "Guarded";
  return "Low";
}

const normConf = (c: number) => (c > 1 ? c / 100 : c);

export function buildThemes(ws: Workspace): ThemeSummary[] {
  const open = ws.vulnerabilities.filter(isOpen);
  const byId = new Map(ws.assets.map((a) => [a.id, a]));
  const groups = new Map<ThemeId, Vulnerability[]>();
  for (const v of open) {
    const t = themeOf(v);
    groups.set(t, [...(groups.get(t) ?? []), v]);
  }
  const out: ThemeSummary[] = [];
  for (const [id, vs] of groups) {
    const sorted = [...vs].sort((a, b) => Number(b.kev) - Number(a.kev) || b.score - a.score);
    const assetIds = [...new Set(sorted.map((v) => v.assetId))];
    const assets = assetIds.map((i) => byId.get(i)).filter((a): a is Asset => !!a).sort((a, b) => b.risk - a.risk);
    const confidence = vs.reduce((s, v) => s + normConf(v.confidence), 0) / vs.length;
    const sev = (s: string) => vs.filter((v) => v.severity.toLowerCase() === s).length;
    const kev = vs.filter((v) => v.kev).length;
    const maxScore = Math.max(...vs.map((v) => v.score));
    const confidenceLabel = confidence >= 0.8 && vs.length >= 2 ? "High" : confidence >= 0.6 ? "Moderate" : "Low";
    out.push({
      ...THEMES[id], vulns: sorted, assets, critical: sev("critical"), high: sev("high"), kev,
      pending: vs.filter((v) => v.status === "pending").length, maxScore, confidence, confidenceLabel,
      rating: rate(vs), rank: kev * 100 + sev("critical") * 20 + sev("high") * 6 + maxScore,
    });
  }
  return out.sort((a, b) => b.rank - a.rank);
}

export function ratingFromThemes(t: ThemeSummary[]): Rating {
  const order: Rating[] = ["Severe", "Elevated", "Guarded", "Low"];
  return t.length ? order.find((r) => t.some((x) => x.rating === r)) ?? "Low" : "Low";
}

export const pct = (n: number) => `${Math.round(normConf(n) * 100)}%`;
