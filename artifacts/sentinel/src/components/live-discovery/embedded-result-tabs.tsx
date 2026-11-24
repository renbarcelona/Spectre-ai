import { useId, useState } from "react";
import { useInvestigate } from "@workspace/api-client-react";
import type { LiveJob } from "@workspace/api-client-react";
import { RotateCw, Sparkles, Network, ShieldCheck, Route } from "lucide-react";
import { Skel } from "@/components/kit";
import { cn } from "@/lib/utils";
import { protoOf } from "@/lib/live-exposure";

type Tab = "ports" | "analysis" | "paths" | "hops";
const TABS: [Tab, string][] = [["ports", "Ports"], ["analysis", "AI Analysis"], ["paths", "MITRE Attack Paths"], ["hops", "Hops"]];
const TAB_INFO = {
  ports: { icon: Network, description: "Services & Connection States" },
  analysis: { icon: Sparkles, description: "Generate Evidence-Based Insights" },
  paths: { icon: ShieldCheck, description: "Review Conditional ATT&CK Mappings" },
  hops: { icon: Route, description: "Route Visibility & Limitations" },
};

export function EmbeddedResultTabs({ j }: { j: LiveJob }) {
  const [tab, setTab] = useState<Tab>("ports");
  const id = useId();
  return (
    <div className="mt-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-1">
        <h3 className="text-sm font-semibold">Explore Key Results</h3>
        <p className="text-[11px] text-muted-foreground">Select A View Below</p>
      </div>
      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 2xl:grid-cols-4" role="tablist" aria-label="Key Results Views">
        {TABS.map(([t, label], index) => {
          const Icon = TAB_INFO[t].icon;
          const selected = tab === t;
          return <button key={t} id={`${id}-${t}`} role="tab" aria-selected={selected} aria-controls={`${id}-panel`} tabIndex={selected ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
              else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = TABS.length - 1;
              else return;
              event.preventDefault();
              setTab(TABS[next][0]);
              document.getElementById(`${id}-${TABS[next][0]}`)?.focus();
            }}
            data-testid={`tab-embedded-${t}`}
            className={cn("relative min-w-0 rounded-lg border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              selected ? "border-primary bg-primary/15 shadow-[0_0_18px_hsl(var(--primary)/0.12)]" : "border-border bg-background/60 hover:border-primary/60 hover:bg-primary/5")}>
            <span className="flex items-center gap-2">
              <Icon aria-hidden="true" className={cn("h-5 w-5 shrink-0", selected ? "text-primary" : "text-accent")} />
              <span className="text-sm font-semibold leading-snug text-foreground">{label}</span>
              {selected && <span aria-hidden="true" className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary" />}
            </span>
            <span className="mt-2 block text-[11px] leading-relaxed text-muted-foreground">{TAB_INFO[t].description}</span>
          </button>;
        })}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0} className="pt-4 focus-visible:outline-primary">
        {tab === "ports" && <PortsTab j={j} />}
        {tab === "analysis" && <AnalysisTab key={j.id} j={j} />}
        {tab === "paths" && <PathsTab j={j} />}
        {tab === "hops" && <HopsTab j={j} />}
      </div>
    </div>
  );
}

function PortsTab({ j }: { j: LiveJob }) {
  if (!j.services.length) return <p className="text-[11px] text-muted-foreground">No port observations recorded yet for this check.</p>;
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full min-w-[720px] text-left font-mono text-xs" data-testid="table-embedded-ports">
        <thead className="text-[10px] uppercase text-muted-foreground"><tr className="border-b border-border/60"><th className="py-1.5">Host (IP)</th><th>Hostname</th><th>Port</th><th>State</th><th>Service</th><th>Protocol</th><th>Reason</th><th>Detail</th><th className="text-right">Elapsed</th></tr></thead>
        <tbody>{j.services.map((s) => (
          <tr key={`${protoOf(s)}-${s.port}`} className="border-b border-border/30 align-top" data-testid={`row-live-service-${protoOf(s)}-${s.port}`}>
            <td className="py-1">{j.ip}</td><td className="text-muted-foreground">Not Resolved</td><td>{s.port}</td>
            <td className={s.state === "open" ? "text-primary" : s.state === "closed" ? "text-muted-foreground" : "text-accent"}>{s.state}{s.state === "open|filtered" ? " (uncertain)" : !["open", "closed"].includes(s.state) ? " (inconclusive)" : ""}</td>
            <td>{s.service}{s.product ? <span className="text-muted-foreground"> {[s.product, s.version].filter(Boolean).join(" ")}</span> : null}</td><td>{protoOf(s).toUpperCase()}</td>
            <td className="text-muted-foreground">{s.reason ?? "--"}</td><td className="max-w-[220px] break-words text-[10px] text-muted-foreground">{s.detail ?? "--"}</td>
            <td className="text-right text-muted-foreground">{s.elapsedMs != null ? `${s.elapsedMs}ms` : "--"}</td>
          </tr>))}</tbody>
      </table>
      <p className="mt-2 text-[10px] text-muted-foreground">Hostname is not resolved: embedded checks perform no DNS lookups. Service is recorded evidence (TLS when negotiated, otherwise Unidentified), not software fingerprinting. UDP checks send one empty datagram with no application payload: a response is open, no response is open|filtered (uncertain), a refusal is closed. UDP rows never identify a protocol or service. Elapsed includes the attempt and any TLS negotiation, not route latency.</p>
    </div>
  );
}

function AnalysisTab({ j }: { j: LiveJob }) {
  const inv = useInvestigate();
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = () => {
    setErr(null);
    inv.mutate({ data: { source: "embedded", jobId: j.id, message: "Provide a concise executive and technical analysis of this embedded check: observed exposure, review priorities, and evidence limitations. Each observation carries its protocol; describe UDP observations as UDP, never as TCP, and do not infer a service from a UDP port number. Do not claim confirmed vulnerabilities." } }, {
      onSuccess: (r) => setOut(r.message),
      onError: (e) => setErr((e as { data?: { error?: string } }).data?.error ?? "Analysis could not be generated. Please retry."),
    });
  };
  return (
    <div className="space-y-3 text-xs" data-testid="panel-embedded-analysis">
      <p className="rounded border border-accent/30 bg-accent/5 p-2.5 text-[11px] leading-relaxed text-muted-foreground">Generating sends this selected check's recorded evidence (IP, protocols, ports, states, details) to the AI service. Output is model-generated interpretation, not verified findings. Nothing is sent until you click Generate.</p>
      <button onClick={run} disabled={inv.isPending} data-testid="button-generate-analysis" className="inline-flex items-center gap-1.5 rounded border border-primary bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-40"><Sparkles className="h-3.5 w-3.5" />{inv.isPending ? "Generating" : out ? "Regenerate Analysis" : "Generate Analysis"}</button>
      {inv.isPending && <div className="space-y-2"><Skel className="h-3 w-3/4" /><Skel className="h-3 w-full" /><Skel className="h-3 w-2/3" /></div>}
      {err && !inv.isPending && <div className="rounded border border-destructive/40 bg-destructive/10 p-2.5 text-destructive" data-testid="text-analysis-error">{err} <button onClick={run} className="ml-2 inline-flex items-center gap-1 underline" data-testid="button-retry-analysis"><RotateCw className="h-3 w-3" />Retry</button></div>}
      {out && !inv.isPending && <div className="whitespace-pre-wrap rounded border border-border bg-background/50 p-3 text-[13px] leading-relaxed" data-testid="text-analysis-output"><div className="mb-1 break-all font-mono text-[10px] uppercase tracking-wider text-primary">SPECTRE AI · Embedded Check {j.id}</div>{out}</div>}
    </div>
  );
}

const REMOTE = [22, 3389, 5900, 445], WEB = [80, 443, 8000, 8080, 8443];
function PathsTab({ j }: { j: LiveJob }) {
  // Hypotheses derive from TCP observations only; a UDP port number never implies a service.
  const open = j.services.filter((s) => protoOf(s) === "tcp" && s.state === "open").map((s) => s.port);
  const udpOpen = j.services.filter((s) => protoOf(s) === "udp" && s.state === "open").length;
  const remote = open.filter((p) => REMOTE.includes(p)), web = open.filter((p) => WEB.includes(p));
  const hyps = [
    remote.length && { id: "T1021", name: "Remote Services", ports: remote, text: "Conditional remote-service exposure. If the listener is confirmed to be a remote administration or file-sharing service and valid credentials were obtained by an adversary, this technique could apply. No credential, authentication weakness or access was tested.", validate: "Confirm the actual service, check whether it must be public, verify MFA/key-based auth and source allowlists, review authentication logs." },
    web.length && { id: "T1190", name: "Exploit Public-Facing Application", ports: web, text: "Potential only if a vulnerability in the application on this port is separately confirmed. An open web port alone does not establish exploitability.", validate: "Identify the application and exact version, check vendor advisories/NVD, and run an authorized, vulnerability-specific test." },
  ].filter(Boolean) as { id: string; name: string; ports: number[]; text: string; validate: string }[];
  return (
    <div className="space-y-3 text-xs leading-relaxed" data-testid="panel-embedded-mitre">
      <p className="rounded border border-accent/30 bg-accent/5 p-2.5 text-[11px]"><strong className="text-accent">Unverified Hypotheses · No Attack Paths Established. </strong><span className="text-muted-foreground">TCP connect results cannot confirm vulnerabilities, credentials, privileges or reachability beyond this host, so no attack path is asserted. The items below are conditional ATT&amp;CK references for validation planning only.</span></p>
      {hyps.length === 0 ? <p className="text-muted-foreground">No open TCP port in this check maps to a conditional technique reference. That does not mean the host is secure.</p> : hyps.map((h) => (
        <div key={h.id} className="rounded border border-border/60 p-3" data-testid={`card-mitre-${h.id}`}>
          <div className="flex flex-wrap items-center gap-2"><a href={`https://attack.mitre.org/techniques/${h.id}/`} target="_blank" rel="noreferrer" className="font-mono text-primary underline">{h.id}</a><span className="font-semibold">{h.name}</span><span className="rounded-sm border border-accent/40 px-1.5 font-mono text-[9px] uppercase text-accent">Hypothesis · Unverified</span></div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">Open TCP {h.ports.join(", ")} on {j.ip}</p>
          <p className="mt-1.5">{h.text}</p>
          <p className="mt-1.5 text-muted-foreground"><strong className="text-foreground">Validation steps: </strong>{h.validate}</p>
        </div>
      ))}
      {udpOpen > 0 && <p className="text-[11px] text-muted-foreground" data-testid="text-mitre-udp-note">{udpOpen} responding UDP port(s) were observed. No technique is mapped from UDP results because the responding service was not identified.</p>}
    </div>
  );
}

function HopsTab({ j }: { j: LiveJob }) {
  return (
    <div className="space-y-3 text-xs" data-testid="panel-embedded-hops">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
        <span className="rounded-sm border border-accent/50 px-2 py-1 text-accent">Origin · Backend Vantage</span>
        <span className="text-muted-foreground">- - - intermediate route unknown - - -&gt;</span>
        <span className="rounded-sm border border-primary/50 px-2 py-1 text-primary">Target · {j.ip}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">No traceroute or hop data was collected by this check, so intermediate routers, hop count and route latency are unknown. Per-port Elapsed values include TCP or UDP attempts and any TLS negotiation and must not be read as route or hop latency.</p>
    </div>
  );
}
