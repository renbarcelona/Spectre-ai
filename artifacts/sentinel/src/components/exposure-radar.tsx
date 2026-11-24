import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Panel } from "@/components/kit";

const EXPOSURE = [
  { category: "External Attack Surface", axis: "External", score: 82 },
  { category: "Identity Weaknesses", axis: "Identity", score: 43 },
  { category: "Cloud Exposure", axis: "Cloud", score: 61 },
  { category: "Network Exposure", axis: "Network", score: 88 },
  { category: "Web Exposure", axis: "Web", score: 72 },
  { category: "Third Party Risk", axis: "Third Party", score: 56 },
];

export function ExposureRadar() {
  return (
    <Panel kicker="Exposure Overview" title="Exposure Radar">
      <div className="grid items-center gap-4 md:grid-cols-2">
        <div className="min-w-0" role="img" aria-label="Exposure radar on a 0 to 100 display scale. Exact category scores are listed alongside the chart.">
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={EXPOSURE} outerRadius="72%">
              <PolarGrid stroke="hsl(190 40% 30% / .5)" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: "#a7bfcc", fontSize: 11 }} />
              <PolarRadiusAxis domain={[0, 100]} tickCount={5} tick={{ fill: "#8399aa", fontSize: 9 }} axisLine={false} />
              <Radar name="Exposure Score" dataKey="score" stroke="#38d9ed" fill="#38d9ed" fillOpacity={0.17} strokeWidth={2} dot={{ r: 3, fill: "#e8bc68" }} isAnimationActive={false} />
              <Tooltip content={({ active, payload }) => {
                const item = payload?.[0]?.payload as typeof EXPOSURE[number] | undefined;
                return active && item ? <div className="rounded border border-border bg-card px-3 py-2 text-xs shadow-lg">{item.category}: <strong className="text-primary">{item.score}</strong></div> : null;
              }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
          {EXPOSURE.map(item => (
            <div key={item.category} className="rounded border border-border/60 bg-background/35 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-xs text-muted-foreground">{item.category}</dt>
                <dd className="font-display text-xl font-semibold tabular-nums text-foreground">{item.score}</dd>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded bg-muted" aria-hidden="true">
                <div className="h-full rounded bg-cyan-400/75" style={{ width: `${item.score}%` }} />
              </div>
            </div>
          ))}
        </dl>
      </div>
      <p className="mt-2 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">User-Supplied Snapshot · Display Scale: 0–100. Shared fixed snapshot, not live metrics: these values are not derived from any scan (demo or embedded) and do not change when checks run.</p>
    </Panel>
  );
}
