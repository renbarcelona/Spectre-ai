import type { ReactNode } from "react";
import { AlertTriangle, RotateCw, Radar } from "lucide-react";
import type { Asset, Vulnerability } from "@workspace/api-client-react";
import { riskColor, sevColor } from "@/lib/sentinel";
import { cn } from "@/lib/utils";

export function Panel({ title, kicker, action, children, className, bodyClass }: { title?: ReactNode; kicker?: string; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn("panel rise relative overflow-hidden", className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
          <div className="min-w-0">
            {kicker && <div className="font-sans text-[11px] font-medium capitalize tracking-wide text-muted-foreground">{kicker}</div>}
            <h2 className="font-display truncate text-[13px] font-semibold text-foreground">{title}</h2>
          </div>
          {action}
        </header>
      )}
      <div className={cn("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function Illustrative({ children = "Illustrative, not measured" }: { children?: ReactNode }) {
  return <span className="rounded-sm border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-sans text-[10px] font-medium text-accent">{children}</span>;
}

export function SevBadge({ sev }: { sev: string }) {
  const c = sevColor(sev);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-sans text-[11px] font-medium capitalize" style={{ color: c, background: `${c.replace(")", " / .12)")}`, border: `1px solid ${c.replace(")", " / .3)")}` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {sev}
    </span>
  );
}

export function RiskBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, background: riskColor(value) }} />
      </div>
      <span className="font-mono text-xs tabular-nums" style={{ color: riskColor(value) }}>{value}</span>
    </div>
  );
}

export function Skel({ className }: { className?: string }) {
  return <div className={cn("relative overflow-hidden rounded bg-muted/60 after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.6s_infinite] after:bg-gradient-to-r after:from-transparent after:via-white/5 after:to-transparent", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="grid gap-3 p-4 md:grid-cols-4" data-testid="status-loading">
      {Array.from({ length: 4 }).map((_, i) => <Skel key={i} className="h-24" />)}
      <Skel className="h-72 md:col-span-3" />
      <Skel className="h-72" />
      <Skel className="h-48 md:col-span-4" />
    </div>
  );
}

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6" data-testid="status-error">
      <div className="panel max-w-md p-6 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
        <h3 className="font-display mt-3 text-lg font-semibold">Workspace unreachable</h3>
        <p className="mt-1 text-sm text-muted-foreground">{message ?? "The assessment API did not respond. It may still be starting up."}</p>
        {onRetry && (
          <button onClick={onRetry} data-testid="button-retry" className="mt-4 inline-flex items-center gap-2 rounded border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm text-primary hover:bg-primary/20">
            <RotateCw className="h-3.5 w-3.5" /> Retry connection
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="relative grid h-14 w-14 place-items-center rounded-full border border-primary/25">
        <div className="absolute inset-0 rounded-full border border-primary/20 ping-soft" />
        <Radar className="h-6 w-6 text-primary/70" />
      </div>
      <h3 className="font-display mt-2 text-sm font-semibold">{title}</h3>
      <p className="max-w-sm text-xs text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="panel rise px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="font-display mt-1 text-2xl font-semibold tabular-nums" style={{ color: tone }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Topology rendered from actual workspace assets; layout & links are illustrative. */
export function Topology({ assets, vulns = [], highlight, onSelect, scanning, height = 340 }: { assets: Asset[]; vulns?: Vulnerability[]; highlight?: string | null; onSelect?: (a: Asset) => void; scanning?: boolean; height?: number }) {
  const W = 640, H = 360, cx = W / 2, cy = H / 2;
  const zones = Array.from(new Set(assets.map((a) => a.zone)));
  const zonePos = zones.map((z, i) => {
    const ang = (i / Math.max(1, zones.length)) * Math.PI * 2 - Math.PI / 2;
    return { z, x: cx + Math.cos(ang) * 110, y: cy + Math.sin(ang) * 95, ang };
  });
  const nodes = assets.map((a) => {
    const zp = zonePos.find((z) => z.z === a.zone)!;
    const peers = assets.filter((b) => b.zone === a.zone);
    const idx = peers.indexOf(a);
    const spread = 0.9;
    const ang = zp.ang + (peers.length > 1 ? (idx / (peers.length - 1) - 0.5) * spread : 0);
    return { a, x: cx + Math.cos(ang) * 240 * 0.95, y: cy + Math.sin(ang) * 150, zx: zp.x, zy: zp.y };
  });
  const vulnCount = (id: string) => vulns.filter((v) => v.assetId === id).length;
  return (
    <div className="grid-bg relative w-full overflow-hidden rounded border border-border/60 bg-background/60" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" data-testid="graphic-topology">
        <defs>
          <radialGradient id="sweepg"><stop offset="0" stopColor="hsl(172 72% 52%)" stopOpacity=".25" /><stop offset="1" stopColor="hsl(172 72% 52%)" stopOpacity="0" /></radialGradient>
        </defs>
        {scanning && <path className="sweep" d={`M${cx} ${cy} L${cx + 300} ${cy - 60} A300 300 0 0 1 ${cx + 300} ${cy + 60} Z`} fill="url(#sweepg)" />}
        {[60, 120, 180].map((r) => <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke="hsl(216 22% 22%)" strokeDasharray="2 6" />)}
        {zonePos.map((z) => (
          <g key={z.z}>
            <line x1={cx} y1={cy} x2={z.x} y2={z.y} stroke="hsl(172 72% 52% / .5)" className="edge-flow" />
            <rect x={z.x - 34} y={z.y - 9} width={68} height={18} rx={3} fill="hsl(220 30% 9%)" stroke="hsl(172 72% 52% / .4)" />
            <text x={z.x} y={z.y + 3.5} textAnchor="middle" fontSize="8.5" fill="hsl(172 60% 70%)" fontFamily="IBM Plex Mono">{z.z.slice(0, 12)}</text>
          </g>
        ))}
        {nodes.map(({ a, x, y, zx, zy }) => {
          const c = riskColor(a.risk);
          const hl = highlight === a.id;
          return (
            <g key={a.id} className="cursor-pointer" onClick={() => onSelect?.(a)} data-testid={`node-asset-${a.id}`}>
              <line x1={zx} y1={zy} x2={x} y2={y} stroke={c} strokeOpacity={hl ? 0.9 : 0.35} className="edge-flow" />
              {a.risk >= 70 && <circle cx={x} cy={y} r={9} fill="none" stroke={c} className="ping-soft" />}
              <circle cx={x} cy={y} r={hl ? 9 : 6.5} fill="hsl(222 32% 7%)" stroke={c} strokeWidth={hl ? 2.5 : 1.5} />
              <circle cx={x} cy={y} r={2.5} fill={c} />
              <text x={x} y={y + (y > cy ? 20 : -13)} textAnchor="middle" fontSize="8.5" fill="hsl(210 24% 85%)" fontFamily="IBM Plex Mono">{a.hostname}</text>
              <text x={x} y={y + (y > cy ? 30 : -23)} textAnchor="middle" fontSize="7" fill="hsl(215 14% 55%)" fontFamily="IBM Plex Mono">{a.ip}{vulnCount(a.id) ? ` · ${vulnCount(a.id)} vuln` : ""}</text>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={16} fill="hsl(222 32% 7%)" stroke="hsl(42 92% 58%)" strokeWidth={1.5} />
        <circle cx={cx} cy={cy} r={16} fill="none" stroke="hsl(42 92% 58%)" className="ping-soft" />
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize="7.5" fill="hsl(42 92% 70%)" fontFamily="IBM Plex Mono">GW .1</text>
      </svg>
      <div className="absolute bottom-2 left-2"><Illustrative>Layout illustrative · nodes from workspace assets</Illustrative></div>
    </div>
  );
}
