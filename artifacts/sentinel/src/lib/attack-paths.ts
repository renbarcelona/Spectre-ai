import type { Asset, Vulnerability } from "@workspace/api-client-react";
import { tactic } from "@/lib/sentinel";

export type StepBasis = "observed" | "assumed";

export interface PathStep {
  id: string;
  technique: string;
  name: string;
  tactic: string;
  basis: StepBasis;
  asset?: Asset;
  zone: string;
  finding?: Vulnerability;
  prerequisites: string[];
  uncertainty: string;
  mitigation: string;
}

export interface AttackScenario {
  id: string;
  title: string;
  summary: string;
  steps: PathStep[];
}

export const EMERGENCY_STOP_EVENT = "spectre:emergency-stop";

const NAMES: Record<string, string> = {
  T1190: "Exploit Public-Facing Application", T1133: "External Remote Services", T1078: "Valid Accounts",
  T1110: "Brute Force", T1021: "Remote Services", T1210: "Exploitation of Remote Services",
  T1068: "Exploitation for Privilege Escalation", T1059: "Command and Scripting Interpreter",
  T1003: "OS Credential Dumping", T1486: "Data Encrypted for Impact", T1046: "Network Service Discovery",
  T1557: "Adversary-in-the-Middle", T1505: "Server Software Component",
};
export const techniqueName = (t: string) => NAMES[t.split(".")[0]] ?? "Mapped technique";

export function attackUrl(t: string) {
  const id = t.trim().toUpperCase().replace(/^T?/, "T").replace(".", "/");
  return `https://attack.mitre.org/techniques/${id}/`;
}

function observed(v: Vulnerability, a?: Asset): PathStep {
  return {
    id: `obs-${v.id}`, technique: v.technique, name: techniqueName(v.technique), tactic: tactic(v.technique),
    basis: "observed", asset: a, zone: a?.zone ?? "unknown", finding: v,
    prerequisites: [`Service on ${a?.ip ?? "host"} reachable by an adversary (not verified)`, `Vulnerable condition per ${v.cve || v.title} remains unpatched`],
    uncertainty: `Demo mapping from a simulated finding (confidence ${Math.round(v.confidence * (v.confidence <= 1 ? 100 : 1))}%). Exploitability was not tested.`,
    mitigation: v.recommendation,
  };
}

function assumed(technique: string, zone: string, asset: Asset | undefined, prereq: string[], mitigation: string): PathStep {
  return {
    id: `asm-${technique}-${asset?.id ?? zone}`, technique, name: techniqueName(technique), tactic: tactic(technique),
    basis: "assumed", asset, zone, prerequisites: prereq,
    uncertainty: "Assumption only. No supporting finding, credential, or reachability evidence exists in this workspace.",
    mitigation,
  };
}

export function buildScenarios(hosts: Asset[], findings: Vulnerability[]): AttackScenario[] {
  const assetOf = (id: string) => hosts.find((h) => h.id === id);
  const ranked = [...findings].sort((a, b) => b.score - a.score);
  const entries = [
    ...ranked.filter((v) => ["Initial Access"].includes(tactic(v.technique))),
    ...ranked.filter((v) => !["Initial Access"].includes(tactic(v.technique))),
  ].slice(0, 5);

  return entries.map((v) => {
    const a = assetOf(v.assetId);
    const others = hosts.filter((h) => h.id !== v.assetId).sort((x, y) => y.risk - x.risk);
    const pivot = others[0];
    const steps: PathStep[] = [observed(v, a)];
    steps.push(assumed("T1046", a?.zone ?? "internal", a,
      ["Foothold on entry host (assumed, not demonstrated)", "Ability to run discovery from that host"],
      "Segment zones and alert on internal port sweeps from server subnets."));
    if (pivot) {
      steps.push(assumed("T1021", pivot.zone, pivot,
        ["Valid credentials for the target (none observed)", `Network path from ${a?.ip ?? "entry"} to ${pivot.ip} (not verified)`],
        "Enforce MFA on remote services and restrict admin protocols to jump hosts."));
      const pf = ranked.find((x) => x.assetId === pivot.id);
      if (pf) {
        const s = observed(pf, pivot);
        s.uncertainty += " Chaining it after the prior steps is an assumption.";
        steps.push(s);
      }
    }
    const isEntry = tactic(v.technique) === "Initial Access";
    return {
      id: v.id,
      title: `${isEntry ? "Exposed" : "Weakness on"} ${a?.hostname ?? "host"} to hypothetical ${pivot ? "lateral movement" : "discovery"}`,
      summary: `Starts from ${v.cve || v.title} (${v.technique}). Later steps are hypothetical.`,
      steps,
    };
  });
}
