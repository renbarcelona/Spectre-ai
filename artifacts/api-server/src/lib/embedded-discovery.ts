import { execFile, spawn } from "node:child_process";
import { customPorts } from "./embedded-ports";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { GetLiveDiscoveryResponse } from "@workspace/api-zod";
import { logger } from "./logger";
import { active, audit, hash, isPublicIPv4, liveOperation, now, PROFILES, publicJob, type Job } from "./live-discovery";

const execute = promisify(execFile);
const script = fileURLToPath(new URL("../embedded-scanner/scan.py", import.meta.url));
// The Python child receives no database credentials, session secret or AI keys.
const environment = { PATH: process.env.PATH, LANG: "C.UTF-8" };
let runtime: { available: boolean; engine: string; message: string } | undefined;
export async function embeddedStatus() {
  if (runtime?.available) return runtime;
  try {
    const { stdout } = await execute("python3", ["-I", "-c", "import socket,ssl,ipaddress,json,sys; print('Python '+sys.version.split()[0]+' / socket+ssl')"], {
      timeout: 5000, maxBuffer: 4096, env: environment,
    });
    runtime = { available: true, engine: stdout.trim(), message: "Local runtime ready. No external scanner or API required. Target reachability has not been tested." };
  } catch {
    runtime = { available: false, engine: "Python socket+ssl", message: "Embedded runtime unavailable. Python 3 with socket and SSL support must be available to the API process." };
  }
  return runtime;
}

// Session advisory locks enforce a two-job cap across API replicas.
async function reserveSlot() {
  const client = await pool.connect();
  for (const id of [870101, 870102]) {
    const r = await client.query("SELECT pg_try_advisory_lock($1) AS held", [id]);
    if (r.rows[0].held) {
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try { await client.query("SELECT pg_advisory_unlock($1)", [id]); client.release(); }
        catch { client.release(true); }
      };
    }
  }
  client.release();
  return undefined;
}

export async function startEmbedded(owner: string, input: { targetId: string; profile: "web" | "standard" | "custom"; tcpPorts?: string; udpPorts?: string }, actor = owner) {
  let tcpPorts: number[], udpPorts: number[];
  try {
    if(input.profile==="custom") ({tcpPorts,udpPorts}=customPorts(input.tcpPorts,input.udpPorts));
    else {
      if(!["web","standard"].includes(input.profile) || input.tcpPorts!==undefined || input.udpPorts!==undefined) throw new Error("Custom port lists require the Custom profile.");
      tcpPorts=[...PROFILES[input.profile]]; udpPorts=[];
    }
  }catch(e){return {status:400,error:(e as Error).message};}
  if (!(await embeddedStatus()).available) return { status: 503, error: "Python runtime unavailable; no scan started." };
  const release = await reserveSlot();
  if (!release) return { status: 429, error: "Two embedded checks are already running. Try again after one finishes." };
  try {
    const job = await liveOperation(owner, s => {
      const target = s.targets.find(t => t.id === input.targetId && !t.revoked && Date.parse(t.expiresAt) > Date.now());
      if (!target || !isPublicIPv4(target.ip)) return null;
      if (s.jobs.some(j => j.engine === "embedded" && (active(j) || Date.now() - Date.parse(j.createdAt) < 60_000))) return null;
      const j: Job = {
        id: randomUUID(), targetId: target.id, agentId: "embedded", engine: "embedded",
        ip: target.ip, profile: input.profile, ports: [...new Set([...tcpPorts,...udpPorts])], tcpPorts, udpPorts,
        status: "running", createdAt: now(), startedAt: now(), createdBy: actor,
        services: [], leaseId: randomUUID(), leaseUntil: Date.now() + 90_000,
        agentVersion: runtime!.engine,
      };
      s.jobs.unshift(j);
      s.jobs = [...s.jobs.filter(active), ...s.jobs.filter(j => !active(j)).slice(0, 50)];
      audit(s, actor, `Started embedded ${j.profile} checks of ${j.ip}: ${tcpPorts.length} TCP and ${udpPorts.length} UDP; no external scanner.`);
      return j;
    });
    if (!job) {
      await release();
      return { status: 409, error: "Scope missing/expired, a check is active, or the one-minute per-owner cooldown has not elapsed." };
    }
    void run(owner, job, release).catch(err => logger.error({ err }, "Embedded job persistence failed"));
    return { status: 201, job: publicJob(job) };
  } catch (err) { await release(); throw err; }
}

async function run(owner: string, job: Job, release: () => Promise<void>) {
  let child: ReturnType<typeof spawn> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let interrupted = "";
  let checking = false;
  let output = "";
  let stderr = "";
  let exitCode: number | null = null;
  let cancelled = false;
  const stop = (reason: string) => {
    if (interrupted) return;
    interrupted = reason;
    child?.kill("SIGTERM");
    killTimer = setTimeout(() => child?.kill("SIGKILL"), 1000);
  };
  try {
    child = spawn("python3", ["-I", script], { env: environment, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin?.on("error", () => stop("Embedded runtime input channel failed."));
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output) > 65536) stop("Embedded output exceeded the evidence size limit.");
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(0, 2000); });
    deadline = setTimeout(() => stop("Embedded execution exceeded the 75-second deadline."), 75_000);
    timer = setInterval(async () => {
      if (checking || interrupted) return;
      checking = true;
      try {
        const status = await liveOperation(owner, s => {
          const j = s.jobs.find(j => j.id === job.id);
          return j?.status;
        }, false);
        if (status !== "running") {
          cancelled = status === "cancelling" || status === "cancelled";
          stop(cancelled ? "Cancellation acknowledged; local process terminated." : "Job authorization or execution lease was lost.");
        }
      } catch { stop("Database connection lost; embedded execution stopped."); }
      finally { checking = false; }
    }, 500);
    const finished = new Promise<number | null>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("close", resolve);
    });
    child.stdin?.write(JSON.stringify({ ip: job.ip, profile: job.profile,
      ...(job.profile==="custom"?{tcpPorts:job.tcpPorts,udpPorts:job.udpPorts}:{}) }) + "\n");
    exitCode = await finished;
  } catch {
    interrupted ||= "Embedded Python process could not start or communicate.";
  } finally {
    if (timer) clearInterval(timer);
    if (deadline) clearTimeout(deadline);
    if (killTimer) clearTimeout(killTimer);
    child?.stdin?.destroy();
    try {
      await liveOperation(owner, s => {
        const j = s.jobs.find(j => j.id === job.id && j.leaseId === job.leaseId);
        if (!j || !active(j)) return;
        j.finishedAt = now();
        if (j.status === "cancelling" || cancelled) {
          j.status = "cancelled"; j.error = "Cancellation acknowledged; local execution stopped.";
        } else if (interrupted || exitCode !== 0) {
          j.status = "failed"; j.error = interrupted || (stderr.trim() ? "Python reported an execution or validation failure." : "Embedded check exited without a result.");
        } else {
          try {
            const result = JSON.parse(output);
            if (result.ip !== j.ip || result.profile !== j.profile || typeof result.version !== "string" || result.version.length > 100) throw new Error("Invalid worker identity");
            const services = GetLiveDiscoveryResponse.shape.jobs.element.shape.services.parse(result.services);
            const expected=new Set([...(j.tcpPorts??j.ports).map(p=>`tcp:${p}`),...(j.udpPorts??[]).map(p=>`udp:${p}`)]);
            if (services.length !== expected.size || new Set(services.map(p => `${p.protocol??"tcp"}:${p.port}`)).size !== expected.size ||
              services.some(p => !expected.has(`${p.protocol??"tcp"}:${p.port}`) ||
                !(p.protocol==="udp"?["open","closed","open|filtered","error"]:["open","closed","timeout","error"]).includes(p.state))) throw new Error("Incomplete result");
            j.services = services; j.agentVersion = result.version;
            j.rawEvidence = JSON.stringify(result, null, 2); j.evidenceSha256 = hash(j.rawEvidence);
            j.hostStatus = services.some(p => p.state === "open") ? "TCP connection or UDP reply observed" : "No accepted TCP connection or UDP reply observed";
            j.status = services.every(p => p.state === "error") ? "failed" : "completed";
            if (j.status === "failed") j.error = "Every probe returned a network or local error; inspect evidence. No successful assessment asserted.";
          } catch {
            j.status = "failed"; j.error = "Embedded result was invalid or incomplete.";
          }
        }
        audit(s, "embedded-runtime", `Job ${j.id} ${j.status}; observations are not vulnerability verdicts.`);
      }, false);
    } finally { await release(); }
  }
}
