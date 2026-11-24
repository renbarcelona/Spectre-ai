import { Router } from "express";
import { randomUUID } from "node:crypto";
import { CreateExerciseBody, ActOnExerciseBody } from "@workspace/api-zod";
import { activity, workspaceOperation, type Workspace } from "../lib/assessment";

type Exercise = NonNullable<Workspace["exercises"]>[number];
const router = Router();
router.get("/v1/exercises", async (_req, res) => {
  res.json(await workspaceOperation(res.locals.workspaceId, s => s.exercises ?? []));
});
router.post("/v1/exercises", async (req, res) => {
  const parsed = CreateExerciseBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.authorized) {
    res.status(400).json({ error: "Choose a scenario and authorized demo assets, and acknowledge the demo scope." }); return;
  }
  const input = parsed.data;
  const result = await workspaceOperation(res.locals.workspaceId, s => {
    const ids = [...new Set(input.assetIds)];
    const assets = s.assets.filter(a => ids.includes(a.id));
    if (assets.length !== ids.length || assets.some(a => !["Enterprise IT", "Industrial DMZ"].includes(a.zone))) return { error: "Only existing IT/DMZ demo assets may be selected." };
    if (input.scenario === "boundary" && !["Enterprise IT", "Industrial DMZ"].every(zone => assets.some(a => a.zone === zone))) return { error: "Boundary exercises require both an Enterprise IT asset and an Industrial DMZ asset." };
    if ((s.exercises?.length ?? 0) >= 100) return { error: "This demo workspace has reached its 100 exercise limit." };
    const boundary = input.scenario === "boundary";
    const reference = s.vulnerabilities.filter(v => ids.includes(v.assetId)).map(v => `${v.id}: ${v.title} (${v.cve})`).join("; ");
    const definitions = boundary ? [
      ["Boundary discovery", "T1046", "simulated success", "Review segmentation and restrict cross-zone discovery."],
      ["Cross-zone remote service access", "T1021", "simulated blocked", "Restrict remote administration to authorized jump hosts."],
      ["Alternate account access branch", "T1078", "simulated detected", "Require MFA and review authentication monitoring."],
    ] : [
      ["Application exposure review", "T1190", "simulated success", "Verify affected versions and stage vendor updates."],
      ["Post-access discovery hypothesis", "T1046", "simulated detected", "Review server egress policy and discovery alerts."],
      ["Remote access boundary hypothesis", "T1021", "simulated blocked", "Restrict remote administration and enforce MFA."],
    ];
    const exercise: Exercise = {
      id: randomUUID(), scenario: input.scenario,
      title: boundary ? "IT-to-DMZ boundary exercise" : "Application exposure exercise",
      objective: boundary ? "Rehearse boundary-control validation without touching live OT." : "Rehearse assessment of application exposure and hypothetical follow-on controls.",
      assetIds: ids, status: "draft", createdAt: new Date().toISOString(), approvedAt: "",
      detection: "Not assessed — no monitoring telemetry connected.",
      steps: definitions.map(([title, technique, outcome, mitigation]) => ({
        title: title!, technique: technique!, status: "pending", outcome: outcome!,
        evidence: `Scripted demonstration outcome, not execution evidence. Each checkpoint is an independent tabletop branch; a blocked step does not prove later access. Selected demo references: ${reference || "No matching findings; this is an assumption-only exercise."}`,
        mitigation: mitigation!, timestamp: "",
      })),
    };
    (s.exercises ??= []).unshift(exercise);
    activity(s, `Demo exercise created awaiting acknowledgement: ${exercise.title}`);
    return { exercise };
  });
  if ("error" in result) { res.status(400).json(result); return; }
  res.status(201).json(result.exercise);
});
router.post("/v1/exercises/:id/action", async (req, res) => {
  const parsed = ActOnExerciseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid exercise action." }); return; }
  const result = await workspaceOperation(res.locals.workspaceId, s => {
    const exercise = s.exercises?.find(e => e.id === req.params.id);
    if (!exercise) return { code: 404, error: "Exercise not found." };
    const action = parsed.data.action;
    const now = new Date().toISOString();
    if (action === "approve") {
      if (exercise.status !== "draft") return { code: 409, error: "Only draft exercises may be approved." };
      exercise.status = "running"; exercise.approvedAt = now;
    } else if (action === "advance") {
      if (exercise.status !== "running") return { code: 409, error: "Approve the exercise before advancing. Stopped exercises cannot resume." };
      const step = exercise.steps.find(s => s.status === "pending");
      if (!step) return { code: 409, error: "No pending checkpoint." };
      step.status = "completed"; step.timestamp = now;
      if (exercise.steps.every(s => s.status === "completed")) exercise.status = "completed";
    } else {
      if (!["draft", "running"].includes(exercise.status)) return { code: 409, error: "Exercise is already terminal." };
      exercise.status = "stopped";
      exercise.steps.filter(s => s.status === "pending").forEach(s => { s.status = "cancelled"; s.timestamp = now; });
    }
    activity(s, `Demo exercise ${action}: ${exercise.title}. No operations executed.`);
    return { exercise };
  });
  if (result.error) { res.status(result.code ?? 400).json({ error: result.error }); return; }
  res.json(result.exercise);
});
export default router;
