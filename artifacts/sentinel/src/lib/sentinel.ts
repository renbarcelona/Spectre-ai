import { useGetWorkspace, getGetWorkspaceQueryKey } from "@workspace/api-client-react";
import type { Asset, Vulnerability, Workspace, Scan } from "@workspace/api-client-react";

export function useWorkspace() {
  return useGetWorkspace({
    query: {
      queryKey: getGetWorkspaceQueryKey(),
      refetchInterval: (q) => {
        const d = q.state.data as Workspace | undefined;
        return d?.scans?.some((s) => isActive(s)) || d?.exercises?.some(e => e.status === "running") ? 3000 : 15000;
      },
    },
  });
}

export const isActive = (s: Scan) => ["running", "queued", "pending"].includes(s.status.toLowerCase());

export const SERVICES: Record<number, [string, string]> = {
  21: ["ftp", "tcp"], 22: ["ssh", "tcp"], 23: ["telnet", "tcp"], 25: ["smtp", "tcp"], 53: ["domain", "udp"],
  80: ["http", "tcp"], 110: ["pop3", "tcp"], 123: ["ntp", "udp"], 135: ["msrpc", "tcp"], 139: ["netbios-ssn", "tcp"],
  143: ["imap", "tcp"], 161: ["snmp", "udp"], 389: ["ldap", "tcp"], 443: ["https", "tcp"], 445: ["microsoft-ds", "tcp"],
  502: ["modbus", "tcp"], 636: ["ldaps", "tcp"], 1433: ["ms-sql-s", "tcp"], 1521: ["oracle", "tcp"], 3306: ["mysql", "tcp"],
  3389: ["ms-wbt-server", "tcp"], 5432: ["postgresql", "tcp"], 5900: ["vnc", "tcp"], 6379: ["redis", "tcp"],
  8080: ["http-proxy", "tcp"], 8443: ["https-alt", "tcp"], 9200: ["elasticsearch", "tcp"], 27017: ["mongodb", "tcp"],
};
export const service = (p: number) => SERVICES[p] ?? ["unknown", "tcp"];

export function sevColor(sev: string) {
  const s = sev.toLowerCase();
  if (s === "critical") return "hsl(354 78% 58%)";
  if (s === "high") return "hsl(22 90% 58%)";
  if (s === "medium") return "hsl(42 92% 58%)";
  if (s === "low") return "hsl(204 80% 62%)";
  return "hsl(215 14% 55%)";
}
export function riskColor(r: number) {
  return r >= 80 ? sevColor("critical") : r >= 60 ? sevColor("high") : r >= 40 ? sevColor("medium") : sevColor("low");
}

export const SPEEDS = [
  { v: "T1", name: "Sneaky", d: "IDS-evasive pacing, ~15s between probes" },
  { v: "T2", name: "Polite", d: "Reduced bandwidth, ~0.4s per probe" },
  { v: "T3", name: "Normal", d: "Default balanced timing" },
  { v: "T4", name: "Aggressive", d: "Fast, assumes reliable network" },
  { v: "T5", name: "Insane", d: "Maximum speed, may sacrifice accuracy" },
] as const;

export function ipInScope(ip: string) {
  return /^192\.168\.10\.(\d{1,3})$/.test(ip) && Number(ip.split(".")[3]) <= 255;
}

export function parsePorts(spec: string): Set<number> | null {
  if (!spec.trim()) return null;
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [a, b] = part.trim().split("-").map(Number);
    if (!a) continue;
    if (b) for (let i = a; i <= Math.min(b, a + 70000); i++) out.add(i);
    else out.add(a);
  }
  return out;
}

export function assetsForScan(scan: Scan, assets: Asset[]) {
  const t = scan.target.trim();
  let list = assets;
  if (scan.type === "single" || (scan.type === "ports" && !t.includes("/"))) list = assets.filter((a) => a.ip === t);
  const ports = parsePorts(scan.ports);
  return list.map((a) => ({ ...a, ports: ports ? a.ports.filter((p) => ports.has(p)) : a.ports }));
}

export function hopsFor(a: Asset) {
  return [
    { ip: "192.168.10.1", name: "edge-gw.demo", rtt: 0.42 },
    { ip: "192.168.10.2", name: "core-sw01.demo", rtt: 0.88 },
    { ip: a.ip, name: a.hostname, rtt: 1.1 + (Number(a.ip.split(".")[3]) % 9) * 0.17 },
  ];
}

export const TACTIC: Record<string, string> = {
  T1190: "Initial Access", T1133: "Initial Access", T1078: "Defense Evasion", T1110: "Credential Access",
  T1021: "Lateral Movement", T1210: "Lateral Movement", T1068: "Privilege Escalation", T1059: "Execution",
  T1003: "Credential Access", T1486: "Impact", T1046: "Discovery", T1557: "Credential Access", T1505: "Persistence",
};
export const tactic = (t: string) => TACTIC[t.split(".")[0]] ?? "Technique";

export function scenario(v: Vulnerability, a?: Asset) {
  return `If left unaddressed, an adversary reaching ${a?.hostname ?? "this host"} (${a?.zone ?? "internal"} zone) could leverage ${v.cve || v.title} via ${v.technique}, a ${tactic(v.technique).toLowerCase()} pathway${v.kev ? " already listed in CISA KEV as exploited in the wild" : ""}.`;
}

export const fmtTime = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
