// Pure helpers for protocol-aware embedded evidence and the measured Live Exposure Radar.
// Nothing here fabricates data: categories with no attempted observation are null (Not Assessed).

export type Protocol = "tcp" | "udp";

export interface ServiceLike {
  port: number;
  state: string;
  protocol?: Protocol | string | null;
}
export interface JobLike {
  id: string;
  ip: string;
  engine?: string;
  status: string;
  createdAt: string;
  finishedAt?: string | null;
  ports?: number[];
  tcpPorts?: number[] | null;
  udpPorts?: number[] | null;
  services: ServiceLike[];
}

/** Missing legacy protocol means TCP. */
export const protoOf = (s: { protocol?: string | null }): Protocol => (s.protocol === "udp" ? "udp" : "tcp");
export const pairKey = (p: Protocol, port: number) => `${p}/${port}`;
export const pairLabel = (p: Protocol, port: number) => `${p.toUpperCase()} ${port}`;

/** Expected protocol/port checks for a job. Legacy jobs without tcpPorts/udpPorts are TCP-only. */
export function jobPairs(j: JobLike): { protocol: Protocol; port: number }[] {
  const hasSplit = Array.isArray(j.tcpPorts) || Array.isArray(j.udpPorts);
  const tcp = hasSplit ? j.tcpPorts ?? [] : j.ports ?? [];
  const udp = hasSplit ? j.udpPorts ?? [] : [];
  return [...tcp.map((port) => ({ protocol: "tcp" as const, port })), ...udp.map((port) => ({ protocol: "udp" as const, port }))];
}

/** Formats e.g. "TCP 22, 80 · UDP 53". */
export function fmtPairs(pairs: { protocol: Protocol; port: number }[]): string {
  const tcp = pairs.filter((p) => p.protocol === "tcp").map((p) => p.port);
  const udp = pairs.filter((p) => p.protocol === "udp").map((p) => p.port);
  return [tcp.length ? `TCP ${tcp.join(", ")}` : "", udp.length ? `UDP ${udp.join(", ")}` : ""].filter(Boolean).join(" · ");
}

// ---------- Custom port input validation ----------
export const MAX_CUSTOM_CHECKS = 30;

export function parsePortSpec(text: string): { ports: number[]; error: string | null } {
  if(text.length>1024) return {ports:[],error:"Maximum 1,024 characters per port list"};
  const t = text.trim();
  if (!t) return { ports: [], error: null };
  const set = new Set<number>();
  for (const raw of t.split(",")) {
    const tok = raw.trim();
    if (!tok) return { ports: [], error: "Empty entry between commas" };
    const m = tok.match(/^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/);
    if (!m) return { ports: [], error: `Malformed entry "${tok}"` };
    const a = Number(m[1]), b = m[2] !== undefined ? Number(m[2]) : a;
    if (a < 1 || b < 1 || a > 65535 || b > 65535) return { ports: [], error: `Port out of range 1–65535 in "${tok}"` };
    if (b < a) return { ports: [], error: `Descending range "${tok}"` };
    if (b - a + 1 > MAX_CUSTOM_CHECKS) return { ports: [], error: `Range "${tok}" exceeds ${MAX_CUSTOM_CHECKS} ports` };
    for (let p = a; p <= b; p++) set.add(p);
    if(set.size>MAX_CUSTOM_CHECKS) return {ports:[],error:`Maximum ${MAX_CUSTOM_CHECKS} checks`};
  }
  return { ports: [...set].sort((x, y) => x - y), error: null };
}

export function validateCustomPorts(tcpText: string, udpText: string) {
  const tcp = parsePortSpec(tcpText), udp = parsePortSpec(udpText);
  const total = tcp.ports.length + udp.ports.length;
  const error = tcp.error ? `TCP: ${tcp.error}` : udp.error ? `UDP: ${udp.error}` : total === 0 ? "Enter at least one TCP or UDP port" : total > MAX_CUSTOM_CHECKS ? `${total} checks exceeds the limit of ${MAX_CUSTOM_CHECKS}` : null;
  return { tcp: tcp.ports, udp: udp.ports, total, error, tcpError: tcp.error, udpError: udp.error };
}

// ---------- Measured exposure aggregation ----------
export const WEB_PORTS = [80, 443, 8000, 8080, 8443];
export const REMOTE_PORTS = [22, 3389, 5900, 445];
export const DB_PORTS = [1433, 1521, 3306, 5432, 6379, 9200, 27017];
export const VALID_STATES = new Set(["open", "closed", "filtered", "unfiltered", "open|filtered", "closed|filtered", "timeout", "error"]);
export const INCONCLUSIVE_STATES = new Set(["timeout", "error", "filtered", "unfiltered", "open|filtered", "closed|filtered"]);
export const RETENTION_LIMIT = 50;

export type MetricKey = "openTcp" | "udp" | "web" | "remote" | "database" | "inconclusive";
export interface ExposureMetric {
  key: MetricKey;
  label: string;
  axis: string;
  /** null = Not Assessed (no relevant attempted observation). */
  count: number | null;
  /** Distinct host+protocol+port observations relevant to this category. */
  attempted: number;
  definition: string;
}
export interface ExcludedNotice { ip: string; jobId: string; status: string; at: string }
export interface ExposureSnapshot {
  metrics: ExposureMetric[];
  targetCount: number;
  checkCount: number;
  invalidCount: number;
  includedJobIds: string[];
  includedJobs: { id: string; ip: string; at: string; observations: number }[];
  start: string | null;
  end: string | null;
  excludedNewer: ExcludedNotice[];
  scaleMax: number;
  historyCount: number;
  retentionMayTruncate: boolean;
}

const tsOf = (j: JobLike) => j.finishedAt || j.createdAt;
/** Later timestamp wins; ties broken deterministically by id (lexicographically greater wins). */
function newer(a: JobLike, b: JobLike) {
  const ta = new Date(tsOf(a)).getTime(), tb = new Date(tsOf(b)).getTime();
  return ta !== tb ? ta > tb : a.id > b.id;
}

export function niceMax(n: number): number {
  if (n <= 1) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 2, 5, 10]) if (m * mag >= n) return m * mag;
  return 10 * mag;
}

export function aggregateLiveExposure(jobs: readonly JobLike[]): ExposureSnapshot {
  const embedded = jobs.filter((j) => j.engine === "embedded");
  const latest = new Map<string, JobLike>();
  for (const j of embedded) {
    if (j.status !== "completed") continue;
    const p = latest.get(j.ip);
    if (!p || newer(j, p)) latest.set(j.ip, j);
  }
  // Newer non-completed embedded jobs per IP (failed/running/cancelled/queued) are excluded but surfaced.
  const excludedNewer: ExcludedNotice[] = [];
  const latestOther = new Map<string, JobLike>();
  for (const j of embedded) {
    if (j.status === "completed") continue;
    const sel = latest.get(j.ip);
    if (sel && !newer(j, sel)) continue;
    const p = latestOther.get(j.ip);
    if (!p || newer(j, p)) latestOther.set(j.ip, j);
  }
  for (const j of latestOther.values()) excludedNewer.push({ ip: j.ip, jobId: j.id, status: j.status, at: tsOf(j) });
  excludedNewer.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));

  const included = [...latest.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  type Obs = { protocol: Protocol; port: number; state: string };
  const obs: Obs[] = [];
  let invalid = 0;
  const includedJobs: ExposureSnapshot["includedJobs"] = [];
  for (const j of included) {
    const seen = new Set<string>();
    let n = 0;
    for (const s of j.services) {
      if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535 || !VALID_STATES.has(s.state) ||
        (s.protocol!=null && s.protocol!=="tcp" && s.protocol!=="udp")) { invalid++; continue; }
      const k = pairKey(protoOf(s), s.port);
      if (seen.has(k)) continue;
      seen.add(k); n++;
      obs.push({ protocol: protoOf(s), port: s.port, state: s.state });
    }
    includedJobs.push({ id: j.id, ip: j.ip, at: tsOf(j), observations: n });
  }

  const metric = (key: MetricKey, label: string, axis: string, definition: string, relevant: (o: Obs) => boolean, hit: (o: Obs) => boolean): ExposureMetric => {
    const rel = obs.filter(relevant);
    return { key, label, axis, definition, attempted: rel.length, count: rel.length ? rel.filter(hit).length : null };
  };
  const isOpen = (o: Obs) => o.state === "open";
  const tcpIn = (list: number[]) => (o: Obs) => o.protocol === "tcp" && list.includes(o.port);
  const metrics: ExposureMetric[] = [
    metric("openTcp", "Open TCP Ports", "Open TCP", "TCP observations with state open.", (o) => o.protocol === "tcp", isOpen),
    metric("udp", "Responding UDP Ports", "UDP Responding", "UDP observations with state open (a datagram response was received).", (o) => o.protocol === "udp", isOpen),
    metric("web", "Open Web Ports", "Web", `Open TCP ${WEB_PORTS.join(", ")}.`, tcpIn(WEB_PORTS), isOpen),
    metric("remote", "Open Remote Access Ports", "Remote Access", `Open TCP ${REMOTE_PORTS.join(", ")}.`, tcpIn(REMOTE_PORTS), isOpen),
    metric("database", "Open Database Ports", "Database", `Open TCP ${DB_PORTS.join(", ")}.`, tcpIn(DB_PORTS), isOpen),
    metric("inconclusive", "Inconclusive Checks", "Inconclusive", "States timeout, error, filtered, unfiltered, open|filtered or closed|filtered.", () => true, (o) => INCONCLUSIVE_STATES.has(o.state)),
  ];
  const times = includedJobs.map((j) => j.at).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const maxCount = Math.max(0, ...metrics.map((m) => m.count ?? 0));
  return {
    metrics, targetCount: included.length, checkCount: obs.length, invalidCount: invalid,
    includedJobIds: included.map((j) => j.id), includedJobs,
    start: times[0] ?? null, end: times[times.length - 1] ?? null,
    excludedNewer, scaleMax: niceMax(maxCount), historyCount: jobs.length,
    retentionMayTruncate: jobs.length >= RETENTION_LIMIT,
  };
}
