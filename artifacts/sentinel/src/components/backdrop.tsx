/** Purely decorative ambient backdrop. Not data. Never interactive. */
const NODES: [number, number][] = [
  [120, 140], [310, 90], [470, 210], [640, 120], [820, 240], [1010, 150], [1220, 260], [1390, 130],
  [200, 380], [420, 460], [610, 360], [790, 470], [980, 400], [1170, 500], [1360, 420],
  [90, 640], [300, 720], [520, 640], [730, 760], [940, 680], [1150, 780], [1340, 700],
];
const LINKS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [0, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14],
  [2, 10], [4, 11], [5, 12], [6, 13], [7, 14], [8, 15], [15, 16], [16, 17], [17, 18], [18, 19], [19, 20], [20, 21],
  [9, 17], [11, 18], [12, 19], [13, 20], [14, 21], [1, 9], [3, 10],
];
const GOLD = new Set([4, 12, 19]);

export function Backdrop() {
  return (
    <div aria-hidden="true" className="spectre-backdrop">
      <div className="bd-glow" />
      <div className="bd-grid" />
      <svg className="bd-net" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="bdl" x1="0" x2="1">
            <stop offset="0" stopColor="hsl(188 90% 60%)" stopOpacity="0" />
            <stop offset=".5" stopColor="hsl(188 90% 60%)" stopOpacity=".55" />
            <stop offset="1" stopColor="hsl(42 92% 60%)" stopOpacity=".2" />
          </linearGradient>
          <radialGradient id="bdn"><stop offset="0" stopColor="hsl(188 95% 70%)" stopOpacity=".9" /><stop offset="1" stopColor="hsl(188 95% 70%)" stopOpacity="0" /></radialGradient>
          <radialGradient id="bdg"><stop offset="0" stopColor="hsl(42 95% 66%)" stopOpacity=".9" /><stop offset="1" stopColor="hsl(42 95% 66%)" stopOpacity="0" /></radialGradient>
        </defs>
        <g fill="none" stroke="url(#bdl)" strokeWidth=".8">
          {LINKS.map(([a, b], i) => {
            const [x1, y1] = NODES[a], [x2, y2] = NODES[b];
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 30;
            return <path key={i} d={`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`} className={i % 4 === 0 ? "bd-pulse" : undefined} />;
          })}
        </g>
        {NODES.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={GOLD.has(i) ? 22 : 14} fill={GOLD.has(i) ? "url(#bdg)" : "url(#bdn)"} opacity=".35" />
            <circle cx={x} cy={y} r={1.8} fill={GOLD.has(i) ? "hsl(42 95% 70%)" : "hsl(188 95% 75%)"} opacity=".7" />
          </g>
        ))}
        <g fill="none" stroke="hsl(188 80% 60% / .08)">
          <circle cx="1180" cy="180" r="160" /><circle cx="1180" cy="180" r="240" strokeDasharray="2 10" /><circle cx="1180" cy="180" r="330" />
        </g>
      </svg>
      <div className="bd-veil" />
    </div>
  );
}
