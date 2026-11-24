import { createContext, useContext, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useGetFeatureSettings, getGetFeatureSettingsQueryKey, type FeatureSettings } from "@workspace/api-client-react";
import { useTeamAuth } from "./team-auth";
import type { UseQueryResult } from "@tanstack/react-query";

export const MODULES = [
  { key: "executiveInsights", path: "/", label: "Executive Insights" },
  { key: "scans", path: "/scans", label: "Scans" },
  { key: "redTeam", path: "/simulations", label: "Red Team" },
  { key: "vulnerabilities", path: "/vulnerabilities", label: "Vulnerabilities" },
  { key: "reports", path: "/reports", label: "Reports" },
  { key: "investigator", path: "/investigator", label: "AI Investigator" },
] as const;
export const moduleForPath = (path: string) => MODULES.find(m => m.path === "/" ? path === "/" : path === m.path || path.startsWith(m.path + "/"));
const Context = createContext<UseQueryResult<FeatureSettings> | null>(null);
export function FeatureProvider({ children }: { children: ReactNode }) {
  const { user } = useTeamAuth();
  const q = useGetFeatureSettings({ query: { queryKey: [...getGetFeatureSettingsQueryKey(), user?.id], refetchInterval: 5000, refetchOnWindowFocus: "always" } });
  return <Context.Provider value={q}>{children}</Context.Provider>;
}
export function useFeatures() {
  const q = useContext(Context);
  if (!q) throw new Error("FeatureProvider is required");
  return q;
}
export function FeatureGuard({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const q = useFeatures();
  const { isAdmin } = useTeamAuth();
  const module = moduleForPath(path);
  if (!module) return <>{children}</>;
  if (q.isLoading || q.isError || !q.data) return <div role="status" className="m-5 rounded border border-border p-6 text-muted-foreground">
    {q.isError ? <>Unable To Check Module Availability. <button className="underline" onClick={()=>q.refetch()}>Retry</button></> : "Checking Module Availability…"}
    <Link href="/settings?section=features" className="ml-3 underline">Settings</Link>
  </div>;
  if (!q.data[module.key as keyof FeatureSettings]) return <section className="m-5 rounded border border-border bg-muted/20 p-8 text-muted-foreground" data-testid="module-disabled">
    <h1 className="text-xl font-semibold">{module.label} Is Disabled</h1>
    <p className="mt-3 text-sm">An administrator has disabled this module for the shared workspace. Saved data is retained.</p>
    {isAdmin && <Link href="/settings?section=features" className="mt-4 inline-block underline">Open Feature Management</Link>}
  </section>;
  return <>{children}</>;
}
