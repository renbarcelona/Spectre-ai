import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const result = await build({
  entryPoints:[root+"artifacts/sentinel/src/lib/executive-report.ts"],
  tsconfig:root+"artifacts/sentinel/tsconfig.json",
  bundle:true,platform:"node",format:"esm",write:false,
});
const { buildExecutiveReport } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const ws = {
  mode:"demonstration", settings:{organization:"Board Review Test",allowedSubnet:"192.168.10.0/24"},
  assets:Array.from({length:10},(_,i)=>({id:`a${i}`,hostname:`service-${i}`,risk:90-i})),
  vulnerabilities:Array.from({length:100},(_,i)=>({id:`v${i}`,assetId:`a${i%10}`,title:"Example",
    cve:`CVE-2021-${4000+i}`,severity:i%2?"high":"critical",score:9,kev:i%3===0,status:"pending",
    confidence:.85,technique:["T1190","T1078","T1021","T1486"][i%4]})),
  scans:[{status:"completed"}],activity:[],compliance:[],riskScore:90,
};
const out=root+"generated-artifacts/executive-report-tests";
mkdirSync(out,{recursive:true});
for(const name of ["populated","empty","long-manual"]){
  const input=structuredClone(ws);
  if(name==="empty"){input.vulnerabilities=[];input.assets=[];input.scans=[];}
  if(name==="long-manual"){
    input.settings.organization="<script>not executable</script> "+"X".repeat(1000);
    input.assets.forEach(a=>a.hostname="Y".repeat(1000));
    input.executiveInsights={sections:[{key:"financial",mode:"manual",value:100000,secondaryValue:900000,
      unit:"PHP",owner:"Z".repeat(500),source:"S".repeat(1000),asOf:"2026-11-13"}]};
  }
  const html=buildExecutiveReport(input,new Date("2026-11-13T00:00:00Z"));
  assert.equal((html.match(/<section class="sheet"/g)||[]).length,2);
  for(const text of ["Financial","Reputational","Legal","Operational","Business","Decisions Requested","Demonstration Evidence"])
    assert.ok(html.includes(text),text);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes(name==="long-manual"?"Management-declared scenario range":"Financial Exposure: Not Quantified"));
  writeFileSync(`${out}/${name}.html`,html);
}
console.log("PASS: two-sheet structure, impact coverage, unquantified/declared finance, empty state, long input and HTML escaping.");
