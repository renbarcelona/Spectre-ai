import { Router } from "express";
import { SaveExecutiveInsightsBody } from "@workspace/api-zod";
import { activity, workspaceOperation } from "../lib/assessment";
import { validateExecutiveInsights } from "../lib/executive-insights";

const router = Router();

router.put("/v1/executive-insights", async (req, res) => {
  const parsed = SaveExecutiveInsightsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid Executive Insights configuration.", details: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) });
    return;
  }
  const errors = validateExecutiveInsights(parsed.data);
  if (errors.length) {
    res.status(400).json({ error: errors.join(" "), details: errors });
    return;
  }
  const result = await workspaceOperation(res.locals.workspaceId, state => {
    const revision = state.executiveInsights?.revision ?? 0;
    if (parsed.data.revision !== revision) return null;
    state.executiveInsights = { ...parsed.data, revision: revision + 1, updatedAt: new Date().toISOString() };
    const manual = parsed.data.sections.filter(s => s.mode === "manual").map(s => s.key);
    activity(state, `Executive Insights presentation controls saved. Manual sections: ${manual.join(", ") || "none"}. Assessment records unchanged; editor identity is not authenticated.`);
    return state.executiveInsights;
  });
  if (!result) {
    res.status(409).json({ error: "Executive Insights settings changed since this editor was opened. Reload the saved configuration before applying your edits." });
    return;
  }
  res.json(result);
});

export default router;
