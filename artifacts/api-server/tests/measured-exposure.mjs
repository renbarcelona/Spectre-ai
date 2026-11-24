import {build} from "../node_modules/esbuild/lib/main.js";
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
const dir=resolve("generated-artifacts/embedded-tests");
await mkdir(dir,{recursive:true});
await build({stdin:{contents:`export * from './artifacts/sentinel/src/lib/live-exposure.ts'; export * from './artifacts/api-server/src/lib/embedded-ports.ts'; export * from './artifacts/sentinel/src/lib/embedded-guidance.ts';`,resolveDir:process.cwd()},bundle:true,platform:"node",format:"esm",outfile:resolve(dir,"exposure.mjs"),logLevel:"silent"});
const {aggregateLiveExposure,parsePortSpec,validateCustomPorts,customPorts,parsePortList,jobPairs,consolidatedGuidance}=await import(pathToFileURL(resolve(dir,"exposure.mjs")));
const service=(port,state="open",protocol)=>({port,state,protocol,service:"Unidentified"});
const job=(id,ip,at,services,extra={})=>({id,ip,createdAt:at,finishedAt:at,status:"completed",engine:"embedded",ports:services.map(s=>s.port),services,...extra});
const rows=[
 job("older","192.0.2.1","2026-01-01T00:00:00Z",[service(22)]),
 job("newer","192.0.2.1","2026-01-02T00:00:00Z",[service(80),service(22,"closed"),service(53,"open|filtered","udp"),service(123,"open","udp"),service(80),service(-1),service(9000,"open","bad")]),
 job("legacy","192.0.2.2","2026-01-01T00:00:00Z",[service(5432)]),
 job("external","192.0.2.3","2026-01-03T00:00:00Z",[service(22)],{engine:"external"}),
 job("demo","192.0.2.4","2026-01-03T00:00:00Z",[service(22)],{engine:undefined}),
 job("failed","192.0.2.1","2026-01-03T00:00:00Z",[service(22)],{status:"failed"}),
];
const s=aggregateLiveExposure(rows),values=Object.fromEntries(s.metrics.map(m=>[m.key,m.count]));
assert.deepEqual(values,{openTcp:2,udp:1,web:1,remote:0,database:1,inconclusive:1});
assert.equal(s.targetCount,2);assert.equal(s.checkCount,5);assert.equal(s.invalidCount,2);
assert.deepEqual(s.includedJobIds,["newer","legacy"]);
assert.equal(s.excludedNewer[0].jobId,"failed");
assert.deepEqual(aggregateLiveExposure([...rows].reverse()),s);
assert.ok(aggregateLiveExposure([]).metrics.every(m=>m.count===null));
const udpOnly=aggregateLiveExposure([job("udp","192.0.2.1","2026-01-01T00:00:00Z",[service(53,"open|filtered","udp")])]);
assert.equal(udpOnly.metrics.find(m=>m.key==="udp").count,0);
assert.equal(udpOnly.metrics.find(m=>m.key==="openTcp").count,null);
const tie=[job("a","192.0.2.1","2026-01-01T00:00:00Z",[service(80)]),job("b","192.0.2.1","2026-01-01T00:00:00Z",[service(80,"closed")])];
assert.deepEqual(aggregateLiveExposure(tie).includedJobIds,["b"]);
assert.deepEqual(jobPairs({ports:[53],tcpPorts:[53],udpPorts:[53]}),[{protocol:"tcp",port:53},{protocol:"udp",port:53}]);
for(const text of ["", "80", "22,80,8000-8002", "1 - 3", "443,443", "65535"]){
 assert.equal(parsePortSpec(text).error,null);assert.deepEqual(parsePortSpec(text).ports,parsePortList(text));
}
for(const text of ["0","65536","1-31","90-80","22,","-1","80;id","1,2,,3","9".repeat(1025)]){
 assert.ok(parsePortSpec(text).error);assert.throws(()=>parsePortList(text));
}
assert.ok(validateCustomPorts("","").error);assert.throws(()=>customPorts("",""));
assert.ok(validateCustomPorts("1-30","1").error);assert.throws(()=>customPorts("1-30","1"));
assert.equal(validateCustomPorts("53","53").total,2);
const recommendations=consolidatedGuidance(job("both","192.0.2.1","2026-01-01T00:00:00Z",[service(443,"open","udp"),service(443,"open","tcp")]));
assert.ok(recommendations.some(r=>r.protocol==="udp"));assert.ok(recommendations.some(r=>r.protocol==="tcp"));
const udpGuidance=recommendations.find(r=>r.protocol==="udp");
assert.ok(!JSON.stringify(udpGuidance).includes("TCP connection"));
console.log("Measured exposure and custom-port tests passed: actual counts, latest-per-host selection, deduplication, legacy TCP, unknown coverage, exclusions, protocol-aware guidance and matching frontend/server port validation. No network.");
