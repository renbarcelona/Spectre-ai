// Disposable account fixtures; no target scans or external provider calls.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {randomUUID,randomBytes,scrypt as rawScrypt} from "node:crypto";
import {promisify} from "node:util";
const require=createRequire(new URL("../../../lib/db/package.json",import.meta.url));
const {Pool}=require("pg"),pool=new Pool({connectionString:process.env.DATABASE_URL});
const scrypt=promisify(rawScrypt),ids=[],users=[];
const password=`Fixture-${randomBytes(20).toString("hex")}`;
const newPassword=`Changed-${randomBytes(20).toString("hex")}`;
const base="http://localhost:80/api";
async function call(path,{method="GET",body,cookie="",headers={}}={}){
 const r=await fetch(base+path,{method,headers:{"Content-Type":"application/json",...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const data=await r.json();
 return {status:r.status,data,cookie:r.headers.get("set-cookie")?.match(/sid=([^;]+)/)?.[0]};
}
async function seed(role,mustChangePassword=false){
 const id=randomUUID(),username=`fixture.${id}`;ids.push(id);users.push(username);
 const salt=randomBytes(16).toString("hex");
 const key=await scrypt(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});
 await pool.query("INSERT INTO team_accounts(id,username,display_name,role,password_hash,must_change_password) VALUES($1,$2,'Test Fixture',$3,$4,$5)",[id,username,role,`scrypt$${salt}$${key.toString("hex")}`,mustChangePassword]);
 return {id,username};
}
try{
 const admin=await seed("admin"),readonly=await seed("readonly",true),second=await seed("admin");
 assert.equal((await call("/v1/workspace")).status,401);
 assert.equal((await call("/team-auth/users")).status,401);
 assert.equal((await call("/team-auth/login",{method:"POST",body:{username:admin.username,password:"wrong"}})).status,401);
 const login=await call("/team-auth/login",{method:"POST",body:{username:admin.username,password}});
 assert.equal(login.status,200);const ac=login.cookie;assert.ok(ac);
 assert.equal("password_hash" in login.data,false);
 // Generated action clients omit both body and Content-Type. They must reach
 // the route, but never call a provider here: this connector does not exist.
 const actionPath=base+`/v1/gateway/connectors/${randomUUID()}/test`;
 const action=await fetch(actionPath,{method:"POST",headers:{Cookie:ac}});
 assert.equal(action.status,404,"Bodyless connector tests must reach the gateway, not fail 415");
 assert.equal((await fetch(actionPath,{method:"POST",headers:{Cookie:ac,Origin:"https://untrusted.example"}})).status,403);
 assert.equal((await fetch(actionPath,{method:"POST",headers:{Cookie:ac,"Content-Type":"text/plain"},body:"{}"})).status,415);
 assert.equal((await fetch(actionPath,{method:"POST",headers:{Cookie:ac,"Content-Type":"application/json"}})).status,404);
 assert.equal((await call("/team-auth/users",{cookie:ac})).status,200);
 assert.equal((await call(`/team-auth/users/${admin.id}`,{method:"DELETE",body:{},cookie:ac})).status,409);
 const roLogin=await call("/team-auth/login",{method:"POST",body:{username:readonly.username,password}});
 assert.equal(roLogin.status,200);assert.equal(roLogin.data.mustChangePassword,true);
 assert.equal((await call("/v1/workspace",{cookie:roLogin.cookie})).status,403);
 const change=await call("/team-auth/password",{method:"POST",cookie:roLogin.cookie,body:{currentPassword:password,newPassword}});
 assert.equal(change.status,200);assert.equal(change.data.mustChangePassword,false);
 const rc=change.cookie;assert.notEqual(rc,roLogin.cookie);
 assert.equal((await call("/v1/workspace",{cookie:roLogin.cookie})).status,401);
 const aWorkspace=await call("/v1/workspace",{cookie:ac}),rWorkspace=await call("/v1/workspace",{cookie:rc});
 assert.equal(rWorkspace.status,200);assert.deepEqual(aWorkspace.data.settings,rWorkspace.data.settings);
 assert.equal((await call("/team-auth/users",{cookie:rc})).status,403);
 for(const [method,path] of [["POST","/v1/scans"],["POST","/v1/emergency-stop"],["POST","/v1/live/embedded-jobs"],["POST","/v1/live/targets"],["POST","/v1/investigator"],["POST","/v1/gateway/connectors"],["PATCH","/v1/vulnerabilities/example"],["POST","/team-auth/users"]]){
  assert.equal((await call(path,{method,body:{},cookie:rc})).status,403,`${method} ${path}`);
 }
 assert.equal((await call("/v1/scans",{method:"POST",body:{},cookie:ac,headers:{Origin:"https://untrusted.example"}})).status,403);
 const username=`fixture.${randomUUID()}`;users.push(username);
 const created=await call("/team-auth/users",{method:"POST",cookie:ac,body:{username,displayName:"Created Fixture",role:"readonly",password}});
 assert.equal(created.status,201);ids.push(created.data.id);assert.equal(created.data.mustChangePassword,true);
 assert.equal((await call("/team-auth/users",{method:"POST",cookie:ac,body:{username,displayName:"Duplicate",role:"admin",password}})).status,409);
 const reset=await call(`/team-auth/users/${readonly.id}`,{method:"PATCH",cookie:ac,body:{password}});
 assert.equal(reset.status,200);assert.equal(reset.data.mustChangePassword,true);
 assert.equal((await call("/v1/workspace",{cookie:rc})).status,401);
 const secondLogin=await call("/team-auth/login",{method:"POST",body:{username:second.username,password}});
 assert.equal((await call(`/team-auth/users/${second.id}`,{method:"PATCH",cookie:ac,body:{active:false}})).status,200);
 assert.equal((await call("/v1/workspace",{cookie:secondLogin.cookie})).status,401);
 assert.equal((await call("/team-auth/login",{method:"POST",body:{username:second.username,password}})).status,401);
 assert.equal((await call(`/team-auth/users/${second.id}`,{method:"PATCH",cookie:ac,body:{active:true,role:"readonly",displayName:"Renamed"}})).status,200);
 const active=await call("/team-auth/login",{method:"POST",body:{username:second.username,password}});
 assert.equal(active.data.role,"readonly");
 assert.equal((await call(`/team-auth/users/${created.data.id}`,{method:"DELETE",cookie:ac,body:{}})).status,200);
 assert.equal((await call("/team-auth/logout",{method:"POST",cookie:ac,body:{}})).status,200);
 assert.equal((await call("/v1/workspace",{cookie:ac})).status,401);
 console.log("Team auth API tests passed: login, password hashing/rotation, forced change, shared reads, server-side read-only enforcement, CSRF, account CRUD, reset, activation, session revocation and logout. No scans or external API calls.");
}finally{
 await pool.query("DELETE FROM sessions WHERE sess->'user'->>'id'=ANY($1)",[ids]);
 await pool.query("DELETE FROM team_accounts WHERE id=ANY($1)",[ids]);
 await pool.end();
}
