import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { accountColumns, authLimit, hashPassword, matchesSetupCode, passwordValid, requireTeam, sameOriginWrite, verifyPassword } from "../lib/team-auth";
import { clearSession, createSession, getSessionId, SESSION_COOKIE } from "../lib/auth";

const router=Router();
router.use("/team-auth",sameOriginWrite);
const SESSION_MS=8*60*60*1000;
async function signIn(req:Request,res:Response,row:any){
  const old=getSessionId(req);
  if(old) await clearSession(res,old);
  const sid=await createSession({kind:"local",version:row.session_version,access_token:"local",
    expires_at:Math.floor((Date.now()+SESSION_MS)/1000),
    user:{id:row.id,email:null,firstName:row.displayName,lastName:null,profileImageUrl:null}});
  await pool.query("UPDATE sessions SET expire=$2 WHERE sid=$1",[sid,new Date(Date.now()+SESSION_MS)]);
  res.cookie(SESSION_COOKIE,sid,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:SESSION_MS});
}
function publicAccount(row:any){ const {password_hash:_hash,session_version:_version,...safe}=row;return safe; }
const validName=(v:unknown):v is string=>typeof v==="string"&&v.trim().length>0&&v.trim().length<=80;
const validUsername=(v:unknown):v is string=>typeof v==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9._@-]{2,79}$/.test(v);
async function limited(req:Request,res:Response,purpose:string,user:string){
  if(await authLimit(req,purpose,user)) return false;
  res.set("Retry-After","900").status(429).json({error:"Too many attempts. Try again in 15 minutes."});return true;
}
router.get("/team-auth/status",async(req,res)=>{
  const rows=await pool.query("SELECT 1 FROM team_accounts LIMIT 1");
  res.json({setupRequired:!rows.rowCount,setupReady:(process.env.SPECTRE_SETUP_CODE?.length??0)>=24,user:req.teamAccount??null});
});
router.post("/team-auth/login",async(req,res)=>{
  const username=typeof req.body?.username==="string"?req.body.username.trim().toLowerCase():"";
  if(await limited(req,res,"login",username))return;
  const password=req.body?.password;
  if(!validUsername(username)||typeof password!=="string"||password.length>128){res.status(401).json({error:"Invalid username or password."});return;}
  const r=await pool.query(`SELECT ${accountColumns},password_hash,session_version FROM team_accounts WHERE username=$1`,[username]);
  const row=r.rows[0];
  if(!await verifyPassword(password,row?.password_hash)||!row?.active){res.status(401).json({error:"Invalid username or password."});return;}
  // Re-check version after password verification so an administrator's concurrent reset wins.
  const current=await pool.query("SELECT 1 FROM team_accounts WHERE id=$1 AND active AND session_version=$2",[row.id,row.session_version]);
  if(!current.rowCount){res.status(401).json({error:"Account changed. Sign in again."});return;}
  await signIn(req,res,row);res.json(publicAccount(row));
});
router.post("/team-auth/setup",async(req,res)=>{
  if(await limited(req,res,"setup","first-admin"))return;
  if(!matchesSetupCode(req.body?.setupCode)){res.status(403).json({error:"Invalid or unavailable setup code. Configure SPECTRE_SETUP_CODE in workspace Secrets (at least 24 characters)."});return;}
  const {username,displayName,password}=req.body??{};
  if(!validUsername(username)||!validName(displayName)||!passwordValid(password)){res.status(400).json({error:"Provide a valid username, display name, and a password of 12–128 characters."});return;}
  const hashed=await hashPassword(password);
  const client=await pool.connect();
  try{
    await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(8711401)");
    if((await client.query("SELECT 1 FROM team_accounts LIMIT 1")).rowCount){await client.query("ROLLBACK");res.status(409).json({error:"Setup is already complete. Sign in."});return;}
    const r=await client.query(`INSERT INTO team_accounts(id,username,display_name,role,password_hash,must_change_password)
      VALUES($1,$2,$3,'admin',$4,false) RETURNING ${accountColumns},session_version`,[randomUUID(),username.toLowerCase(),displayName.trim(),hashed]);
    await client.query("COMMIT");await signIn(req,res,r.rows[0]);res.status(201).json(publicAccount(r.rows[0]));
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
});
router.post("/team-auth/logout",async(req,res)=>{await clearSession(res,getSessionId(req));res.json({ok:true});});
router.post("/team-auth/password",async(req,res)=>{
  const account=req.teamAccount;
  if(!account){res.status(401).json({error:"Sign in first."});return;}
  if(await limited(req,res,"password",account.id))return;
  const {currentPassword,newPassword}=req.body??{};
  if(typeof currentPassword!=="string"||currentPassword.length>128||!passwordValid(newPassword)||currentPassword===newPassword){res.status(400).json({error:"Use a different password of 12–128 characters."});return;}
  const old=(await pool.query("SELECT password_hash,session_version FROM team_accounts WHERE id=$1",[account.id])).rows[0];
  if(!await verifyPassword(currentPassword,old?.password_hash)){res.status(400).json({error:"Current password is incorrect."});return;}
  const hashed=await hashPassword(newPassword);
  const r=await pool.query(`UPDATE team_accounts SET password_hash=$2,must_change_password=false,session_version=session_version+1
    WHERE id=$1 AND active AND session_version=$3 RETURNING ${accountColumns},session_version`,[account.id,hashed,old.session_version]);
  if(!r.rowCount){res.status(409).json({error:"Account changed. Sign in again."});return;}
  await pool.query("DELETE FROM sessions WHERE sess->'user'->>'id'=$1",[account.id]);
  await signIn(req,res,r.rows[0]);res.json(publicAccount(r.rows[0]));
});
router.use("/team-auth/users",requireTeam,(req,res,next)=>{
  if(req.teamAccount!.role!=="admin"){res.status(403).json({error:"Administrator access is required."});return;}next();
});
router.get("/team-auth/users",async(_req,res)=>{res.json((await pool.query(`SELECT ${accountColumns} FROM team_accounts ORDER BY created_at`)).rows);});
router.post("/team-auth/users",async(req,res)=>{
  if(await limited(req,res,"manage",req.teamAccount!.id))return;
  const {username,displayName,role,password}=req.body??{};
  if(!validUsername(username)||!validName(displayName)||!["admin","readonly"].includes(role)||!passwordValid(password)){res.status(400).json({error:"Provide a valid username, display name, role, and password of 12–128 characters."});return;}
  const hashed=await hashPassword(password);
  try{
    const r=await pool.query(`INSERT INTO team_accounts(id,username,display_name,role,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING ${accountColumns}`,
      [randomUUID(),username.toLowerCase(),displayName.trim(),role,hashed]);
    res.status(201).json(r.rows[0]);
  }catch(e:any){if(e.code==="23505"){res.status(409).json({error:"That username is already in use."});return;}throw e;}
});
router.all("/team-auth/users/:id",async(req,res,next)=>{
  if(!["PATCH","DELETE"].includes(req.method)){next();return;}
  const id=String(req.params.id), input=req.body??{};
  if(id===req.teamAccount!.id && (req.method==="DELETE"||input.active===false||input.role==="readonly"||input.password!==undefined)){
    res.status(409).json({error:"You cannot delete, deactivate, demote or reset your own account here. Use Change Password for your password."});return;
  }
  if(req.method==="PATCH"&&(Object.keys(input).some(k=>!["displayName","role","active","password"].includes(k))||
    (input.displayName!==undefined&&!validName(input.displayName))||(input.role!==undefined&&!["admin","readonly"].includes(input.role))||
    (input.active!==undefined&&typeof input.active!=="boolean")||(input.password!==undefined&&!passwordValid(input.password)))){
    res.status(400).json({error:"Invalid account changes."});return;
  }
  if(input.password && await limited(req,res,"manage",req.teamAccount!.id))return;
  const hashed=input.password?await hashPassword(input.password):null;
  const client=await pool.connect();
  try{
    await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(8711401)");
    // Revalidate administrator authority inside the same lock used by role changes.
    const actor=(await client.query("SELECT role,active FROM team_accounts WHERE id=$1",[req.teamAccount!.id])).rows[0];
    if(!actor?.active||actor.role!=="admin"){await client.query("ROLLBACK");res.status(403).json({error:"Administrator access is required."});return;}
    const old=(await client.query("SELECT * FROM team_accounts WHERE id=$1 FOR UPDATE",[id])).rows[0];
    if(!old){await client.query("ROLLBACK");res.status(404).json({error:"Account not found."});return;}
    if(old.active&&old.role==="admin"&&(req.method==="DELETE"||input.active===false||input.role==="readonly")){
      const count=await client.query("SELECT count(*)::int AS n FROM team_accounts WHERE active AND role='admin'");
      if(count.rows[0].n<=1){await client.query("ROLLBACK");res.status(409).json({error:"At least one active administrator must remain."});return;}
    }
    let updated;
    if(req.method==="DELETE") await client.query("DELETE FROM team_accounts WHERE id=$1",[id]);
    else updated=(await client.query(`UPDATE team_accounts SET display_name=$2,role=$3,active=$4,password_hash=$5,
      must_change_password=$6,session_version=session_version+1 WHERE id=$1 RETURNING ${accountColumns}`,
      [id,input.displayName?.trim()??old.display_name,input.role??old.role,input.active??old.active,hashed??old.password_hash,
       hashed?true:old.must_change_password])).rows[0];
    await client.query("DELETE FROM sessions WHERE sess->'user'->>'id'=$1",[id]);
    await client.query("COMMIT");res.json(updated??{ok:true});
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
});
router.use((_error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
  res.status(500).json({error:"Account service is unavailable. Please try again."});
});
export default router;
