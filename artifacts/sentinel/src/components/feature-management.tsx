import { useQueryClient } from "@tanstack/react-query";
import { getGetFeatureSettingsQueryKey, getGetWorkspaceQueryKey, useUpdateFeatureSetting } from "@workspace/api-client-react";
import { Panel } from "./kit";
import { Switch } from "./ui/switch";
import { MODULES, useFeatures } from "@/lib/features";
import { errorMessage, useTeamAuth } from "@/lib/team-auth";
import { useToast } from "@/hooks/use-toast";

export function FeatureManagement() {
  const q = useFeatures();
  const { isAdmin } = useTeamAuth();
  const save = useUpdateFeatureSetting();
  const qc = useQueryClient();
  const { toast } = useToast();
  return <Panel kicker="Workspace Controls" title="Feature Management">
    <p className="mb-4 text-sm text-muted-foreground">Enable or disable modules for everyone in this workspace. Disabled modules remain visible in navigation, but cannot be opened. Saved records are not deleted.</p>
    <p className="mb-4 text-xs text-muted-foreground">Disabling blocks new module actions; work already submitted may finish. Use Emergency Stop before disabling Scans or Red Team if running work must stop. Settings and emergency-stop controls remain available. Existing evidence can still be used by other enabled modules.</p>
    {!isAdmin && <p className="mb-4 text-xs text-muted-foreground">Only administrators can change feature availability.</p>}
    {q.isError ? <div role="alert">Unable To Load Feature Settings. <button onClick={()=>q.refetch()} className="underline">Retry</button></div> : !q.data ? <p>Loading Feature Settings…</p> :
      <div className="divide-y divide-border">{MODULES.map(m => {
        const enabled = q.data![m.key];
        return <div key={m.key} className={`flex items-center justify-between gap-4 py-4 ${enabled ? "" : "text-muted-foreground"}`}>
          <div><label htmlFor={`feature-${m.key}`} className="text-sm font-semibold">{m.label}</label>
            <p className="mt-1 text-xs text-muted-foreground">{enabled ? "Enabled · Available To Authorized Users" : "Disabled · Visible But Unavailable"}</p></div>
          <Switch id={`feature-${m.key}`} aria-label={`Enable ${m.label}`} checked={enabled} disabled={!isAdmin || save.isPending || q.isError}
            onCheckedChange={checked=>save.mutate({data:{feature:m.key,enabled:checked}},{
              onSuccess: data => {
                qc.setQueriesData({queryKey:getGetFeatureSettingsQueryKey()},data);
                qc.invalidateQueries({queryKey:getGetFeatureSettingsQueryKey()});
                qc.invalidateQueries({queryKey:getGetWorkspaceQueryKey()});
                toast({title:`${m.label} ${checked ? "Enabled" : "Disabled"}`});
              },
              onError: error=>toast({title:"Feature Update Failed",description:errorMessage(error),variant:"destructive"}),
            })} />
        </div>;
      })}</div>}
    <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">{save.isPending ? "Saving Feature Availability…" : "Changes Save Automatically And Apply To Other Sessions Within A Few Seconds."}</p>
  </Panel>;
}
