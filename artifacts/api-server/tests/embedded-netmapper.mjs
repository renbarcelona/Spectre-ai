import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const require=createRequire(root+"artifacts/sentinel/package.json");
const React=require("react");
const {renderToStaticMarkup}=require("react-dom/server");
const result=await build({
  entryPoints:[root+"artifacts/sentinel/src/components/live-discovery/embedded-netmapper.tsx"],
  tsconfig:root+"artifacts/sentinel/tsconfig.json",jsx:"automatic",bundle:true,platform:"node",format:"cjs",write:false,
  external:["react","react-dom","react/jsx-runtime"],
});
const mod={exports:{}};
new Function("require","module","exports",result.outputFiles[0].text)(require,mod,mod.exports);
const {EmbeddedNetMapper}=mod.exports;
const job=(id,ip,state,services=[])=>({id,ip,status:state,engine:"embedded",createdAt:"2026-11-23T00:00:00Z",profile:"custom",services});
const newer={...job("new","192.0.2.1","completed",[{port:443,protocol:"tcp",state:"closed",service:"https"}]),createdAt:"2026-11-24T00:00:00Z"};
const older=job("old","192.0.2.1","completed",[{port:22,protocol:"tcp",state:"open",service:"ssh"}]);
const jobs=[newer,older,job("udp","192.0.2.2","completed",[{port:53,protocol:"udp",state:"open|filtered",service:"unknown"}]),job("pending","192.0.2.3","running"),job("failed","192.0.2.4","failed")];
const render=(jobs,selectedId)=>renderToStaticMarkup(React.createElement(EmbeddedNetMapper,{jobs,selectedId,onSelect:()=>{}}));
const html=render(jobs,"old");
assert.ok(html.includes("Showing the selected historical check"));
assert.ok(html.includes("TCP 22"));
assert.ok(!html.includes("TCP 443"));
assert.ok(html.includes('aria-label="Zoom In"'));
assert.ok(html.includes('aria-label="Reset Zoom"'));
assert.ok(html.includes("Inconclusive Observations"));
assert.ok(html.includes('role="button"'));
assert.ok(html.includes("not measured network routes"));
assert.ok(render([]).includes("No Hosts Observed"));
const pending=render([job("p","192.0.2.5","running",[{port:80,state:"open",service:"http"}])],"p");
assert.ok(pending.includes("observations are incomplete"));
assert.ok(pending.includes("TCP 80"));
const many=render(Array.from({length:30},(_,i)=>job(`j${i}`,`192.0.2.${i+1}`,"completed")));
assert.equal((many.match(/data-testid="node-netmap-/g)||[]).length,24);
assert.ok(many.includes('data-testid="button-netmap-next"'));
const out=root+"generated-artifacts/netmapper";
mkdirSync(out,{recursive:true});
writeFileSync(out+"/markup.html",html);
console.log("PASS: radial controls, historical selection, pending partial results, uncertain UDP, empty state and paginated hosts.");
