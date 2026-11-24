import type { Workspace, Vulnerability } from "@workspace/api-client-react";
import { SERVICES } from "@/lib/sentinel";
import { isOpen } from "@/lib/risk-model";
import { DOCUMENT_THEME } from "@/lib/report-theme";

const esc = (value: unknown) => String(value ?? "Not Recorded").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const text = (value: unknown) => esc(value === "" ? "Not Recorded" : value);

function guidance(v: Vulnerability) {
  const technique = (v.technique || "").split(".")[0];
  if (["T1078", "T1110", "T1003"].includes(technique)) return {
    impact: "Unauthorized account access, credential disclosure, privilege abuse and access to protected data.",
    fix: "Enforce phishing-resistant MFA where supported; disable dormant accounts and legacy authentication; remove unnecessary privileges. Rotate exposed credentials and revoke sessions after containing the source of exposure. Protect credential stores and monitor authentication failures.",
    verify: "Confirm MFA enforcement and denied legacy access with an approved test account. Verify privilege assignments, session revocation and authentication alerts without using production credentials in test evidence.",
  };
  if (["T1021", "T1210", "T1133", "T1046"].includes(technique)) return {
    impact: "Unauthorized remote access or lateral movement could extend compromise to additional systems and interrupt dependent services.",
    fix: "Restrict remote administration to approved management networks or a controlled access gateway. Apply deny-by-default firewall rules, disable unused services, patch the affected component and require strong authentication. Validate dependencies before removing access.",
    verify: "Retest the authorized service from both permitted and denied network segments. Confirm required business connectivity still works and denied access is logged.",
  };
  if (technique === "T1486") return {
    impact: "Loss of availability and integrity through encryption or destruction of data, with service disruption and recovery effort.",
    fix: "Address the initial access weakness, restrict write permissions, segment critical services and deploy supported endpoint protections. Maintain offline or immutable backups under separate administrative credentials.",
    verify: "Perform an isolated restore test, confirm recovery objectives and validate backup access separation. Do not execute ransomware or destructive tests on production systems.",
  };
  if (["T1190", "T1505", "T1059", "T1068", "T1557"].includes(technique)) return {
    impact: "Depending on confirmed exploit prerequisites, unauthorized execution, elevated access, interception or persistence could compromise data confidentiality, integrity or service availability.",
    fix: "Identify the affected product and exact version, then follow its vendor advisory for a fixed release or supported mitigation. Harden service permissions, disable unnecessary functionality, protect transport and restrict ingress. Temporary filtering is not a substitute for a permanent fix.",
    verify: "Verify the deployed version and effective configuration against the advisory. Repeat only the approved non-destructive check, test application functionality and review service and endpoint logs for recurrence.",
  };
  return {
    impact: "Potential unauthorized access, data exposure or service interruption; the exact consequence requires validation of the affected component, reachability and exploit prerequisites.",
    fix: "Validate the finding against authoritative vendor documentation, identify the vulnerable configuration or component, apply the supported fix and restrict unnecessary access. Use documented compensating controls if a permanent fix is not yet possible.",
    verify: "Repeat the original approved non-destructive check, verify the effective configuration or fixed version, test dependent services and retain before-and-after evidence.",
  };
}

export function buildTechnicalReport(ws: Workspace, generated = new Date()): string {
  const findings = [...ws.vulnerabilities].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || Number(b.kev) - Number(a.kev) || b.score - a.score);
  const open = findings.filter(isOpen);
  const ports = (values: number[]) => values.length ? values.map(p => `${esc(p)} / ${esc(SERVICES[p]?.[0] ?? "Unknown")} / ${esc(SERVICES[p]?.[1] ?? "Unknown")}`).join("<br>") : "No Ports Recorded";
  const table = (head: string[], rows: string[][]) => `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}">No Records Available</td></tr>`}</tbody></table>`;
  const detail = findings.map((v, i) => {
    const a = ws.assets.find(asset => asset.id === v.assetId);
    const g = guidance(v);
    const cve = /^CVE-\d{4}-\d{4,}$/i.test(v.cve || "") ? `<a href="https://nvd.nist.gov/vuln/detail/${encodeURIComponent(v.cve)}">${esc(v.cve)}</a>` : text(v.cve);
    return `<article id="finding-${i + 1}">
      <h2>${i + 1}. ${text(v.title)}</h2>
      ${table(["Field", "Recorded Value"], [
        ["Finding / Asset ID", `${text(v.id)} / ${text(v.assetId)}`],
        ["Affected Host", a ? `${text(a.hostname)} · ${text(a.ip)} · ${text(a.os)} · Zone: ${text(a.zone)}` : "Asset Record Unavailable"],
        ["Vulnerability Score / Severity", `${Number.isFinite(v.score) && v.score >= 0 && v.score <= 10 ? `${v.score.toFixed(1)}/10` : "Not Recorded"} / ${text(v.severity)} (stored values; CVSS version/vector not recorded)`],
        ["CVE / Exploitation Flag", `${cve} · KEV: ${v.kev ? "Flagged In Demo Record" : "Not Flagged In Demo Record"}; not independently verified`],
        ["MITRE ATT&CK / Confidence", `${text(v.technique)} / ${Number.isFinite(v.confidence) ? text(v.confidence) : "Not Recorded"} (raw stored value; calibration not documented)`],
        ["Review Status / Open Classification", `${text(v.status)} / ${isOpen(v) ? "Open" : "Closed By Recorded Status"}; approval alone is not remediation`],
        ["Host Service Context", a ? ports(a.ports) : "Not Available"],
      ])}
      <h3>Technical Evidence And Limitations</h3>
      <p>Source: demonstration vulnerability and linked asset records. Host ports above are asset-level context, not proof that a particular port is vulnerable. Service names and transport are inferred from conventional port mappings, not measured fingerprints. Affected product/version, finding-specific port, CVSS vector, raw probe output, exploit prerequisites, detection time and finding-to-scan linkage are not recorded. Confirm these before treating this as a verified vulnerability.</p>
      <h3>Risk And Potential Impact</h3><p>${esc(g.impact)} This is a conditional threat scenario, not evidence of compromise. Validate asset criticality, network reachability, data sensitivity and existing controls before determining residual risk.</p>
      <h3>Technical Remediation Guidance</h3>
      <p><b>Recorded Finding Recommendation:</b> ${v.recommendation?.trim() ? esc(v.recommendation) : "No finding-specific recommendation recorded; obtain the relevant vendor advisory."}</p>
      <p><b>Asset Recommendation:</b> ${a?.recommendation?.trim() ? esc(a.recommendation) : "Not Recorded"}</p>
      <p><b>Supplemental Guidance:</b> ${esc(g.fix)} Guidance is rule-based from the recorded technique, not a verified CVE-specific patch prescription.</p>
      <h3>Implementation And Verification</h3>
      <ol><li>Assign an accountable system owner and validate the CVE, affected version and applicability. Preserve sanitized baseline evidence; do not include credentials.</li>
      <li>Obtain change approval, test in staging, back up configuration and data, document rollback and schedule an agreed maintenance window. Do not actively test live OT control processes.</li>
      <li>${esc(g.verify)}</li>
      <li>Close only after an independent reviewer accepts the retest results and business-service checks. Record owner, change reference, fixed version/configuration, test date, evidence and residual risk. If deferred, record compensating controls, risk acceptance and a review date.</li></ol>
      <h3>References</h3><p>${cve}${/^T\d{4}(?:\.\d{3})?$/.test(v.technique || "") ? ` · <a href="https://attack.mitre.org/techniques/${v.technique.replace(".", "/")}/">MITRE ${esc(v.technique)}</a>` : ""} · <a href="https://www.cisa.gov/known-exploited-vulnerabilities-catalog">CISA KEV Catalog</a>. Consult the affected vendor advisory for exact versions and fixes; references are not live-validated.</p>
    </article>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SPECTRE AI Technical VAPT Report</title><style>
    @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:10pt/1.5 Arial,sans-serif;color:#172737;max-width:960px;margin:32px auto;padding:0 24px;overflow-wrap:anywhere}h1{font-size:24pt}h2{font-size:15pt;border-bottom:1px solid #b6c5cf;padding-bottom:5px;margin-top:25px}h3{font-size:11pt;margin-bottom:4px}h1,h2,h3{break-after:avoid}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9pt;margin:12px 0}th,td{text-align:left;vertical-align:top;border:1px solid #dce3e9;padding:6px}th{background:#172f40;color:white}thead{display:table-header-group}tr{break-inside:avoid}a{color:#12556b}.banner{padding:12px;background:#fff3d6;border:1px solid #c7a45f}.meta{color:#536574}article{break-before:page}li{margin-bottom:5px}@media print{body{max-width:none;margin:0;padding:0}a{color:inherit;text-decoration:none}}
${DOCUMENT_THEME}
    </style></head><body>
    <div class="banner"><b>Demonstration Evidence Only.</b> This report contains simulated workspace records, not a real security assessment. Intelligent VAPT live-scan results are not included. Generating this report performs no scans or remediation.</div>
    <h1>SPECTRE AI Technical VAPT Report</h1><p class="meta">${text(ws.settings.organization)} · Generated: ${esc(generated.toISOString())} · Configured Scope: ${text(ws.settings.allowedSubnet)}</p>
    <h2>Assessment Scope And Methodology</h2><p>Full inventory, findings and demonstration scan history from the current workspace snapshot. Scope is the configured boundary, not proof that every address was tested. All findings, including closed and rejected records, are retained. No authenticated testing, exploitation or live validation is performed by this report.</p>
    <h2>Vulnerability Scores And Technical Risk</h2><p>${findings.length} total findings · ${open.length} open · ${findings.filter(v => v.kev).length} demo KEV flags · ${ws.assets.length} asset records. Stored workspace risk index: ${text(ws.riskScore)}/100; its formula is not recorded in this report. This is not a breach probability or financial loss estimate.</p>
    <p>CVSS reference bands: Critical 9.0–10.0; High 7.0–8.9; Medium 4.0–6.9; Low 0.1–3.9; None 0.0. Scores and severity below are preserved as recorded, not recomputed. CVSS version and vector are unavailable. Validate discrepancies against the vendor advisory. A KEV flag does not confirm exploitation of this host.</p>
    ${table(["Severity", "All Findings", "Open Findings"], ["critical","high","medium","low","informational"].map(s => [esc(s),String(findings.filter(v => v.severity.toLowerCase() === s).length),String(open.filter(v => v.severity.toLowerCase() === s).length)]))}
    <h2>Remediation Prioritization And Recommendations</h2><p>Review open findings first, then KEV flags, then descending score. This ordering is a triage aid, not a calibrated risk formula or an SLA. Validate external exposure, exploitability, business dependencies and compensating controls. Prioritize confirmed exploited/reachable weaknesses, then critical and high exposures. Set owner-approved deadlines; no due dates or owners are inferred.</p>
    ${table(["Finding", "Host / Asset", "Score / Severity", "Status"], findings.map((v,i) => [`<a href="#finding-${i+1}">${i+1}. ${text(v.title)}</a>`,text(ws.assets.find(a => a.id===v.assetId)?.hostname ?? v.assetId),`${text(v.score)} / ${text(v.severity)}`,text(v.status)]))}
    <h2>Asset Inventory And Service Context</h2><p>Port/service/transport mappings are inferred, not banner or protocol verification. No recorded ports does not establish that a host is secure.</p>
    ${table(["Host / IP", "OS / Zone / Type", "Risk /100", "Port / Inferred Service / Transport"], ws.assets.map(a => [`${text(a.hostname)}<br>${text(a.ip)}`,`${text(a.os)}<br>${text(a.zone)} / ${text(a.type)}`,text(a.risk),ports(a.ports)]))}
    <h2>Demonstration Scan History</h2>
    ${table(["Scan / Created", "Target / Type", "Ports / Timing Profile", "Status / Progress / Findings"], ws.scans.map(s => [`${text(s.id)}<br>${text(s.createdAt)}`,`${text(s.target)} / ${text(s.type)}`,`${text(s.ports)} / ${text(s.speed)}`,`${text(s.status)} / ${text(s.progress)}% / ${text(s.findings)}`]))}
    <h2>Detailed Vulnerability Records</h2>${detail || "<p>No vulnerability records are available. An empty report does not establish the absence of vulnerabilities.</p>"}
    <p class="meta">SPECTRE AI · Technical Report · Confidential · Demonstration evidence. No automated changes were applied.</p></body></html>`;
}
