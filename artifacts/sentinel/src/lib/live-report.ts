import type { LiveJob, PublicTarget } from "@workspace/api-client-react";
import { consolidatedGuidance, serviceGuidance } from "./embedded-guidance";
import { jobPairs, protoOf } from "./live-exposure";
import { DOCUMENT_THEME, EXECUTIVE_THEME } from "./report-theme";

const esc = (value: unknown) => String(value ?? "Not Recorded").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (value: string, max = 160) => esc(value.length > max ? value.slice(0, max - 1) + "…" : value);
const table = (headers: string[], rows: string[][]) => `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">No Observations Recorded</td></tr>`}</tbody></table>`;
export const isReportableLiveJob = (job: LiveJob) => job.engine === "embedded" && job.status === "completed";

/** Render actual saved observations, without converting ports into invented vulnerabilities. */
export function buildLiveReport(job: LiveJob, kind: "executive" | "technical", target?: PublicTarget, organization = "SPECTRE AI"): string {
  if (!isReportableLiveJob(job)) throw new Error("Select a completed Intelligent VAPT scan.");
  const services = job.services;
  const open = services.filter(s => s.state === "open");
  const closed = services.filter(s => s.state === "closed");
  const uncertain = services.filter(s => !["open", "closed"].includes(s.state));
  const expected = jobPairs(job);
  const observed = new Set(services.map(s => `${protoOf(s)}:${s.port}`));
  const missing = expected.filter(p => !observed.has(`${p.protocol}:${p.port}`));
  const guidance = consolidatedGuidance(job);
  const priority = guidance.filter(g => g.priority === "Review First");
  const source = `<p class="meta">Source: Intelligent VAPT Scans · Scan ID: ${esc(job.id)}<br>Target: ${esc(job.ip)} · Profile: ${esc(job.profile)} · Completed: ${esc(job.finishedAt)}<br>Evidence SHA-256: ${esc(job.evidenceSha256)}</p>`;
  const notice = `<p class="notice"><b>Live Observation Snapshot.</b> Results are from this saved scan only, not demonstration records or current posture. Open ports are exposures, not confirmed vulnerabilities. CVE, CVSS and KEV: Not Assessed.</p>`;
  const limits = "This bounded network check does not establish exploitability, compromise, authenticated vulnerability coverage or absence of weaknesses. UDP silence is ambiguous; closed ports and successful TLS do not prove security. Hostname, OS and topology are not established by these observations.";
  const footer = (page: number) => `<footer>SPECTRE AI · Confidential <span>${page} / 2</span></footer>`;
  const impacts = table(["Dimension", "Potential Impact If Exposure Is Exploited"], [
    ["Financial", "Response and restoration costs and lost operating contribution; monetary exposure is not quantified."],
    ["Reputational", "Loss of customer confidence if unauthorized access or disruption occurs."],
    ["Legal", "Possible contractual or privacy obligations if protected data or services are affected; no violation is established."],
    ["Operational", "Service interruption, degraded availability or unauthorized changes."],
    ["Business", "Delayed delivery, customer loss and disruption to dependencies; validate with business owners."],
  ]);
  let body: string;
  if (kind === "executive") {
    body = `<section class="sheet"><p class="eyebrow">Executive Summary · Live VAPT Evidence</p><h1>Exposure And Threats</h1><p>${short(organization, 90)}</p>${source}${notice}
      <h2>Assessment At A Glance</h2>
      ${table(["Open", "Closed", "Inconclusive", "Missing Results"], [[String(open.length), String(closed.length), String(uncertain.length), String(missing.length)]])}
      <p>${observed.size}/${expected.length} requested protocol/port pairs have observations. ${priority.reduce((n,g)=>n+g.ports.length,0)} ports warrant priority exposure review. These counts are not vulnerability counts.</p>
      <h2>Priority Exposures And Possible Consequences</h2>
      ${table(["Exposure", "Evidence-Based Interpretation"], guidance.slice(0,3).map(g => [short(`${g.title} · ${g.protocol.toUpperCase()} ${g.ports.join(", ")}`,110), short(g.why,230)]))}
      <p class="meta">Showing ${Math.min(3,guidance.length)} of ${guidance.length} guidance groups. Full observations and recommendations are in the Technical Report. Review priorities are rule-based, not CVSS severity.</p>
      <h2>Evidence Limits</h2><p>${limits}</p>${footer(1)}</section>
      <section class="sheet"><p class="eyebrow">Executive Summary · Impacts And Decisions</p><h1>Business Impact And Required Action</h1>${impacts}
      <h2>Financial Exposure And Trend</h2><p><b>Not Quantified.</b> Ask the CFO and service owners to validate downtime, recovery costs and contractual exposure. No financial figures or demo dashboard overrides are imported.</p>
      <p><b>Trend: Not Established.</b> One scan is a point-in-time snapshot; compare equivalent targets, profiles and vantage points before concluding improvement.</p>
      <h2>Decisions Requested</h2>
      <ol><li><b>Validate Exposure:</b> Service owners should confirm which listeners are business-required; prioritize ${priority.length ? "the flagged exposure groups" : "review of observed open and inconclusive results"}.</li>
      <li><b>Authorize Remediation:</b> Network and platform teams should restrict unnecessary access and apply supported hardening through approved change control.</li>
      <li><b>Require Verification:</b> CISO and asset owners should fund version-specific assessment where needed and require retest evidence before accepting closure.</li></ol>
      <h2>Evidence Required For Closure</h2><p>Named owner, approved change, configuration or version evidence, comparable retest and residual-risk acceptance. Port checks alone cannot demonstrate CVE remediation. No remediation is performed automatically.</p>
      <p class="meta">Report linkage: ${esc(job.id)} · ${esc(job.ip)}. Recommendations and impacts are conditional analysis, not proof of an incident.</p>${footer(2)}</section>`;
  } else {
    body = `<h1>Technical VAPT Report</h1><p>${esc(organization)}</p>${source}${notice}
      <h2>Scope, Provenance And Coverage</h2>
      ${table(["Field","Saved Value"], [
        ["Target Label (Not A Verified Hostname)",esc(target?.label)],
        ["Host / Host Status",`${esc(job.ip)} / ${esc(job.hostStatus)}`],
        ["Engine / Runtime",`${esc(job.engine)} / ${esc(job.agentVersion)}`],
        ["Created / Started / Finished",`${esc(job.createdAt)} / ${esc(job.startedAt)} / ${esc(job.finishedAt)}`],
        ["Requested TCP Ports",esc((job.tcpPorts ?? job.ports).join(", "))],
        ["Requested UDP Ports",esc((job.udpPorts ?? []).join(", "))],
        ["Coverage",`${observed.size}/${expected.length} requested pairs observed; ${missing.length} missing: ${esc(missing.map(p=>`${p.port}/${p.protocol}`).join(", ") || "None")}`],
        ["Outcome",`${open.length} open; ${closed.length} closed; ${uncertain.length} inconclusive`],
      ])}<p>${limits}</p>
      <h2>Vulnerability Scores And Risk Interpretation</h2><p>CVE correspondence, CVSS score/vector and KEV applicability are <b>Not Assessed</b>. Do not derive these from a port number, banner or an inferred service. Validate exact product/version and vendor advisory applicability before declaring a vulnerability. Service labels may be inferred; transport, state, detail and timings below are the persisted observations.</p>
      <h2>Complete Port And Service Evidence</h2>
      ${table(["Port / Protocol","State / Service","Product / Version","Reason / Detail / Timing"],services.map(s=>[`${esc(s.port)} / ${esc(protoOf(s))}`,`${esc(s.state)} / ${esc(s.service)}`,`${esc(s.product)} / ${esc(s.version)}`,`${esc(s.reason)}<br>${esc(s.detail)}<br>${esc(s.elapsedMs)} ms`]))}
      <h2>Technical Risks, Impacts And Remediation</h2>
      ${services.map(s=>{const g=serviceGuidance(s);return `<article><h3>${esc(s.port)}/${esc(protoOf(s))} — ${esc(g.title)}</h3><p><b>Review Priority:</b> ${esc(g.priority)} (not CVSS severity)</p><p><b>Evidence:</b> ${esc(g.evidence)}</p><p><b>Risk / Potential Impact:</b> ${esc(g.why)}</p><p><b>Proposed Owner:</b> ${esc(g.owner)}</p><ol>${g.actions.map(a=>`<li>${esc(a)}</li>`).join("")}</ol><p><b>Retest And Closure:</b> ${esc(g.verify)}</p></article>`;}).join("") || "<p>No service observations were retained; validate coverage before drawing conclusions.</p>"}
      <h2>Change Control And Recommendations</h2><p>Confirm business need and dependencies, assign an owner, obtain approval, test changes in staging, preserve backups and rollback steps, then retest the same authorized scope/profile. Record change reference, effective configuration and evidence. Follow vendor-specific fixes only after confirming product/version. Restrict testing to authorized IT/DMZ assets, not live OT control processes. No automated changes are applied.</p>
      <h2>Saved Raw Evidence</h2><p>The stored hash is provided for traceability; this report does not independently authenticate the evidence. Sensitive scan evidence should be shared only with authorized recipients.</p><pre>${esc(job.rawEvidence || "No Raw Evidence Retained")}</pre>
      <p>SPECTRE AI · Confidential · Live scan ${esc(job.id)}</p>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SPECTRE AI Live ${kind === "executive" ? "Executive Summary" : "Technical Report"}</title><style>
    *{box-sizing:border-box}body{font:10pt/1.35 Arial,sans-serif;color:#172737;margin:24px auto;max-width:960px;padding:0 20px;overflow-wrap:anywhere}h1{font-size:23pt;line-height:1.1}h2{font-size:12pt;color:#145b65;border-bottom:1px solid #cbd5dc;margin:5mm 0 2mm}h3{font-size:11pt}h1,h2,h3{break-after:avoid}p{margin:2mm 0 3mm}.meta{font-size:8.5pt;color:#526273}.notice{padding:3mm;background:#fff4d8}.eyebrow{color:#145b65;font-weight:bold}table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:9pt}th,td{text-align:left;vertical-align:top;padding:2mm;border-bottom:1px solid #dce3e8}th{background:#142c42;color:white}thead{display:table-header-group}tr{break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:8pt}li{margin-bottom:3mm}article{border-bottom:1px solid #dce3e8;padding:3mm 0}
    ${kind === "executive" ? "@page{size:A4;margin:0}body{max-width:none;padding:0;margin:0;background:#e9edf2}.sheet{width:210mm;height:297mm;padding:14mm 15mm 17mm;margin:8mm auto;background:white;position:relative;break-after:page}.sheet:last-child{break-after:auto}footer{position:absolute;bottom:8mm;left:15mm;right:15mm;border-top:1px solid #cbd5dc;padding-top:2mm;font-size:8pt}footer span{float:right}@media print{body{background:white}.sheet{margin:0}}" : "@page{size:A4;margin:16mm}@media print{body{max-width:none;margin:0;padding:0}}"}
    ${kind === "executive" ? EXECUTIVE_THEME : DOCUMENT_THEME}
    </style></head><body>${body}</body></html>`;
}
