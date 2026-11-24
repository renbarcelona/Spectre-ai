import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { GatewayError } from "./gateway-http";
import { isManaged, managedReady, type ProviderId, providerFor } from "./gateway-catalog";

export type Connector = {id:string;name:string;provider:ProviderId;kind:"ai"|"cti";baseUrl?:string;model?:string;enabled:boolean;secretName?:string;createdAt:string;revision:number;testedAt?:string;testOk?:boolean};
type Audit = {at:string;connectorId:string;action:string;outcome:string};
export type GatewayData = {connectors:Connector[];audit:Audit[];activeLease?:{id:string;until:number};lastRequest?:number};
export async function gatewayStore<T>(owner: string, fn: (data: GatewayData) => T): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO api_gateway_workspaces(owner_id,data) VALUES($1,$2) ON CONFLICT DO NOTHING",[owner,JSON.stringify({connectors:[],audit:[]})]);
    const result = await client.query("SELECT data FROM api_gateway_workspaces WHERE owner_id=$1 FOR UPDATE",[owner]);
    const data = result.rows[0].data as GatewayData;
    const output = fn(data);
    await client.query("UPDATE api_gateway_workspaces SET data=$2 WHERE owner_id=$1",[owner,JSON.stringify(data)]);
    await client.query("COMMIT"); return output;
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export const credentialReady = (c: Connector) => isManaged(c.provider) ? managedReady(c.provider) : c.provider === "cisa" || !!(c.secretName && process.env[c.secretName]);
export const publicConnector = (c: Connector) => ({...c,credentialReady:credentialReady(c)});
export function gatewayAudit(s: GatewayData, id: string, action: string, outcome: string) {
  s.audit.unshift({at:new Date().toISOString(),connectorId:id,action,outcome});
  s.audit=s.audit.slice(0,100);
}
export async function withGateway<T>(owner: string, id: string, action: "test"|"query"|"investigate", fn:(c:Connector)=>Promise<T>):Promise<T> {
  const lease = randomUUID();
  const c = await gatewayStore(owner,s=>{
    const c=s.connectors.find(c=>c.id===id);
    if(!c) throw new GatewayError(404,"Connector not found.");
    if(action !== "test" && (!c.enabled || !c.testOk)) throw new GatewayError(409,"Test and enable this connector first.");
    if(!credentialReady(c)) throw new GatewayError(409,isManaged(c.provider) ? "Managed integration is not configured. Contact your organization administrator." : "Credential missing. Add the displayed secret in workspace Secrets, then restart the API server.");
    if(s.activeLease && s.activeLease.until>Date.now()) throw new GatewayError(429,"Another gateway request is running for your account.");
    if(s.lastRequest && Date.now()-s.lastRequest<5000) throw new GatewayError(429,"Wait five seconds between gateway requests.");
    s.lastRequest=Date.now(); s.activeLease={id:lease,until:Date.now()+75_000};
    return structuredClone(c);
  });
  let succeeded=false;
  try { const result=await fn(c); succeeded=true; return result; }
  finally {
    await gatewayStore(owner,s=>{
      if(s.activeLease?.id===lease) delete s.activeLease;
      const current=s.connectors.find(item=>item.id===id);
      if(action==="test" && current && current.revision===c.revision) {
        current.testOk=succeeded; current.testedAt=new Date().toISOString();
        if(!succeeded) current.enabled=false;
      }
      gatewayAudit(s,id,action,succeeded ? "Succeeded" : "Failed");
    });
  }
}
export function connectorProvider(c: Connector) { return providerFor(c.provider)!; }
