import type { LiveJob } from "@workspace/api-client-react";
import { Panel, EmptyState } from "@/components/kit";
import { consolidatedGuidance } from "@/lib/embedded-guidance";
import { protoOf, jobPairs, pairKey, fmtPairs, type Protocol } from "@/lib/live-exposure";

type Pair = { protocol: Protocol; port: number };

export function EmbeddedGuidance({ jobs, current, onSelect }: {
  jobs: LiveJob[]; current?: LiveJob; onSelect: (id: string) => void;
}) {
  const recommendations = current ? consolidatedGuidance(current) : [];
  const svc = current?.services ?? [];
  const toPair = (s: { port: number; protocol?: string | null }): Pair => ({ protocol: protoOf(s), port: s.port });
  const openPorts = svc.filter((s) => s.state === "open").map(toPair);
  const closedPorts = svc.filter((s) => s.state === "closed").map(toPair);
  const uncertainPorts = svc.filter((s) => !["open", "closed"].includes(s.state)).map(toPair);
  const observed = new Set(svc.map((s) => pairKey(protoOf(s), s.port)));
  const expected = current ? jobPairs(current) : [];
  const missing = expected.filter((p) => !observed.has(pairKey(p.protocol, p.port)));
  return (
    <Panel kicker="Step 4" title="Key Recommendations & Guidance" className="xl:col-span-12">
      <div className="space-y-4" data-testid="panel-embedded-guidance">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Consolidated, evidence-based guidance for the selected check. Review priorities are not CVSS severity.
        </p>
        {!current ? <EmptyState title="Awaiting Check Evidence" body="Run an approved embedded check. Recommendations will appear here automatically and remain available for each check in history." /> : <>
          <label className="block text-xs font-medium">Check History
            <select aria-label="Recommendation Check History" value={current.id} onChange={(e) => onSelect(e.target.value)}
              className="mt-2 block w-full min-w-0 rounded border border-border bg-background p-2 text-xs">
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.ip} · {j.profile} · {j.status} · {new Date(j.createdAt).toLocaleString()} · {j.id}</option>)}
            </select>
          </label>
          <section className="space-y-3 text-xs leading-relaxed" aria-label="Scan Results Summary">
            <h3 className="text-sm font-semibold">Scan Results Summary · {current.ip}</h3>
            <p>{observed.size}/{expected.length} protocol/port checks observed: <strong>{openPorts.length} open</strong>, {closedPorts.length} closed and {uncertainPorts.length} inconclusive. {recommendations.filter((r) => r.priority === "Review First").reduce((sum, r) => sum + r.ports.length, 0)} open ports warrant priority exposure review. These are network observations, not confirmed vulnerabilities.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs" data-testid="table-guidance-summary">
                <thead><tr className="border-b border-border text-muted-foreground"><th className="py-2 pr-4">Result</th><th className="py-2 pr-4">Protocol / Ports</th><th className="py-2">CVE Correspondence</th></tr></thead>
                <tbody>
                  {[
                    ["Open", openPorts, "Unverified — product, version and affected configuration not established."],
                    ["Closed", closedPorts, "Not Assessed — a refusal cannot establish CVE applicability."],
                    ["Inconclusive", uncertainPorts, "Unknown — insufficient evidence to assess CVE applicability."],
                    ["Not Observed", missing, "Not Assessed — no result available."],
                  ].map(([label, ports, cve]) => (ports as Pair[]).length > 0 && <tr key={label as string} className="border-b border-border/40 align-top"><td className="py-2 pr-4 font-medium">{label as string}</td><td className="py-2 pr-4 font-mono">{fmtPairs(ports as Pair[])}</td><td className="py-2 text-muted-foreground">{cve as string}</td></tr>)}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground"><strong className="text-foreground">CVE Interpretation: </strong>No CVE match is verified by this scan. Embedded checks do not fingerprint software or query a CVE database. Identify the actual product, build/version, patch level and configuration through authorized inventory; then validate applicable CVE records against vendor advisories and NVD. A port number or a TLS identity warning alone is not a CVE match. “Unverified” does not mean “no vulnerabilities.”</p>
          </section>
          <p className="break-all font-mono text-[10px] text-muted-foreground">Source: Embedded Check {current.id} · {current.status} · {current.finishedAt ? `Finished ${new Date(current.finishedAt).toLocaleString()}` : `Created ${new Date(current.createdAt).toLocaleString()}`} · Evidence SHA-256: {current.evidenceSha256 || "Not Available"}</p>
          {current.status !== "completed" && <p className="text-xs text-accent">This check is {current.status}. Guidance covers only recorded observations, not a completed assessment. {current.status === "failed" ? "Review the execution error in Evidence, resolve the runtime/network issue, then rerun within approved scope." : current.status === "cancelled" ? "Rerun within approved scope if complete coverage is needed." : "Wait for a terminal result before relying on coverage."}</p>}
          {missing.length > 0 && <p className="text-xs text-muted-foreground">No Evidence Yet: {fmtPairs(missing)}. No security conclusion can be drawn for these ports.</p>}
          <section className="space-y-3 border-t border-border pt-4" aria-label="Consolidated Recommendations">
            <h3 className="text-sm font-semibold">Consolidated Recommendations</h3>
            {recommendations.length === 0 ? <p className="text-xs text-muted-foreground">No port-level remediation can be recommended until observations are available. Resolve any execution issue and complete an authorized check first.</p> : <>
              <p className="text-xs leading-relaxed text-muted-foreground">The actions below combine related observations and remove repeated advice. Confirm the actual services before applying port-based recommendations. Assign owners and deadlines based on business criticality, review dependencies, and use an approved maintenance window with a rollback plan.</p>
              <ol className="list-decimal space-y-5 pl-5 text-xs leading-relaxed" data-testid="list-consolidated-recommendations">
                {recommendations.map((r) => <li key={`${r.protocol}:${r.priority}:${r.title}`} className="pl-1">
                  <h4 className="font-semibold">{r.title} <span className="font-normal text-primary">· {r.priority}</span></h4>
                  <p className="mt-1 text-muted-foreground">Applies To {r.protocol.toUpperCase()} {r.ports.join(", ")} · Suggested Owner: {r.owner}</p>
                  <p className="mt-2">{r.actions.join(" ")}</p>
                  <p className="mt-2 text-muted-foreground"><strong className="text-foreground">Validation: </strong>{r.verify}</p>
                </li>)}
              </ol>
              <p className="text-xs leading-relaxed text-muted-foreground"><strong className="text-foreground">Closeout: </strong>For any subsequently verified CVE, follow the vendor’s fixed-version or mitigation guidance and verify the installed build, including backported patches. Retain change evidence and rerun the same target/profile. Port checks alone cannot prove a CVE is remediated; use an authorized vulnerability-specific validation before closing the finding.</p>
            </>}
          </section>
          <p className="text-[11px] leading-relaxed text-muted-foreground">Snapshot Only: Historical evidence is not current posture. After changes, run a new authorized check and compare the same target/profile. This module does not execute remediation, verify CVEs, detect compromise or mark risks resolved. An open port is not proof of a vulnerability; closed ports and successful TLS do not prove security.</p>
        </>}
      </div>
    </Panel>
  );
}
