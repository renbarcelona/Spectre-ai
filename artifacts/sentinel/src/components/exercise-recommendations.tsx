import type { Exercise } from "@workspace/api-client-react";
import { ShieldCheck } from "lucide-react";
import { Panel, EmptyState } from "@/components/kit";

const guidance = {
  application: [
    { title: "Reduce Application Exposure", owner: "Application And Infrastructure Owners", action: "Inventory exposed services, remove unused listeners, patch supported application and remote-access components, and restrict administrative access to approved networks.", validation: "Review the service inventory, patch evidence and access rules; confirm approved access still works and unauthorized access is denied in an authorized test." },
    { title: "Strengthen Identity And Privileges", owner: "Identity And Application Teams", action: "Require phishing-resistant MFA for remote and privileged access, remove shared accounts, and limit application service-account permissions.", validation: "Review MFA enforcement, privileged-role assignments and authentication logs. Recheck denied access using an approved test account." },
    { title: "Validate Detection And Response", owner: "SOC And Incident Response", action: "Collect application, authentication and endpoint logs; define alerts for suspicious access and document containment and escalation procedures.", validation: "Use approved benign test events to verify ingestion, alert delivery, triage ownership and response timestamps. A scripted detection is not proof of monitoring coverage." },
  ],
  boundary: [
    { title: "Enforce IT-To-DMZ Segmentation", owner: "Network Security And OT Owners", action: "Review each permitted IT-to-DMZ flow. Apply default-deny rules with explicit source, destination, port and business justification; remove unused or overly broad rules through change control.", validation: "Review firewall configurations and flow logs. Validate permitted and denied paths only on authorized IT/DMZ test assets, never live OT control processes." },
    { title: "Harden The Administrative Boundary", owner: "Identity And Infrastructure Teams", action: "Route administration through hardened jump hosts with MFA, separate privileged accounts, least privilege and session logging. Prevent direct IT administration of sensitive DMZ services.", validation: "Review jump-host access policy, account separation and session records; verify unauthorized direct access is denied during an approved test window." },
    { title: "Monitor And Rehearse Boundary Incidents", owner: "SOC And OT Incident Response", action: "Centralize firewall, jump-host and identity logs. Assign owners for unusual cross-zone connections and rehearse isolation decisions with the OT owner before changing boundary controls.", validation: "Verify benign test events reach the SOC and rehearse escalation, containment approval and recovery without interrupting industrial operations." },
  ],
};

export function ExerciseRecommendations({ exercise }: { exercise?: Exercise }) {
  const completed = exercise?.steps.filter((s) => s.status.toLowerCase() === "completed") ?? [];
  const recommendations = exercise ? guidance[exercise.scenario as keyof typeof guidance] : undefined;
  return (
    <Panel kicker="Exercise Guidance" title="Key Recommendations"
      action={<ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />}>
      {!exercise ? <EmptyState title="Select An Exercise" body="Draft or choose a saved exercise to view its recommendations." /> : (
        <div className="space-y-4 text-xs leading-relaxed" data-testid="exercise-recommendations">
          <div>
            <p className="font-semibold text-foreground" data-testid="recommendations-exercise-title">{exercise.title}</p>
            <p className="mt-1 text-muted-foreground">
              {completed.length} of {exercise.steps.length} checkpoints reviewed · {exercise.assetIds.length} scoped assets.
              {" "}{completed.length === 0 ? "Preventive guidance; no checkpoint results yet." : "Guidance reflects the selected scenario and reviewed checkpoints."}
              {" "}These are rule-based tabletop recommendations, not verified vulnerabilities or measured control effectiveness.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-primary">Checkpoint-Specific Priorities</h3>
            {completed.length === 0 ? <p className="mt-1 text-muted-foreground">Review the preventive actions below, then advance the exercise to see guidance linked to its simulated outcomes.</p> : (
              <ul className="mt-2 space-y-3">
                {[...completed].sort((a, b) => Number(b.outcome?.toLowerCase().includes("success")) - Number(a.outcome?.toLowerCase().includes("success"))).map((step, i) => (
                  <li key={`${step.technique}-${i}`} className="border-l-2 border-primary/40 pl-3">
                    <p className="font-medium">{step.title} <span className="font-mono text-[10px] text-muted-foreground">· {step.technique}</span></p>
                    <p className="text-accent">Simulated Outcome: {step.outcome || "Not Recorded"}</p>
                    <p className="mt-1 text-foreground/85">{step.mitigation || "Review the modeled control with its owner and define a documented mitigation and validation plan."}</p>
                    <p className="mt-1 text-muted-foreground">{step.outcome?.toLowerCase().includes("success") ? "Prioritize validating and closing this modeled control gap." : "Validate the modeled block or detection with independent evidence before accepting the control as effective."}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="font-semibold text-primary">Consolidated Remediation Plan</h3>
            <ol className="mt-2 divide-y divide-border/60">
              {recommendations?.map((item, i) => (
                <li key={item.title} className="py-3 first:pt-0">
                  <h4 className="font-semibold">{i + 1}. {item.title}</h4>
                  <p className="mt-1 text-foreground/85">{item.action}</p>
                  <p className="mt-1 text-muted-foreground"><span className="text-foreground/80">Suggested Owner: </span>{item.owner}</p>
                  <p className="mt-1 text-muted-foreground"><span className="text-foreground/80">Validation: </span>{item.validation}</p>
                </li>
              ))}
              {!recommendations && <li className="py-2 text-muted-foreground">Use the checkpoint mitigations above and agree a scenario-specific plan with the exercise owner.</li>}
            </ol>
          </div>
          <p className="border-t border-border pt-3 text-muted-foreground">Agree accountable owners and due dates, obtain change approval, then retain configuration reviews and authorized retest evidence before closing actions. No remediation is applied automatically. Pending or cancelled checkpoints are not treated as findings.</p>
        </div>
      )}
    </Panel>
  );
}
