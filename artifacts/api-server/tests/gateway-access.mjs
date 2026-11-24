import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {randomUUID,randomBytes} from "node:crypto";
const require=createRequire(new URL("../../../lib/db/package.json",import.meta.url));
const {Pool}=require("pg");
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const owners=[`gateway-test-${randomUUID()}`,`gateway-test-${randomUUID()}`];
const sessions=owners.map(()=>randomBytes(32).toString("hex"));
const demos=owners.map(()=>randomUUID());
async function call(path,method="GET",body,who=0){
 const r=await fetch("http://localhost:80/api"+path,{method,headers:{"Content-Type":"application/json",...(who<0?{}:{Cookie:`sid=${sessions[who]}; sentinel_demo=${demos[who]}`})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:r.status,body:await r.json()};
}
try {
 for(let i=0;i<2;i++) await pool.query("INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,$3)",[sessions[i],JSON.stringify({user:{id:owners[i],email:null,firstName:"Gateway",lastName:"Fixture",profileImageUrl:null},access_token:"fixture",expires_at:Math.floor(Date.now()/1000)+3600}),new Date(Date.now()+3600000)]);
 assert.equal((await call("/v1/gateway","GET",undefined,-1)).status,401);
 assert.equal((await call("/v1/gateway/connectors","POST",{name:"No",provider:"cisa"},-1)).status,401);
 const created=await call("/v1/gateway/connectors","POST",{name:"Isolated Access Fixture",provider:"openai"});
 assert.equal(created.status,201);
 const id=created.body.id;
 for(const [method,suffix,body] of [["PATCH","",{name:"Wrong Owner"}],["DELETE",""],["POST","/test"],["POST","/query",{query:"No network should occur"}]]) {
  assert.equal((await call(`/v1/gateway/connectors/${id}${suffix}`,method,body,1)).status,404);
 }
 assert.equal((await call("/v1/investigator","POST",{message:"No network should occur",source:"demo",connectorId:id},1)).status,404);
 assert.equal((await call("/v1/investigator","POST",{message:"No network should occur",source:"demo",connectorId:id},-1)).status,401);
 assert.equal((await call("/v1/gateway","GET",undefined,1)).body.connectors.length,0);
 assert.equal((await call(`/v1/gateway/connectors/${id}/query`,"POST",{query:"No network"})).status,409);
 assert.equal((await call(`/v1/gateway/connectors/${id}`,"PATCH",{enabled:true})).status,409);
 // Seed only this disposable record's test state to verify invalidation; never contact a provider.
 const row=await pool.query("SELECT data FROM api_gateway_workspaces WHERE owner_id=$1",[owners[0]]);
 const data=row.rows[0].data;Object.assign(data.connectors[0],{enabled:true,testOk:true,testedAt:new Date().toISOString()});
 await pool.query("UPDATE api_gateway_workspaces SET data=$2 WHERE owner_id=$1",[owners[0],JSON.stringify(data)]);
 const renamed=await call(`/v1/gateway/connectors/${id}`,"PATCH",{name:"Renamed Fixture"});
 assert.equal(renamed.body.name,"Renamed Fixture");assert.equal(renamed.body.testOk,true);
 const changed=await call(`/v1/gateway/connectors/${id}`,"PATCH",{model:"gpt-5.4"});
 assert.equal(changed.status,200);assert.equal(changed.body.testOk,false);assert.equal(changed.body.enabled,false);
 for(const patch of [{baseUrl:"https://example.com"},{provider:"compatible"},{secretName:"SESSION_SECRET"}]){
  assert.equal((await call(`/v1/gateway/connectors/${id}`,"PATCH",patch)).status,400);
 }
 assert.equal((await call(`/v1/gateway/connectors/${id}`,"DELETE")).status,200);
 assert.equal((await call("/v1/gateway")).body.connectors.length,0);
 console.log("Gateway access tests passed: anonymous guards, cross-owner isolation, enable/query gate, model reset, immutable destinations, rename and delete. No provider calls.");
} finally {
 await pool.query("DELETE FROM api_gateway_workspaces WHERE owner_id=ANY($1)",[owners]);
 await pool.query("DELETE FROM assessment_workspaces WHERE id=ANY($1)",[demos]).catch(()=>{});
 await pool.query("DELETE FROM sessions WHERE sid=ANY($1)",[sessions]);
 await pool.end();
}
