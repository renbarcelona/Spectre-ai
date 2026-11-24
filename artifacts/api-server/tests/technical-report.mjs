import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const result = await build({entryPoints:[root+"artifacts/sentinel/src/lib/technical-report.ts"],tsconfig:root+"artifacts/sentinel/tsconfig.json",bundle:true,platform:"node",format:"esm",write:false});
const { buildTechnicalReport } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const ws = {
  settings:{organization:'<script>alert("test")</script>',allowedSubnet:"192.0.2.0/24"},
  riskScore:80,
  assets:[{id:"a",hostname:"test-host",ip:"192.0.2.1",os:"Test OS",zone:"IT",type:"server",risk:80,ports:[443,65000],recommendation:"Restrict access"}],
  scans:[{id:"s",createdAt:"2026-11-13",target:"192.0.2.1",type:"single",ports:"443",speed:"T3",status:"completed",progress:100,findings:6}],
  vulnerabilities:["T1190","T1078","T1021","T1486","T0000","T1068"].map((technique,i)=>({
    id:`v${i}`,assetId:i===5?"missing":"a",title:`Finding ${i}`,cve:"CVE-2021-44228",severity:"high",score:8.1,kev:i===2,
    technique,recommendation:i===5?"":"Apply the verified vendor fix",status:i===0?"resolved":"pending",confidence:.8
  }))
};
const html=buildTechnicalReport(ws);
assert.equal((html.match(/<article id=/g)||[]).length,6);
for(const s of ["Risk And Potential Impact","Technical Remediation Guidance","Implementation And Verification","CVSS","Asset Record Unavailable","No finding-specific recommendation recorded","Unknown / Unknown","phishing-resistant MFA","isolated restore test","not measured fingerprints","5 open"]) assert.ok(html.includes(s),s);
assert.ok(!html.includes("<script>"));
assert.ok(html.indexOf("2. Finding 1")>0);
assert.ok(html.indexOf("1. Finding 2")>0);
const empty=buildTechnicalReport({...ws,assets:[],scans:[],vulnerabilities:[]});
assert.ok(empty.includes("No vulnerability records are available"));
const out=root+"generated-artifacts/technical-report-tests";
mkdirSync(out,{recursive:true});
writeFileSync(out+"/technical.html",html);
console.log("PASS: all findings, scores, guidance branches, risk/impact, missing evidence/assets, ordering, escaping and empty state.");
