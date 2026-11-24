// Exercises the real Node lifecycle with isolated in-memory state and a subprocess
// fixture that never opens a network socket. Production has no test-mode switch.
import { build } from "../node_modules/esbuild/lib/main.js";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const output = resolve("generated-artifacts/embedded-tests/lifecycle.mjs");
await mkdir(resolve("generated-artifacts/embedded-tests"), {recursive:true});
const fixtureProcess = `
let text="";
process.stdin.on("data",chunk=>{
  text+=chunk;
  if(!text.includes("\\n"))return;
  const j=JSON.parse(text);
  if(j.ip==="1.1.1.1")return; // wait for real cancellation signal
  if(j.ip==="9.9.9.9"){process.stdout.write("invalid");process.exit(0);}
  const ports=j.profile==="web"?[80,443,8080,8443]:[];
  let services=j.profile==="custom"
    ? [...j.tcpPorts.map(port=>({port,protocol:"tcp",state:"closed",service:"Unidentified"})),
       ...j.udpPorts.map(port=>({port,protocol:"udp",state:"open|filtered",service:"Unidentified"}))]
    : ports.map(port=>({port,state:"closed",service:"Unidentified",reason:"Fixture refusal",elapsedMs:1}));
  if(j.udpPorts?.includes(9999)) services[0].protocol="tcp"; // reject mismatched worker protocol
  if(j.udpPorts?.includes(9998)) services=[]; // reject missing evidence
  process.stdout.write(JSON.stringify({ip:j.ip,profile:j.profile,version:"Fixture / No Network",
    services}));
  process.exit(0);
});`;
const modules = {
  state: `
    import { createHash } from 'node:crypto';
    export const states=new Map();
    export const PROFILES={web:[80,443,8080,8443],standard:[]};
    export const now=()=>new Date().toISOString();
    export const hash=v=>createHash('sha256').update(v).digest('hex');
    export const active=j=>['queued','running','cancelling'].includes(j.status);
    export const isPublicIPv4=ip=>['8.8.8.8','1.1.1.1','9.9.9.9'].includes(ip);
    export const audit=(s,actor,action)=>s.audit.push({actor,action});
    export const publicJob=j=>({...j});
    export async function liveOperation(owner,fn){return fn(states.get(owner));}
  `,
  db: `
    export const slots=new Set();
    export const pool={async connect(){return {
      async query(sql, [key]){
        if(sql.includes('try_advisory')){
          if(slots.has(key))return {rows:[{held:false}]};
          slots.add(key); return {rows:[{held:true}]};
        }
        slots.delete(key); return {rows:[]};
      },
      release(){}
    }}};
  `,
  logger: `export const logger={error(){}};`,
  child: `
    import {execFile,spawn as realSpawn} from 'node:child_process';
    export {execFile};
    export function spawn(_binary,_args,options){
      return realSpawn(process.execPath,['-e',${JSON.stringify(fixtureProcess)}],options);
    }
  `,
};
await build({
  stdin:{contents:`export * from './artifacts/api-server/src/lib/embedded-discovery.ts'; export {states} from 'fixture-state'; export {slots} from 'fixture-db';`,resolveDir:process.cwd()},
  bundle:true,platform:"node",format:"esm",outfile:output,logLevel:"silent",
  plugins:[{name:"isolated-fixtures",setup(b){
    b.onResolve({filter:/^node:child_process$/},args=>args.namespace==="fixture"?undefined:{path:"child",namespace:"fixture"});
    b.onResolve({filter:/^(@workspace\/db|fixture-db)$/},()=>({path:"db",namespace:"fixture"}));
    b.onResolve({filter:/^(\.\/live-discovery|fixture-state)$/},()=>({path:"state",namespace:"fixture"}));
    b.onResolve({filter:/^\.\/logger$/},()=>({path:"logger",namespace:"fixture"}));
    b.onResolve({filter:/^@workspace\/api-zod$/},()=>({path:resolve("lib/api-zod/src/generated/api.ts")}));
    b.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:modules[args.path],loader:"js"}));
  }}],
});
const {startEmbedded,states,slots}=await import(pathToFileURL(output).href);
function owner(name,ip="8.8.8.8"){
  states.set(name,{agents:[],jobs:[],audit:[],targets:[{id:"target",ip,revoked:false,expiresAt:new Date(Date.now()+3600000).toISOString()}]});
}
async function terminal(name){
  for(let i=0;i<80;i++){
    const j=states.get(name).jobs[0];
    if(j && !["running","cancelling"].includes(j.status))return j;
    await new Promise(r=>setTimeout(r,50));
  }
  throw new Error("Job did not become terminal");
}
const input={targetId:"target",profile:"web"};
owner("success");
assert.equal((await startEmbedded("success",input)).status,201);
const completed=await terminal("success");
assert.equal(completed.status,"completed");
assert.equal(completed.services.length,4);
assert.equal(completed.evidenceSha256.length,64);
assert.equal(JSON.parse(completed.rawEvidence).ip,"8.8.8.8");
assert.equal((await startEmbedded("success",input)).status,409);
owner("custom");
assert.equal((await startEmbedded("custom",{targetId:"target",profile:"custom",tcpPorts:"53,80-81,53",udpPorts:"53"},"fixture-actor")).status,201);
const mixed=await terminal("custom");
assert.equal(mixed.status,"completed");
assert.equal(mixed.services.length,4);
assert.deepEqual(mixed.tcpPorts,[53,80,81]);assert.deepEqual(mixed.udpPorts,[53]);
assert.equal(mixed.createdBy,"fixture-actor");
assert.equal(mixed.services.filter(s=>s.port===53).length,2);
assert.ok(mixed.services.some(s=>s.protocol==="udp"&&s.state==="open|filtered"));
assert.deepEqual(JSON.parse(mixed.rawEvidence).services,mixed.services);
for(const port of ["9999","9998"]){
  owner(`invalid-${port}`);
  assert.equal((await startEmbedded(`invalid-${port}`,{targetId:"target",profile:"custom",udpPorts:port})).status,201);
  assert.equal((await terminal(`invalid-${port}`)).status,"failed");
}
for(const data of [
  {profile:"custom"},{profile:"custom",tcpPorts:"1-31"},{profile:"custom",tcpPorts:"1-30",udpPorts:"1"},
  {profile:"custom",tcpPorts:"0"},{profile:"custom",udpPorts:"65536"},{profile:"custom",tcpPorts:"80;id"},
  {profile:"custom",tcpPorts:"80,"},{profile:"custom",tcpPorts:"90-80"},{profile:"web",udpPorts:"53"},
]){
  owner("bad-input");
  assert.equal((await startEmbedded("bad-input",{targetId:"target",...data})).status,400);
  assert.equal(states.get("bad-input").jobs.length,0);
}
owner("cancel","1.1.1.1");
await startEmbedded("cancel",input);
assert.equal((await startEmbedded("cancel",input)).status,409);
states.get("cancel").jobs[0].status="cancelling";
assert.equal((await terminal("cancel")).status,"cancelled");
owner("invalid","9.9.9.9");
await startEmbedded("invalid",input);
assert.equal((await terminal("invalid")).status,"failed");
owner("a","1.1.1.1"); owner("b","1.1.1.1"); owner("c");
await startEmbedded("a",input); await startEmbedded("b",input);
assert.equal((await startEmbedded("c",input)).status,429);
states.get("a").jobs[0].status="cancelling"; states.get("b").jobs[0].status="cancelling";
await terminal("a"); await terminal("b");
assert.equal(slots.size,0);
console.log("Passed real subprocess lifecycle with mocked network-free worker: completion/evidence, cancellation, invalid output, per-owner cooldown, exclusivity, global cap and slot cleanup.");
