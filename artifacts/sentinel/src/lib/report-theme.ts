/**
 * Shared, self-contained print theme for SPECTRE AI reports ("Intelligence Briefing" newsletter).
 * Presentation only: no network fonts/images, no animation. Appended after each report's base CSS.
 */
const base = `
:root{--navy:#0d1b2e;--ink:#15253a;--cyan:#1b8a9c;--cyan-soft:#e3f1f4;--gold:#b48a35;--gold-soft:#fbf3e1;--rule:#d3dce4;--paper:#fbfcfd;--mute:#56667a}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{color:var(--ink);font-family:"Segoe UI","Aptos",Calibri,"Liberation Sans",Arial,sans-serif}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;color:var(--navy);letter-spacing:-.1pt}
h1{font-weight:normal}
h2{color:var(--navy);border-bottom:1px solid var(--rule);position:relative}
h2::after{content:"";position:absolute;left:0;bottom:-1px;width:14mm;height:2px;background:var(--gold)}
h3{color:#1a4f63}
a{color:#13687a}
th{background:var(--navy);color:#eef6f8;font-family:"Segoe UI",Calibri,Arial,sans-serif;font-weight:600;letter-spacing:.3pt;border-bottom:2px solid var(--cyan)}
tbody tr:nth-child(even) td{background:rgba(27,138,156,.045)}
.notice,.banner{background:var(--gold-soft);border:0;border-left:3px solid var(--gold);color:#3d3220}
.callout{background:var(--cyan-soft);border-left:3px solid var(--cyan)}
.meta,.muted{color:var(--mute)}
pre{background:#f1f5f8;border:1px solid var(--rule);border-left:3px solid var(--cyan);padding:3mm;font-family:Consolas,"Liberation Mono",monospace}
`;

/** Fixed two-sheet executive layout: decoration only, no added flow height beyond the masthead band. */
export const EXECUTIVE_THEME = base + `
body{background:#dfe5ec;font-size:9.5pt;line-height:1.3}
.sheet{background:
  linear-gradient(180deg,var(--navy) 0,var(--navy) 3.2mm,var(--gold) 3.2mm,var(--gold) 3.7mm,transparent 3.7mm),
  radial-gradient(120mm 70mm at 100% 0,rgba(27,138,156,.10),transparent 70%),
  radial-gradient(90mm 60mm at 0 100%,rgba(180,138,53,.07),transparent 70%),
  repeating-linear-gradient(90deg,rgba(13,27,46,.025) 0 1px,transparent 1px 12mm),
  var(--paper)}
.eyebrow{display:flex;justify-content:space-between;align-items:baseline;margin:0;padding:0 0 1.6mm;border-bottom:1px solid var(--navy);color:var(--cyan);font-size:8pt;letter-spacing:1pt;text-transform:uppercase;font-weight:700}
.eyebrow::before{content:"SPECTRE AI  |  Intelligence Briefing";order:2;color:var(--navy);font-family:Georgia,serif;font-size:9pt;letter-spacing:.4pt;text-transform:none;font-weight:bold}
h1{font-size:22pt;margin:4mm 0 2.5mm}
h2{margin-top:4mm}
.meta,.muted{font-size:8pt}
.metrics td{background:#fff;border:2px solid var(--paper);border-top:2px solid var(--cyan)}
.metrics strong{font-family:Georgia,serif;color:var(--navy);font-weight:normal}
.metrics span{color:var(--mute);text-transform:uppercase;letter-spacing:.5pt;font-size:7pt}
table:not(.metrics){background:rgba(255,255,255,.85);font-size:8.5pt}
footer{border-top:1px solid var(--navy);color:var(--mute);font-size:7.5pt;letter-spacing:.3pt}
@media print{body{background:var(--paper)}}
`;

/** Flowing technical layout: masthead band at document start, readable evidence tables. */
export const DOCUMENT_THEME = base + `
body{background:linear-gradient(180deg,rgba(27,138,156,.06),transparent 120mm),var(--paper)}
body::before{content:"SPECTRE AI  |  Technical Intelligence Briefing  |  Confidential";display:block;padding:3mm 4mm;margin-bottom:4mm;background:linear-gradient(90deg,var(--navy),#163a52);color:#e8f3f6;font-family:Georgia,serif;font-size:10pt;letter-spacing:.5pt;border-bottom:2px solid var(--gold)}
h1{font-size:24pt;margin:4mm 0 2mm;border-left:4px solid var(--cyan);padding-left:3mm}
table{background:#fff;border:1px solid var(--rule)}
td,th{border-color:var(--rule)}
article{background:#fff;border:1px solid var(--rule);border-top:3px solid var(--navy);padding:2mm 5mm 4mm;margin-top:5mm}
article h2,article h3{break-after:avoid}
@media print{body{background:var(--paper)}}
`;
