import type { RequestHandler } from "express";
import { workspaceOperation, type Workspace } from "./assessment";
import { TEAM_SCOPE } from "./team-auth";

export const DEFAULT_FEATURES = {
  executiveInsights: true, scans: true, redTeam: true,
  vulnerabilities: true, reports: true, investigator: true,
};
export type Features = NonNullable<Workspace["features"]>;
export const featureSettings = (state: Workspace): Features => ({ ...DEFAULT_FEATURES, ...state.features });

/** Shared evidence remains available to other enabled modules. This is not RBAC. */
export function blockedFeature(path: string, method: string, f: Features): keyof Features | undefined {
  if (path.endsWith("/emergency-stop") || /\/jobs\/[^/]+\/cancel$/.test(path) || path === "/v1/scanner/result") return;
  if (path === "/v1/live" && method === "GET") return !f.scans && !f.reports && !f.investigator ? "scans" : undefined;
  const key = path === "/v1/investigator" ? "investigator"
    : path.startsWith("/v1/exercises") ? "redTeam"
    : path.startsWith("/v1/remediations") ? "vulnerabilities"
    : path === "/v1/scans" || path.startsWith("/v1/live/") || path.startsWith("/v1/scanner/") ? "scans"
    : undefined;
  return key && !f[key] ? key : undefined;
}

export const featureGate: RequestHandler = async (req, res, next) => {
  if (!/^\/v1\/(?:scans|live|scanner|exercises|remediations|investigator)(?:\/|$)/.test(req.path)) { next(); return; }
  const flags = await workspaceOperation(TEAM_SCOPE, featureSettings);
  const blocked = blockedFeature(req.path, req.method, flags);
  if (blocked) { res.status(403).json({ error: "This module has been disabled by an administrator.", feature: blocked }); return; }
  next();
};
