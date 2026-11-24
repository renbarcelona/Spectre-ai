import { Router, type Request, type Response } from "express";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  RegisterScannerBody, ApprovePublicTargetBody, CreateLiveJobBody,
  PollScannerBody, SubmitScannerResultBody,
  CreateEmbeddedJobBody,
} from "@workspace/api-zod";
import { active, audit, cancel, hash, isPublicIPv4, liveOperation, now, PROFILES, publicAgent, publicJob, publicState, type Agent, type LiveState } from "../lib/live-discovery";
import { embeddedStatus, startEmbedded } from "../lib/embedded-discovery";
import { TEAM_SCOPE } from "../lib/team-auth";

const router = Router();
router.use("/v1/live", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Sign in to manage live discovery." }); return; }
  next();
});
const fail = (res: Response, status: number, error: string) => { res.status(status).json({ error }); };
router.get("/v1/live", async (req, res) => {
  res.json(await liveOperation(TEAM_SCOPE, publicState));
});
router.get("/v1/live/embedded-status", async (_req, res) => {
  res.json(await embeddedStatus());
});
router.post("/v1/live/embedded-jobs", async (req, res) => {
  const p = CreateEmbeddedJobBody.safeParse(req.body);
  if (!p.success || !p.data.authorized) { fail(res, 400, "Select an approved target and profile and confirm permission."); return; }
  const result = await startEmbedded(TEAM_SCOPE, p.data, req.user!.id);
  if (result.job) res.status(result.status).json(result.job);
  else fail(res, result.status, result.error!);
});
router.get("/v1/live/agent/:file", (req, res) => {
  if (!["agent.py", "README.md", "spectre-scanner.service"].includes(req.params.file)) { fail(res, 404, "File not found."); return; }
  // Build output is dist/index.mjs; the external worker sources stay outside dist.
  res.download(fileURLToPath(new URL(`../scanner-agent/${req.params.file}`, import.meta.url)));
});
router.post("/v1/live/agents", async (req, res) => {
  const parsed = RegisterScannerBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) { fail(res, 400, "Provide an agent name."); return; }
  const owner = TEAM_SCOPE;
  const id = randomUUID();
  const token = `spct_${Buffer.from(owner).toString("base64url")}.${id}.${randomBytes(32).toString("hex")}`;
  const result = await liveOperation(owner, s => {
    if (s.agents.filter(a => !a.revoked).length >= 5 || s.agents.length >= 100) return null;
    const agent: Agent = { id, name: parsed.data.name.trim(), createdAt: now(), revoked: false, tokenHash: hash(token) };
    s.agents.push(agent);
    audit(s, owner, `Registered scanner ${agent.name}. Credential issued once.`);
    return publicAgent(agent);
  });
  if (!result) { fail(res, 409, "Agent limit reached (five active agents)."); return; }
  res.set("Cache-Control", "no-store").status(201).json({ agent: result, token });
});
router.post("/v1/live/agents/:id/revoke", async (req, res) => {
  const result = await liveOperation(TEAM_SCOPE, s => {
    const a = s.agents.find(a => a.id === req.params.id);
    if (!a) return null;
    a.revoked = true;
    s.jobs.filter(j => j.agentId === a.id && active(j)).forEach(cancel);
    audit(s, req.user!.id, `Revoked scanner ${a.name}; active job cancellation requested.`);
    return publicAgent(a);
  });
  if (!result) { fail(res, 404, "Scanner not found."); return; }
  res.json(result);
});
router.post("/v1/live/targets", async (req, res) => {
  const p = ApprovePublicTargetBody.safeParse(req.body);
  if (!p.success || !p.data.authorized || !isPublicIPv4(p.data.ip) || !p.data.label.trim() || p.data.authorizationReference.trim().length < 5 ||
    !Number.isFinite(Date.parse(p.data.expiresAt)) || Date.parse(p.data.expiresAt) <= Date.now() || Date.parse(p.data.expiresAt) > Date.now() + 30 * 86400000) {
    fail(res, 400, "Use one public IPv4 address, confirm ownership or written permission, and set an authorization expiry within 30 days. Private, reserved, IPv6, DNS names and ranges are excluded."); return;
  }
  const result = await liveOperation(TEAM_SCOPE, s => {
    if (s.targets.length >= 100 || s.targets.filter(t => !t.revoked && Date.parse(t.expiresAt) > Date.now()).length >= 10 ||
      s.targets.some(t => !t.revoked && t.ip === p.data.ip && Date.parse(t.expiresAt) > Date.now())) return null;
    const { authorized: _confirmed, ...data } = p.data;
    const target = { ...data, id: randomUUID(), createdAt: now(), authorizedBy: req.user!.id, revoked: false };
    s.targets.push(target);
    audit(s, req.user!.id, `Authorized ${target.ip} until ${target.expiresAt}. Reference: ${target.authorizationReference}`);
    return target;
  });
  if (!result) { fail(res, 409, "Target already active or scope limit reached (ten active targets)."); return; }
  res.status(201).json(result);
});
router.delete("/v1/live/targets/:id", async (req, res) => {
  const result = await liveOperation(TEAM_SCOPE, s => {
    const target = s.targets.find(t => t.id === req.params.id);
    if (!target) return null;
    target.revoked = true;
    s.jobs.filter(j => j.targetId === target.id && active(j)).forEach(cancel);
    audit(s, req.user!.id, `Revoked scope ${target.ip}; active job cancellation requested.`);
    return target;
  });
  if (!result) { fail(res, 404, "Target not found."); return; }
  res.json(result);
});
router.post("/v1/live/jobs", async (req, res) => {
  const p = CreateLiveJobBody.safeParse(req.body);
  if (!p.success || !p.data.authorized) { fail(res, 400, "Select an authorized target, agent and fixed profile; confirm permission."); return; }
  const result = await liveOperation(TEAM_SCOPE, s => {
    const t = s.targets.find(t => t.id === p.data.targetId && !t.revoked && Date.parse(t.expiresAt) > Date.now());
    const a = s.agents.find(a => a.id === p.data.agentId && !a.revoked);
    if (!t || !isPublicIPv4(t.ip) || !a || !a.lastSeen || Date.now() - Date.parse(a.lastSeen) > 60000 || s.jobs.some(j => j.agentId === a.id && active(j))) return null;
    const job = { id: randomUUID(), targetId: t.id, agentId: a.id, ip: t.ip, profile: p.data.profile,
      ports: PROFILES[p.data.profile], status: "queued" as const, createdAt: now(), createdBy: req.user!.id, services: [] };
    s.jobs.unshift(job);
    // Never discard queued or running jobs while retaining a bounded history.
    s.jobs = [...s.jobs.filter(active), ...s.jobs.filter(j => !active(j)).slice(0, 50)];
    audit(s, req.user!.id, `Queued ${job.profile} TCP discovery of ${job.ip} on scanner ${a.name}.`);
    return job;
  });
  if (!result) { fail(res, 409, "Scope expired, scanner offline, or scanner already has an active job. Refresh and check the agent."); return; }
  res.status(201).json(result);
});
router.post("/v1/live/jobs/:id/cancel", async (req, res) => {
  const result = await liveOperation(TEAM_SCOPE, s => {
    const j = s.jobs.find(j => j.id === req.params.id);
    if (!j) return null;
    cancel(j);
    audit(s, req.user!.id, `Cancellation requested for ${j.id}.`);
    return publicJob(j);
  });
  if (!result) { fail(res, 404, "Job not found."); return; }
  res.json(result);
});
router.post("/v1/live/emergency-stop", async (req, res) => {
  res.json(await liveOperation(TEAM_SCOPE, s => {
    s.jobs.filter(active).forEach(cancel);
    audit(s, req.user!.id, "Stop All Live Scans requested.");
    return publicState(s);
  }));
});

// Agents have scoped credentials, never browser sessions. Tokens are hashed at rest.
async function agentOperation(req: Request, res: Response, fn: (s: LiveState, a: Agent) => unknown) {
  const token = req.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const match = /^spct_([A-Za-z0-9_-]{1,300})\.([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(token);
  if (!match) { fail(res, 401, "Invalid agent credential."); return; }
  const owner = Buffer.from(match[1]!, "base64url").toString();
  const result = await liveOperation(owner, s => {
    const a = s.agents.find(a => a.id === match[2] && !a.revoked);
    if (!a || !timingSafeEqual(Buffer.from(a.tokenHash, "hex"), Buffer.from(hash(token), "hex"))) return undefined;
    return fn(s, a);
  }, false);
  if (result === undefined) { fail(res, 401, "Agent credential revoked or invalid."); return; }
  if (result === null) { fail(res, 409, "Job lease is stale, terminal or invalid."); return; }
  res.set("Cache-Control", "no-store").json(result);
}
router.post("/v1/scanner/poll", async (req, res) => {
  const p = PollScannerBody.safeParse(req.body);
  if (!p.success) { fail(res, 400, "Invalid heartbeat."); return; }
  await agentOperation(req, res, (s, a) => {
    a.lastSeen = now(); a.version = p.data.version; a.nmapVersion = p.data.nmapVersion;
    if (p.data.jobId) {
      const j = s.jobs.find(j => j.id === p.data.jobId && j.agentId === a.id && j.leaseId === p.data.leaseId);
      if (!j || !active(j)) return { cancel: true };
      j.leaseUntil = Date.now() + 45000;
      return { cancel: j.status === "cancelling" };
    }
    // Do not lease another job if an existing process still owns this agent.
    if (s.jobs.some(j => j.agentId === a.id && ["running", "cancelling"].includes(j.status))) return { cancel: false };
    const j = s.jobs.find(j => j.agentId === a.id && j.status === "queued");
    if (!j) return { cancel: false };
    j.status = "running"; j.startedAt = now(); j.leaseId = randomUUID(); j.leaseUntil = Date.now() + 45000;
    j.agentVersion = a.version; j.nmapVersion = a.nmapVersion;
    audit(s, `agent:${a.id}`, `Started job ${j.id}.`);
    return { cancel: false, job: publicJob(j), leaseId: j.leaseId };
  });
});
router.post("/v1/scanner/result", async (req, res) => {
  const p = SubmitScannerResultBody.safeParse(req.body);
  if (!p.success) { fail(res, 400, "Invalid scan evidence."); return; }
  await agentOperation(req, res, (s, a) => {
    const j = s.jobs.find(j => j.id === p.data.jobId && j.agentId === a.id && j.leaseId === p.data.leaseId);
    if (!j || !["running", "cancelling"].includes(j.status)) return null;
    if (p.data.services.some(v => !j.ports.includes(v.port) || v.protocol==="udp") || new Set(p.data.services.map(v => v.port)).size !== p.data.services.length) return null;
    if (p.data.status === "completed" && (!p.data.rawXml.includes("<nmaprun") || !p.data.rawXml.includes("</nmaprun>"))) return null;
    j.status = j.status === "cancelling" ? "cancelled" : p.data.status;
    j.finishedAt = now(); j.services = p.data.services; j.hostStatus = p.data.hostStatus;
    j.rawXml = p.data.rawXml; j.evidenceSha256 = hash(p.data.rawXml); j.error = p.data.error;
    if (j.status === "cancelled") j.error = "Agent acknowledged termination. Evidence may be incomplete.";
    audit(s, `agent:${a.id}`, `Job ${j.id} ${j.status}; ${j.services.filter(p => p.state === "open").length} open TCP services reported. Not a vulnerability verdict.`);
    return publicJob(j);
  });
});
export default router;
