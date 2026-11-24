import { useEffect, useRef, useState } from "react";
import { useInvestigate, useGetLiveDiscovery, useGetGateway, type LiveJob } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/azure-auth";
import { Send, Sparkles, RotateCw } from "lucide-react";
import { PageHead } from "@/components/shell";
import { cn } from "@/lib/utils";
import { useCanWrite } from "@/lib/team-auth";

type Msg = { role: "user" | "ai" | "error"; text: string; retry?: string };
const PROMPTS = ["Which assets should we patch first and why?", "Summarise our RA 10173 data privacy exposure.", "Explain the KEV-listed findings for an executive.", "What lateral movement paths exist from the DMZ?"];
const LIVE_PROMPTS = ["Summarize this check and its evidence limitations.", "What should we remediate first and how do we verify it?", "Explain the TLS observations without assuming a vulnerability.", "What evidence is missing before we can identify applicable CVEs?"];

export default function Investigator() {
  const { user, isAuthenticated, isLoading, login } = useAuth();
  const [source, setSource] = useState<"demo" | "embedded">("demo");
  const [jobId, setJobId] = useState("");
  const [connectorId, setConnectorId] = useState(() => new URLSearchParams(window.location.search).get("connector") ?? "");
  const gateway = useGetGateway({query:{queryKey:["investigator-gateway",user?.id ?? "anon"],enabled:isAuthenticated && !isLoading,refetchInterval:15000}});
  const aiConnectors=(gateway.data?.connectors ?? []).filter(c=>c.kind==="ai" && c.enabled && c.testOk && c.credentialReady);
  const selectedConnector=aiConnectors.find(c=>c.id===connectorId);
  const live = useGetLiveDiscovery({query: {
    queryKey: ["investigator-live", user?.id ?? "anon"],
    enabled: source === "embedded" && isAuthenticated && !isLoading,
    refetchInterval: 5000,
  }});
  const jobs = [...(live.data?.jobs ?? [])].filter(j => j.engine === "embedded").sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const selected = jobs.find(j => j.id === jobId) ?? jobs[0];
  const ro = !useCanWrite();
  const blocked = ro || (source === "embedded" && (!isAuthenticated || isLoading || live.isLoading || live.isError || !selected)) || (!!connectorId && (!isAuthenticated || gateway.isError || !selectedConnector));
  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col">
      <PageHead kicker="Conversational Analysis" title="AI Investigator" sub={`Generative AI · ${connectorId ? selectedConnector?.model ?? "Selected Connector Unavailable" : "GPT-5.4 Mini"} · Read-only advice, not an autonomous agent. No silent provider fallback.`} />
      <div className="mx-4 mb-3 space-y-3 md:mx-5">
        <label className="block text-xs font-medium">AI Connection
          <select aria-label="AI Connection" value={connectorId} onChange={e=>setConnectorId(e.target.value)} className="mt-1 block w-full rounded border border-input bg-background px-3 py-2">
            <option value="">Built-In OpenAI · GPT-5.4 Mini</option>
            {connectorId && !selectedConnector && <option value={connectorId}>Selected Connector Unavailable — Choose A Connection</option>}
            {aiConnectors.map(c=><option key={c.id} value={c.id}>{c.name} · {c.provider} · {c.model}</option>)}
          </select>
        </label>
        <p className="text-[11px] text-muted-foreground">Destination: {connectorId ? selectedConnector ? `${selectedConnector.name} (${selectedConnector.baseUrl ?? selectedConnector.provider + " via Replit AI Integrations"})` : "Unavailable; sending is blocked." : "OpenAI via Replit AI Integrations"}. <Link href="/settings?section=api" className="text-primary underline">Manage API Settings</Link></p>
        {isAuthenticated && gateway.isError && <p className="text-xs text-destructive">Could not load API connections. <button onClick={()=>gateway.refetch()} className="underline">Retry</button></p>}
        <label className="block text-xs font-medium">Evidence Source
          <select aria-label="Evidence Source" value={source} onChange={e => setSource(e.target.value as "demo" | "embedded")} className="mt-1 block w-full rounded border border-input bg-background px-3 py-2">
            <option value="demo">Demo Workspace — Synthetic Data</option>
            <option value="embedded">Embedded Live Checks — Real Evidence</option>
          </select>
        </label>
        {source === "embedded" && (isLoading ? <p className="text-xs">Checking Sign-In…</p> : !isAuthenticated ? (
          <p className="text-xs text-muted-foreground">Sign in to access your own check history. <button onClick={login} className="text-primary underline">Sign In</button></p>
        ) : live.isLoading ? <p className="text-xs">Loading Check History…</p> : live.isError ? (
          <p className="text-xs text-destructive">Could not load your evidence. <button onClick={() => live.refetch()} className="underline">Retry</button></p>
        ) : !selected ? <p className="text-xs text-muted-foreground">No embedded checks found. Run an authorized check in Scans → Embedded Live Checks first.</p> : (
          <>
            <label className="block text-xs font-medium">Selected Embedded Check
              <select aria-label="Selected Embedded Check" value={selected.id} onChange={e => setJobId(e.target.value)} className="mt-1 block w-full rounded border border-input bg-background px-3 py-2">
                {jobs.map(j => <option key={j.id} value={j.id}>{j.ip} · {j.profile} · {j.status} · {new Date(j.createdAt).toLocaleString()} · {j.id}</option>)}
              </select>
            </label>
            <p className="break-words text-xs text-muted-foreground">{selected.services.length}/{selected.ports.length} port observations · Status: {selected.status}. Only this check is used; demo findings are excluded. Incomplete checks cannot establish full coverage.</p>
          </>
        ))}
        <p className="text-[11px] text-muted-foreground">On Send, your question and {source === "embedded" ? "the selected check’s IP, ports, timestamps and result details" : "demo assets and findings"} are sent to the configured AI service. No scans or remediation are executed. Each question is independent; switching source or check clears this local conversation. There is no rule-based fallback if the AI request fails.</p>
      </div>
      <InvestigatorChat key={`${source}:${user?.id ?? "anon"}:${source === "embedded" ? selected?.id ?? "none" : "demo"}:${connectorId}`} source={source} job={source === "embedded" ? selected : undefined} blocked={blocked} connectorId={connectorId} />
    </div>
  );
}

function InvestigatorChat({ source, job, blocked, connectorId }: { source: "demo" | "embedded"; job?: LiveJob; blocked: boolean; connectorId:string }) {
  const canWrite = useCanWrite();
  const inv = useInvestigate();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, inv.isPending]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || inv.isPending || blocked) return;
    setMsgs((m) => [...m.filter((x) => x.role !== "error"), { role: "user", text: t }]);
    setInput("");
    inv.mutate({ data: { message: t.slice(0, 4000), source, ...(source === "embedded" ? {jobId:job?.id} : {}), ...(connectorId?{connectorId}:{}) } }, {
      onSuccess: (r) => setMsgs((m) => [...m, { role: "ai", text: r.message }]),
      onError: (error) => {
        const detail = (error as { data?: {error?:string} }).data?.error;
        setMsgs((m) => [...m, { role: "error", text: detail ?? "The investigator could not respond. Please retry.", retry: t }]);
      },
    });
  };

  return (
      <div className="mx-4 mb-8 flex min-h-[400px] flex-1 flex-col panel md:mx-5">
        <div className="scrollbar-thin max-h-[60vh] min-h-[260px] flex-1 space-y-4 overflow-auto p-4">
          {msgs.length === 0 && (
            <div className="mx-auto max-w-xl py-8 text-center">
              <Sparkles className="mx-auto h-7 w-7 text-primary" />
              <h3 className="font-display mt-3 text-lg font-semibold">{source === "embedded" ? "Ask About This Embedded Check" : "Ask About This Demo Workspace"}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{source === "embedded" ? "Real observations, exposure priorities, remediation and evidence limitations." : "Synthetic findings, prioritisation, compliance mapping, attack paths."}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {(source === "embedded" ? LIVE_PROMPTS : PROMPTS).map((p, i) => <button disabled={blocked || inv.isPending} key={p} onClick={() => send(p)} data-testid={`button-prompt-${i}`} className="rounded border border-border p-2.5 text-left text-xs hover:border-primary/50 hover:bg-primary/5 disabled:opacity-40">{p}</button>)}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cn("rise flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] whitespace-pre-wrap rounded px-3.5 py-2.5 text-[13px] leading-relaxed", m.role === "user" ? "bg-primary/15 text-foreground" : m.role === "error" ? "border border-destructive/40 bg-destructive/10" : "border border-border bg-background/50")} data-testid={`message-${m.role}-${i}`}>
                {m.role === "ai" && <div className="mb-1 break-all font-mono text-[10px] uppercase tracking-wider text-primary">SPECTRE AI · {source === "embedded" ? `Embedded Check ${job?.id}` : "Synthetic Demo"}</div>}
                {m.text}
                {m.retry && <button disabled={blocked || inv.isPending} onClick={() => send(m.retry!)} data-testid="button-retry-message" className="ml-2 inline-flex items-center gap-1 text-xs text-destructive underline"><RotateCw className="h-3 w-3" />Retry</button>}
              </div>
            </div>
          ))}
          {inv.isPending && <div className="flex gap-1 px-2">{[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: `${d * 120}ms` }} />)}</div>}
          <div ref={end} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-border/60 p-3">
          <textarea disabled={blocked} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} rows={1} maxLength={4000} placeholder={!canWrite ? "Read-only access: asking the investigator requires an administrator." : "Ask the investigator..."} data-testid="input-message"
            className="min-h-[38px] flex-1 resize-none rounded border border-input bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary" />
          <button type="submit" disabled={blocked || !input.trim() || inv.isPending} data-testid="button-send" className="grid w-10 place-items-center rounded bg-primary text-primary-foreground disabled:opacity-40"><Send className="h-4 w-4" /></button>
        </form>
      </div>
  );
}
