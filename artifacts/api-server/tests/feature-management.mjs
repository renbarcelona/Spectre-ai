// Isolated HTTP harness: no live workspace flags, accounts or scan jobs are changed.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const out=mkdtempSync(join(tmpdir(),"spectre-features-"));
try {
  await build({
    stdin:{contents:`
      import express from "express";
      import router from "${root}artifacts/api-server/src/routes/features.ts";
      import {featureGate, blockedFeature, DEFAULT_FEATURES} from "${root}artifacts/api-server/src/lib/features.ts";
      export {blockedFeature, DEFAULT_FEATURES};
      export const app=express(); app.use(express.json());
      app.use((req,res,next)=>{req.teamAccount={role:req.get("x-role")||"readonly",username:"fixture"};next()});
      app.use(router); app.use(featureGate); app.use((req,res)=>res.json({allowed:true}));
    `,resolveDir:root+"artifacts/api-server"},
    bundle:true,platform:"node",format:"esm",external:["express"],outfile:out+"/bundle.mjs",
    plugins:[{name:"isolate-storage",setup(b){
      b.onResolve({filter:/^@workspace\/api-zod$/},()=>({path:root+"lib/api-zod/src/generated/api.ts"}));
      b.onResolve({filter:/\/lib\/assessment$/},()=>({path:"assessment",namespace:"fixture"}));
      b.onResolve({filter:/^\.\/assessment$/},()=>({path:"assessment",namespace:"fixture"}));
      b.onResolve({filter:/team-auth$/},()=>({path:"auth",namespace:"fixture"}));
      b.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path==="auth"?'export const TEAM_SCOPE="fixture";':
        'const state={activity:[]};export async function workspaceOperation(id,fn){return fn(state)};export function activity(s,message){s.activity.push(message)}',loader:"js"}));
    }}],
  });
  // External packages resolve from the workspace, not the temporary output directory.
  const { symlinkSync }=await import("node:fs");
  symlinkSync(root+"artifacts/api-server/node_modules",out+"/node_modules","dir");
  const {app,blockedFeature,DEFAULT_FEATURES}=await import(out+"/bundle.mjs");
  const server=app.listen(0,"127.0.0.1");
  await new Promise(r=>server.once("listening",r));
  try {
    const url=`http://127.0.0.1:${server.address().port}`;
    const request=(path,method="GET",body,role="admin")=>fetch(url+path,{method,headers:{"content-type":"application/json","x-role":role},body:body?JSON.stringify(body):undefined});
    assert.deepEqual(await (await request("/v1/features")).json(),DEFAULT_FEATURES);
    assert.equal((await request("/v1/features","PATCH",{feature:"scans",enabled:false},"readonly")).status,403);
    for(const body of [{feature:"settings",enabled:false},{feature:"scans",enabled:"false"},{}])
      assert.equal((await request("/v1/features","PATCH",body)).status,400);
    for(const feature of Object.keys(DEFAULT_FEATURES)){
      const r=await request("/v1/features","PATCH",{feature,enabled:false});
      assert.equal(r.status,200); assert.equal((await r.json())[feature],false);
      assert.equal((await (await request("/v1/features")).json())[feature],false);
    }
    for(const path of ["/v1/scans","/v1/live/embedded-jobs","/v1/live/jobs","/v1/exercises","/v1/remediations/id","/v1/investigator","/v1/scanner/poll"])
      assert.equal((await request(path,"POST",{})).status,403,path);
    assert.equal((await request("/v1/live")).status,403);
    for(const path of ["/v1/emergency-stop","/v1/live/emergency-stop","/v1/live/jobs/id/cancel","/v1/scanner/result","/v1/settings"])
      assert.equal((await request(path,"POST",{})).status,200,path);
    // Existing evidence remains usable by Reports, without allowing new scans.
    await request("/v1/features","PATCH",{feature:"reports",enabled:true});
    assert.equal((await request("/v1/live")).status,200);
    assert.equal((await request("/v1/live/embedded-jobs","POST",{})).status,403);
    for(const feature of Object.keys(DEFAULT_FEATURES))
      await request("/v1/features","PATCH",{feature,enabled:true});
    assert.deepEqual(await (await request("/v1/features")).json(),DEFAULT_FEATURES);
    assert.equal((await request("/v1/scans","POST",{})).status,200);
    assert.equal(blockedFeature("/v1/investigator","POST",{...DEFAULT_FEATURES,investigator:false}),"investigator");
    console.log("PASS: enabled defaults, admin-only updates, validation, saved reads, six switches, blocked operations, emergency access, shared evidence and re-enabling.");
  } finally { await new Promise(r=>server.close(r)); }
} finally { rmSync(out,{recursive:true,force:true}); }
