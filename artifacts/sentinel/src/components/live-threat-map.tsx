import { useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { Panel } from "@/components/kit";

const MAP_URL = "https://livethreatmap.radware.com/";

export function LiveThreatMap() {
  const [reload, setReload] = useState(0);
  const [supportsWebGL] = useState(() => {
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      return Boolean(context);
    } catch { return false; }
  });
  return (
    <Panel kicker="Global threat intelligence" title="Live cyber threat map" bodyClass="p-0"
      action={
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-primary">
          <button type="button" onClick={() => setReload(n => n + 1)} className="flex items-center gap-1" aria-label="Reload threat map">
            <RefreshCw className="h-3 w-3" /> Reload
          </button>
          <a href={MAP_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
            Open map <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      }>
      <div className="border-b border-border/50 px-4 py-2 text-xs text-muted-foreground">
        Source: Radware Live Threat Map. Provider-reported global activity, not attacks detected on your assets or SPECTRE assessment evidence.
      </div>
      {supportsWebGL ? <iframe key={reload} src={MAP_URL} title="Radware live global cyber threat map"
        className="block h-[520px] w-full border-0 bg-[#080d13] md:h-[600px]"
        referrerPolicy="no-referrer" allowFullScreen /> : (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="font-medium">This browser cannot render the 3D threat map</p>
          <p className="max-w-lg text-sm text-muted-foreground">Radware requires WebGL. Open the map in a browser with hardware acceleration enabled to view its live visualization.</p>
          <a href={MAP_URL} target="_blank" rel="noopener noreferrer" className="rounded border border-primary/40 px-4 py-2 text-sm text-primary">Open Radware Live Threat Map ↗</a>
        </div>
      )}
      <p className="border-t border-border/50 px-4 py-2 text-[11px] text-muted-foreground">
        Third-party content connects directly to Radware and may use cookies. Availability and update timing are controlled by the provider.
        {" "}If the map is blank or blocked, use Reload or Open map above.
      </p>
    </Panel>
  );
}
