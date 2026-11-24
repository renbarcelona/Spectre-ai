import { pool } from "@workspace/db";
import { GetLiveDiscoveryResponse } from "@workspace/api-zod";
import { createHash } from "node:crypto";

type PublicState = ReturnType<typeof GetLiveDiscoveryResponse.parse>;
export type Agent = PublicState["agents"][number] & { tokenHash: string };
export type Job = PublicState["jobs"][number] & { leaseId?: string; leaseUntil?: number };
export type LiveState = Omit<PublicState, "agents" | "jobs"> & { agents: Agent[]; jobs: Job[] };
export const PROFILES = {
  web: [80, 443, 8080, 8443],
  standard: [21, 22, 25, 53, 80, 110, 143, 443, 445, 465, 587, 993, 995, 1433, 1521, 3306, 3389, 5432, 5900, 6379, 8000, 8080, 8443, 9200, 27017],
};
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const now = () => new Date().toISOString();
export const active = (j: Job) => ["queued", "running", "cancelling"].includes(j.status);
export function isPublicIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some(p => !/^(0|[1-9]\d{0,2})$/.test(p) || +p > 255)) return false;
  const [a, b, c] = parts.map(Number) as [number, number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}
export function audit(s: LiveState, actor: string, action: string) {
  s.audit.unshift({ at: now(), actor, action });
  s.audit = s.audit.slice(0, 200);
}
export function cancel(j: Job) {
  if (j.status === "queued") { j.status = "cancelled"; j.finishedAt = now(); }
  else if (j.status === "running") j.status = "cancelling";
}
export function publicJob(j: Job) {
  const { leaseId: _lease, leaseUntil: _expiry, ...rest } = j;
  return rest;
}
export function publicAgent(a: Agent) {
  const { tokenHash: _secret, ...rest } = a;
  return rest;
}
export function publicState(s: LiveState): PublicState {
  return { ...s, agents: s.agents.map(publicAgent), jobs: s.jobs.map(publicJob) };
}
function expire(s: LiveState) {
  for (const j of s.jobs.filter(active)) {
    const t = s.targets.find(t => t.id === j.targetId);
    const a = s.agents.find(a => a.id === j.agentId);
    if (!t || t.revoked || Date.parse(t.expiresAt) <= Date.now() || (j.engine !== "embedded" && (!a || a.revoked))) cancel(j);
    if (j.status === "queued" && Date.now() - Date.parse(j.createdAt) > 300_000) {
      j.status = "failed"; j.error = "No agent claimed this job within five minutes."; j.finishedAt = now();
    } else if (["running", "cancelling"].includes(j.status) && (!j.leaseUntil || Date.now() > j.leaseUntil)) {
      j.status = "failed"; j.error = j.engine === "embedded"
        ? "Embedded execution lease expired or backend restarted. No successful result asserted."
        : "Agent lease expired. The worker is required to stop on loss of contact; termination was not acknowledged."; j.finishedAt = now();
      audit(s, "system", `Job ${j.id} lease expired; no successful scan asserted.`);
    }
  }
}
export async function liveOperation<T>(owner: string, fn: (s: LiveState) => T, create = true): Promise<T | undefined> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (create) await client.query("INSERT INTO live_discovery_workspaces (owner_id,data) VALUES ($1,$2) ON CONFLICT DO NOTHING", [owner, JSON.stringify({ agents: [], targets: [], jobs: [], audit: [] })]);
    const found = await client.query("SELECT data FROM live_discovery_workspaces WHERE owner_id=$1 FOR UPDATE", [owner]);
    if (!found.rows[0]) { await client.query("ROLLBACK"); return undefined; }
    const state = found.rows[0].data as LiveState;
    expire(state);
    const result = fn(state);
    await client.query("UPDATE live_discovery_workspaces SET data=$2 WHERE owner_id=$1", [owner, JSON.stringify(state)]);
    await client.query("COMMIT");
    return result;
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}
