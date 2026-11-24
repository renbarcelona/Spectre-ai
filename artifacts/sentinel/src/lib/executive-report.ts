import type { Workspace } from "@workspace/api-client-react";
import { buildThemes, isOpen, ratingFromThemes } from "./risk-model";
import { EXECUTIVE_THEME } from "./report-theme";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (value: unknown, limit = 150) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return escape(text.length > limit ? text.slice(0, limit - 1) + "…" : text);
};

/** A bounded, two-sheet board brief. No invented monetary losses or probabilities. */
export function buildExecutiveReport(ws: Workspace, generated = new Date()): string {
  const open = ws.vulnerabilities.filter(isOpen);
  const themes = buildThemes(ws);
  const top = themes.slice(0, 3);
  const assets = new Set(open.map(v => v.assetId));
  const severity = (s: string) => open.filter(v => v.severity.toLowerCase() === s).length;
  const rating = open.length ? ratingFromThemes(themes) : "Not Established";
  const financial = ws.executiveInsights?.sections.find(s => s.key === "financial");
  const declared = financial?.mode === "manual" && Number.isFinite(financial.value) && Number.isFinite(financial.secondaryValue)
    && financial.value! >= 0 && financial.secondaryValue! >= financial.value! && /^[A-Z]{3}$/.test(financial.unit ?? "");
  const financialText = declared
    ? `Management-declared scenario range: <b>${escape(financial.unit)} ${financial.value!.toLocaleString("en-US")}–${financial.secondaryValue!.toLocaleString("en-US")}</b>. Not a calibrated loss forecast or expected annual loss.`
    : "<b>Financial Exposure: Not Quantified.</b> Revenue dependencies, downtime assumptions, recovery costs and incident probabilities have not been validated.";
  const metrics = [["Open Findings", open.length], ["Critical / High", `${severity("critical")} / ${severity("high")}`],
    ["Known-Exploited Flags", open.filter(v => v.kev).length], ["Affected Asset IDs", assets.size]];
  const footer = (page: number) => `<footer><span>SPECTRE AI · Board And C-Suite · Confidential</span><span>${page} / 2</span></footer>`;
  const threats = top.map(t => `<tr><td><b>${escape(t.name)}</b><br>${escape(t.rating)} priority<br>${t.vulns.length} open findings · ${t.assets.length} inventoried assets<br>${t.kev} KEV flags</td><td>${short(t.consequence, 245)}</td><td>${short(t.assets.map(a => a.hostname).join(", ") || "Inventory linkage requires review", 90)}<br><span class="muted">Trace: ${short(t.vulns.slice(0, 2).map(v => v.cve || v.id).join(", "), 100)}</span></td></tr>`).join("");
  const decisions = top.map((t, i) => `<tr><td>${i + 1}</td><td><b>${short(t.decision, 180)}</b><br><span class="muted">Proposed owner: ${short(t.owner, 70)}. Confirm accountable executive and funding.</span></td><td>${i === 0 ? "Within 7 Days" : "Within 30 Days"}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SPECTRE AI — Two-Page Executive Summary</title><style>
@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#e9edf2;color:#172737;font:10pt/1.35 Arial,sans-serif;overflow-wrap:anywhere}
.sheet{width:210mm;height:297mm;padding:14mm 15mm 17mm;margin:8mm auto;background:#fff;position:relative;break-after:page;page-break-after:always}
.sheet:last-child{break-after:auto;page-break-after:auto}h1{font-size:23pt;line-height:1.12;margin:7mm 0 3mm}h2{font-size:12pt;color:#145b65;margin:5mm 0 2mm;border-bottom:1px solid #d4dce2;padding-bottom:2mm}
p{margin:2mm 0 3mm}.eyebrow{font-size:9pt;letter-spacing:.7pt;color:#145b65;font-weight:bold}.meta,.muted{color:#526273;font-size:8.5pt}
.notice{background:#fff4d8;border-left:3px solid #b1852c;padding:2.5mm;font-size:8.5pt}.callout{background:#edf4f6;padding:3mm;border-left:3px solid #145b65}
.metrics{width:100%;margin:4mm 0;border:0}.metrics td{width:25%;background:#eef3f7;padding:3mm;border:2px solid white}.metrics strong{display:block;font-size:19pt}.metrics span{font-size:8pt}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9pt}th{background:#142c42;color:white;text-align:left;font-size:8.5pt}td,th{padding:2mm;vertical-align:top;border-bottom:1px solid #dce3e8;overflow-wrap:anywhere}
tr{break-inside:avoid}ul{padding-left:5mm;margin:2mm 0}li{margin-bottom:2mm}footer{position:absolute;bottom:8mm;left:15mm;right:15mm;display:flex;justify-content:space-between;border-top:1px solid #d4dce2;padding-top:2mm;font-size:8pt;color:#526273}
@media print{body{background:white}.sheet{margin:0;box-shadow:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
${EXECUTIVE_THEME}
</style></head><body>
<section class="sheet" aria-label="Page 1: Exposure And Threats">
<div class="eyebrow">Executive Summary · Exposure And Threats</div>
<h1>Cyber Risk: What Leadership Needs To Know</h1>
<p class="meta">${short(ws.settings.organization, 85)} · Scope: ${short(ws.settings.allowedSubnet, 70)}<br>Prepared ${escape(generated.toISOString().slice(0, 10))} · Reporting mode: ${short(ws.mode, 30)}</p>
<p class="notice"><b>Demonstration Evidence.</b> This report summarizes synthetic workspace records, not live embedded scans. Threats and impacts are potential scenarios—not confirmed incidents or audited conclusions.</p>
<h2>Board Assessment</h2>
<p class="callout"><b>${escape(rating)} technical exposure priority.</b> ${open.length ? "Validate and address the highest-risk weaknesses that could enable unauthorized access, service disruption or data misuse. Confirm business dependencies before translating technical severity into financial risk." : "No open findings are recorded. This does not establish that the business is secure; verify assessment coverage and current evidence before accepting residual risk."}</p>
<table class="metrics"><tr>${metrics.map(([label, value]) => `<td><strong>${escape(value)}</strong><span>${escape(label)}</span></td>`).join("")}</tr></table>
<p class="meta">${ws.assets.length} inventoried assets · ${ws.scans.filter(s => s.status === "completed").length}/${ws.scans.length} scans completed · ${open.filter(v => v.status === "pending").length} open findings awaiting review. KEV flags reflect stored records, not a fresh intelligence lookup.</p>
<h2>Priority Exposures And Corresponding Threats</h2>
<table><thead><tr><th style="width:27%">Exposure</th><th style="width:47%">Potential Threat And Business Consequence</th><th style="width:26%">Supporting References</th></tr></thead><tbody>${threats || '<tr><td colspan="3">No open exposure themes are recorded. Commission an authorized assessment before drawing risk conclusions.</td></tr>'}</tbody></table>
<h2>What The Evidence Does Not Establish</h2>
<p>No confirmed breach, incident probability, revenue loss, recovery duration or regulatory violation is established by these records. The threat pathways above are inferred scenarios; they are not proof that an attacker completed them.</p>
<p class="meta">Method: open findings exclude closed states. Themes are grouped using ATT&amp;CK technique mappings and ranked using stored severity, KEV flags and CVSS. The highest theme rating sets the displayed priority; it is not a loss probability. Showing ${top.length} of ${themes.length} themes; text and references are abbreviated to keep this brief to two pages. Consult the Technical Report for complete records.</p>
${footer(1)}</section>
<section class="sheet" aria-label="Page 2: Impacts And Decisions">
<div class="eyebrow">Executive Summary · Business Impacts And Decisions</div>
<h1>Business Consequences And Required Action</h1>
<h2>Potential Impact If An Exposure Is Exploited</h2>
<table><thead><tr><th style="width:20%">Dimension</th><th style="width:47%">Potential Consequence</th><th style="width:33%">Validation Required</th></tr></thead><tbody>
<tr><td><b>Financial</b></td><td>Lost contribution during downtime, incident response, restoration, legal support and potential contractual claims.</td><td>CFO: margin per hour, outage duration, recovery estimates and contractual exposure.</td></tr>
<tr><td><b>Reputational</b></td><td>Reduced customer confidence, negative publicity and increased scrutiny following a material incident.</td><td>CEO / Communications: affected stakeholders, notification plan and customer dependency.</td></tr>
<tr><td><b>Legal</b></td><td>Possible privacy, contractual or regulatory obligations if protected data or services are affected.</td><td>Legal / DPO: jurisdiction, affected data and notification thresholds; RA 10173 where applicable. No violation is established.</td></tr>
<tr><td><b>Operational</b></td><td>Interrupted services, degraded productivity, manual workarounds or loss of data integrity.</td><td>COO / CIO: critical processes, dependencies, recovery objectives and tested restores.</td></tr>
<tr><td><b>Business</b></td><td>Delayed delivery, customer churn, disrupted partnerships and diversion of strategic investment.</td><td>Business owners: revenue concentration, service commitments and alternate delivery capacity.</td></tr>
</tbody></table>
<h2>Financial Exposure And Direction Of Travel</h2>
<p>${financialText}</p>
${declared ? `<p class="meta">Declared by ${short(financial.owner, 65)} · As of ${short(financial.asOf, 35)} · Source: ${short(financial.source, 140)}. Dashboard financial override only; other metrics use underlying workspace records.</p>` : '<p class="meta">CFO estimation approach: lost contribution per hour × scenario outage hours + response/restoration costs + validated additional liabilities, avoiding double counting. This is a scenario costing method, not an automatically calculated loss estimate.</p>'}
<p class="meta"><b>Trend: Not Established.</b> This report contains one snapshot, not a comparable historical series. Do not infer improvement from a lower finding count without consistent scope and validation.</p>
<h2>Decisions Requested From Leadership</h2>
<table><thead><tr><th style="width:6%">#</th><th style="width:71%">Decision And Proposed Accountability</th><th style="width:23%">Review Target</th></tr></thead><tbody>${decisions || '<tr><td>1</td><td>Authorize a current assessment and business-impact review. Proposed owner: CISO with business owners.</td><td>Within 30 Days</td></tr>'}</tbody></table>
<p class="meta"><b>Closure Evidence:</b> accountable owner and due date, approved change or compensating control, authorized retest, and documented residual-risk acceptance. Review overdue actions and recovery-test results at the next risk committee. Review targets are suggestions, not SLAs. Recommendations are not approvals; no remediation is applied automatically.</p>
${footer(2)}</section></body></html>`;
}
