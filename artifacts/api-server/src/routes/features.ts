import { Router } from "express";
import { UpdateFeatureSettingBody } from "@workspace/api-zod";
import { activity, workspaceOperation } from "../lib/assessment";
import { featureSettings } from "../lib/features";
import { TEAM_SCOPE } from "../lib/team-auth";

const router = Router();
router.get("/v1/features", async (_req, res) => {
  res.json(await workspaceOperation(TEAM_SCOPE, featureSettings));
});
router.patch("/v1/features", async (req, res) => {
  if (req.teamAccount?.role !== "admin") { res.status(403).json({ error: "Only administrators may manage features." }); return; }
  const input = UpdateFeatureSettingBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Choose a valid module and enabled state." }); return; }
  const { feature, enabled } = input.data;
  res.json(await workspaceOperation(TEAM_SCOPE, state => {
    const flags = featureSettings(state);
    if (flags[feature] !== enabled) {
      flags[feature] = enabled;
      state.features = flags;
      activity(state, `Feature ${feature} ${enabled ? "enabled" : "disabled"} by ${req.teamAccount!.username}.`);
    }
    return flags;
  }));
});
export default router;
