import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { pool } from "@workspace/db";
import type { Request, Response, NextFunction } from "express";

export const TEAM_SCOPE = "spectre:shared-team";
export type TeamAccount = { id: string; username: string; displayName: string; role: "admin" | "readonly"; active: boolean; mustChangePassword: boolean; createdAt: string };
export const accountColumns = `id, username, display_name AS "displayName", role, active, must_change_password AS "mustChangePassword", created_at AS "createdAt"`;
declare global {
  namespace Express { interface Request { teamAccount?: TeamAccount } }
}
export function passwordValid(password: unknown): password is string {
  return typeof password === "string" && password.length >= 12 && password.length <= 128;
}
const derive = (password: string, salt: string): Promise<Buffer> => new Promise((resolve,reject) => {
  scrypt(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024},(e,key)=>e?reject(e):resolve(key));
});
export async function hashPassword(password: string) {
  const salt=randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await derive(password,salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, stored?: string) {
  const parts=stored?.split("$");
  const salt=parts?.[1] ?? "00000000000000000000000000000000";
  const actual=await derive(password,salt);
  const expected=Buffer.from(parts?.[2] ?? "00".repeat(64),"hex");
  return expected.length===actual.length && timingSafeEqual(expected,actual) && !!stored;
}
export function matchesSetupCode(input: unknown) {
  const expected=process.env.SPECTRE_SETUP_CODE;
  if(!expected || expected.length<24 || typeof input!=="string" || input.length>512) return false;
  const hash=(s:string)=>createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(input),hash(expected));
}
// Persistent counters apply across restarts and processes; never store submitted usernames.
export async function authLimit(req: Request, purpose: string, username="") {
  for(const [value,limit,seconds] of [[`global:${purpose}`,60,60],[`ip:${purpose}:${req.ip}`,60,900],[`account:${purpose}:${username}`,8,900]] as const) {
    const key=createHash("sha256").update(value).digest("hex");
    const r=await pool.query(`INSERT INTO team_auth_limits(key,count,expires_at) VALUES($1,1,NOW()+$2*INTERVAL '1 second')
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN team_auth_limits.expires_at<NOW() THEN 1 ELSE team_auth_limits.count+1 END,
      expires_at=CASE WHEN team_auth_limits.expires_at<NOW() THEN EXCLUDED.expires_at ELSE team_auth_limits.expires_at END RETURNING count`,[key,seconds]);
    if(r.rows[0].count>limit) return false;
  }
  await pool.query("DELETE FROM team_auth_limits WHERE expires_at<NOW()-INTERVAL '1 day'");
  return true;
}
export function sameOriginWrite(req: Request,res: Response,next: NextFunction) {
  res.set("Cache-Control","no-store");
  if(["GET","HEAD","OPTIONS"].includes(req.method)) {next();return;}
  if(req.get("sec-fetch-site")==="cross-site") {res.status(403).json({error:"Cross-site requests are not allowed."});return;}
  const origin=req.get("origin");
  const host=req.get("x-forwarded-host") ?? req.get("host");
  if(origin && (()=>{try{return new URL(origin).host!==host;}catch{return true;}})()) {res.status(403).json({error:"Invalid request origin."});return;}
  // Action endpoints (test, stop, revoke) legitimately POST without a body.
  // Require JSON for payloads, and reject explicitly non-JSON media types even
  // when empty. Origin checks above still apply to bodyless requests.
  const mediaType=req.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const hasPayload=!!req.get("transfer-encoding") || Number(req.get("content-length")??0)>0;
  if(["POST","PUT","PATCH"].includes(req.method)&&(hasPayload||mediaType)&&mediaType!=="application/json") {
    res.status(415).json({error:"Use application/json."});return;
  }
  next();
}
export function requireTeam(req: Request,res: Response,next: NextFunction) {
  res.set("Cache-Control","no-store");
  if(!req.teamAccount){res.status(401).json({error:"Sign in with a SPECTRE team account."});return;}
  if(req.teamAccount.mustChangePassword){res.status(403).json({error:"Change your temporary password before entering the platform."});return;}
  next();
}
export function teamPlatformGate(req: Request,res: Response,next: NextFunction) {
  // External workers retain their own scoped token authentication in their routes.
  if(req.path==="/scanner/poll" || req.path==="/scanner/result") {next();return;}
  requireTeam(req,res,()=>{
    if(req.teamAccount!.role!=="admin" && !["GET","HEAD","OPTIONS"].includes(req.method)){
      res.status(403).json({error:"Read-only account. An administrator is required for this action."});return;
    }
    sameOriginWrite(req,res,next);
  });
}
