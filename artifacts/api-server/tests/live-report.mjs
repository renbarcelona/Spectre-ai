import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const result = await build({entryPoints:[root+"artifacts/sentinel/src/lib/live-report.ts"],tsconfig:root+"artifacts/sentinel/tsconfig.json",bundle:true,platform:"node",format:"esm",write:false});
const { buildLiveReport, isReportableLiveJob } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const job={
  id:"live-test-123",engine:"embedded",status:"completed",targetId:"t1",agentId:"embedded",
  ip:"192.0.2.1",profile:"custom",ports:[443,22,53,161],tcpPorts:[443,22],udpPorts:[53,161],
  createdAt:"2026-11-13T01:00:00Z",startedAt:"2026-11-13T01:00:01Z",finishedAt:"2026-11-13T01:00:08Z",
  createdBy:"test",agentVersion:"test-runtime",evidenceSha256:"a".repeat(64),
  rawEvidence:'{"example":"<script>no execution</script>"}',
  services:[{port:443,protocol:"tcp",state:"open",service:"https",detail:"TLS check completed",elapsedMs:30},
    {port:22,protocol:"tcp",state:"closed",service:"ssh"},{port:53,protocol:"udp",state:"open|filtered",service:"unknown"}],
};
const out=root+"generated-artifacts/live-report-tests";
mkdirSync(out,{recursive:true});
for(const kind of ["executive","technical"]){
 const html=buildLiveReport(job,kind,{label:"Authorized Target"},"Live Reporting Test");
 assert.ok(html.includes(job.id)); assert.ok(html.includes(job.evidenceSha256));
 assert.ok(html.includes("Not Assessed")); assert.ok(!html.includes("<script>"));
 if(kind==="technical"){
  assert.ok(html.includes("1 missing: 161/udp"));
  assert.ok(html.includes("open|filtered"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Retest And Closure"));
 }else assert.equal((html.match(/class="sheet"/g)||[]).length,2);
 writeFileSync(`${out}/${kind}.html`,html);
 const empty=buildLiveReport({...job,services:[]},kind);
 assert.ok(empty.includes("No Observations Recorded"));
}
for(const status of ["running","failed","cancelled","queued"]){
 assert.equal(isReportableLiveJob({...job,status}),false);
 assert.throws(()=>buildLiveReport({...job,status},"technical"));
}
assert.throws(()=>buildLiveReport({...job,engine:"external"},"technical"));
const page=readFileSync(root+"artifacts/sentinel/src/pages/reports.tsx","utf8");
assert.ok(page.includes('jobs.find(j => j.id === selectedId)'));
assert.ok(page.includes('disabled={!ready}'));
const entry=readFileSync(root+"artifacts/sentinel/src/components/live-discovery/live-discovery.tsx","utf8");
assert.ok(entry.includes('encodeURIComponent(current.id)}&kind=technical'));
assert.ok(entry.includes('encodeURIComponent(current.id)}&kind=executive'));
console.log("PASS: actual observations, scan/hash provenance, missing/UDP results, no fabricated scores, escaping, empty states, incomplete-job rejection and direct report links.");
