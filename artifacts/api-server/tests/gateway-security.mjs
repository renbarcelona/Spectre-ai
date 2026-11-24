// Isolated transport fixtures: no external requests and no credentials.
import { build } from "../node_modules/esbuild/lib/main.js";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const dir=resolve("generated-artifacts/gateway-tests");
await mkdir(dir,{recursive:true});
const mock=`
import {EventEmitter} from 'node:events';
export const state={calls:0,lookups:0,status:200,text:'{"ok":true}',pinned:null};
export async function resolve4(host){
 state.lookups++;
 return host==='mixed.example'?['93.184.216.34','127.0.0.1']:host==='private.example'?['10.0.0.1']:['93.184.216.34'];
}
export function request(url,options,callback){
 state.calls++;state.pinned=null;
 if(options.lookup)options.lookup(url.hostname,{},(err,ip)=>{state.pinned=ip});
 const req=new EventEmitter();req.destroy=()=>{};req.write=()=>{};
 req.end=()=>setImmediate(()=>{
  const res=new EventEmitter();res.statusCode=state.status;res.resume=()=>{};
  callback(res);res.emit('data',Buffer.from(state.text));res.emit('end');
 });return req;
}`;
await build({
  stdin:{contents:`export * from './artifacts/api-server/src/lib/gateway-http.ts'; export {state} from 'transport-fixture';`,resolveDir:process.cwd()},
  bundle:true,platform:"node",format:"esm",outfile:resolve(dir,"security.mjs"),logLevel:"silent",
  plugins:[{name:"fixtures",setup(b){
    b.onResolve({filter:/^(node:https|node:http|node:dns\/promises|transport-fixture)$/},()=>({path:"transport",namespace:"fixture"}));
    b.onResolve({filter:/^@workspace\/db$/},()=>({path:"db",namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:a.path==="db"?"export const pool={};":mock,loader:"js"}));
  }}],
});
const {validateGatewayUrl,gatewayJson,state}=await import(pathToFileURL(resolve(dir,"security.mjs")));
for(const bad of ["http://example.com","https://127.0.0.1","https://10.1.2.3","https://169.254.169.254","https://2130706433","https://user:pass@example.com","https://example.com?key=secret","https://example.com#key","https://example.com:8443","https://example.com/a%2fb","https://localhost"]) {
  assert.throws(()=>validateGatewayUrl(bad),undefined,bad);
}
assert.equal(validateGatewayUrl("https://example.com/v1/"),"https://example.com/v1");
await assert.rejects(gatewayJson("https://private.example/v1"),/public IPv4/);
await assert.rejects(gatewayJson("https://mixed.example/v1"),/public IPv4/);
assert.equal(state.calls,0,"Private/mixed DNS rejected before connecting");
assert.deepEqual(await gatewayJson("https://public.example/v1"),{ok:true});
assert.equal(state.pinned,"93.184.216.34","Request pinned to verified address");
state.status=302;
await assert.rejects(gatewayJson("https://public.example/redirect"),/Redirects are not followed/);
assert.equal(state.calls,2,"No second redirect request");
state.status=200;state.text="too large";
await assert.rejects(gatewayJson("https://public.example/large",{maxBytes:2}),/size limit/);
state.text="invalid";
await assert.rejects(gatewayJson("https://public.example/bad"),/valid JSON/);
console.log("Gateway security tests passed: URL restrictions, private/mixed DNS, pinned resolution, redirects, size bounds and invalid JSON. No external traffic.");
