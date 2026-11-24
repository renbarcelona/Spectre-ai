import { Router } from "express";
import { randomUUID } from "node:crypto";
import { CreateGatewayConnectorBody, UpdateGatewayConnectorBody, QueryGatewayConnectorBody } from "@workspace/api-zod";
import { PROVIDERS, providerFor, isManaged, managedReady } from "../lib/gateway-catalog";
import { gatewayStore, gatewayAudit, publicConnector, withGateway, type Connector } from "../lib/gateway-store";
import { GatewayError, validateGatewayUrl } from "../lib/gateway-http";
import { gatewayChat, gatewayCti } from "../lib/gateway-adapters";
import { TEAM_SCOPE } from "../lib/team-auth";

const router=Router();
router.use("/v1/gateway",(req,res,next)=>{
  res.set("Cache-Control","no-store");
  if(!req.isAuthenticated()){res.status(401).json({error:"Sign in to manage your API connections."});return;}
  // Only same-origin browser writes; reject cross-site requests before consuming credentialed services.
  if(req.method!=="GET" && req.headers["sec-fetch-site"]==="cross-site"){res.status(403).json({error:"Cross-site gateway requests are blocked."});return;}
  next();
});
router.get("/v1/gateway",async(req,res,next)=>{
  try {res.json(await gatewayStore(TEAM_SCOPE,s=>({
    connectors:s.connectors.map(publicConnector),audit:s.audit,
    providers:PROVIDERS.map(p=>({...p,ready:isManaged(p.id)?managedReady(p.id):p.id==="cisa"})),
  })));}catch(e){next(e);}
});
router.post("/v1/gateway/connectors",async(req,res,next)=>{
  try {
    const p=CreateGatewayConnectorBody.safeParse(req.body);
    if(!p.success) throw new GatewayError(400,"Enter a connector name and supported provider.");
    const provider=providerFor(p.data.provider)!;
    const name=p.data.name.trim();
    if(!name) throw new GatewayError(400,"Connector name is required.");
    const model=provider.kind==="ai" ? (p.data.model?.trim() || provider.defaultModel) : undefined;
    if(provider.kind==="ai" && (!model || !/^[a-zA-Z0-9_./:@-]{1,120}$/.test(model))) throw new GatewayError(400,"Enter the exact text model ID.");
    const baseUrl=provider.customUrl ? validateGatewayUrl(p.data.baseUrl ?? "") : provider.baseUrl;
    if(!provider.customUrl && p.data.baseUrl && p.data.baseUrl!==provider.baseUrl) throw new GatewayError(400,"This provider uses a fixed, trusted endpoint.");
    const id=randomUUID();
    const c:Connector={id,name,provider:provider.id,kind:provider.kind,model,baseUrl,enabled:false,createdAt:new Date().toISOString(),revision:1,
      ...(!isManaged(provider.id) && provider.id!=="cisa" ? {secretName:`SPECTRE_GATEWAY_${id.replaceAll("-","").toUpperCase()}`} : {})};
    await gatewayStore(TEAM_SCOPE,s=>{
      if(s.connectors.length>=20) throw new GatewayError(409,"Maximum 20 connectors per team workspace.");
      s.connectors.push(c);gatewayAudit(s,id,"create","Saved Disabled");
    });
    res.status(201).json(publicConnector(c));
  }catch(e){next(e);}
});
router.patch("/v1/gateway/connectors/:id",async(req,res,next)=>{
  try {
    const p=UpdateGatewayConnectorBody.safeParse(req.body);
    if(!p.success) throw new GatewayError(400,"Invalid connector changes.");
    if(Object.keys(req.body).some(k=>!["name","model","enabled"].includes(k))) throw new GatewayError(400,"Endpoint, provider and secret binding are immutable; create a new connector to change them.");
    res.json(await gatewayStore(TEAM_SCOPE,s=>{
      const c=s.connectors.find(c=>c.id===req.params.id);
      if(!c)throw new GatewayError(404,"Connector not found.");
      if(s.activeLease && s.activeLease.until>Date.now()) throw new GatewayError(409,"Wait for the active gateway request before editing.");
      if(p.data.name!==undefined) {if(!p.data.name.trim())throw new GatewayError(400,"Name is required.");c.name=p.data.name.trim();}
      if(p.data.model!==undefined && p.data.model!==c.model) {
        if(c.kind!=="ai" || !/^[a-zA-Z0-9_./:@-]{1,120}$/.test(p.data.model)) throw new GatewayError(400,"Invalid text model ID.");
        c.model=p.data.model;c.testOk=false;c.enabled=false;delete c.testedAt;
      }
      if(p.data.enabled===true && (!c.testOk || !publicConnector(c).credentialReady)) throw new GatewayError(409,"A successful connection test and available credential are required before enabling.");
      if(p.data.enabled!==undefined)c.enabled=p.data.enabled;
      c.revision++;gatewayAudit(s,c.id,"update",c.enabled?"Enabled":"Disabled");
      return publicConnector(c);
    }));
  }catch(e){next(e);}
});
router.delete("/v1/gateway/connectors/:id",async(req,res,next)=>{
  try {
    await gatewayStore(TEAM_SCOPE,s=>{
      if(s.activeLease && s.activeLease.until>Date.now())throw new GatewayError(409,"Wait for the active request before removing a connector.");
      const c=s.connectors.find(c=>c.id===req.params.id);
      if(!c)throw new GatewayError(404,"Connector not found.");
      s.connectors=s.connectors.filter(item=>item.id!==c.id);
      gatewayAudit(s,c.id,"delete","Removed");
    });
    res.json({message:"Connector removed. Remove its generated secret separately in workspace Secrets if no longer needed."});
  }catch(e){next(e);}
});
for (const action of ["test","query"] as const) {
  router.post(`/v1/gateway/connectors/:id/${action}`,async(req,res,next)=>{
    try {
      const q=action==="query" ? QueryGatewayConnectorBody.safeParse(req.body) : null;
      if(q && (!q.success || !q.data.query.trim())) throw new GatewayError(400,"Enter a query.");
      const query=q?.success?q.data.query.trim():"";
      const result=await withGateway(TEAM_SCOPE,String(req.params.id),action,c=>c.kind==="ai" ?
        gatewayChat(c,[{role:"system",content:"You are a read-only assistant. Do not claim to run tools, scans or actions."},{role:"user",content:action==="test"?"Reply with Connected. This is a connection test, no other work.":query}],action==="test") :
        gatewayCti(c,query,action==="test"));
      res.json({ok:true,message:action==="test"?"Connection test succeeded. You may now enable this connector.":"Read-only request completed. Verify provenance, freshness and applicability before acting.",resultText:result,at:new Date().toISOString()});
    }catch(e) {
      if(action==="test" && e instanceof GatewayError && e.status>=500) {
        res.json({ok:false,message:e.message,at:new Date().toISOString()});return;
      }
      next(e);
    }
  });
}
router.use("/v1/gateway",(err:unknown,_req:unknown,res:any,_next:unknown)=>{
  res.status(err instanceof GatewayError?err.status:500).json({error:err instanceof GatewayError?err.message:"Gateway request failed. No secrets or provider response bodies are included in error logs."});
});
export default router;
