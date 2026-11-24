import { gatewayJson, GatewayError } from "./gateway-http";
import { isManaged, managedEnv } from "./gateway-catalog";
import { type Connector } from "./gateway-store";
import { isPublicIPv4 } from "./live-discovery";

type ChatMessage = {role:"system"|"user"|"assistant";content:string};
function api(c: Connector) {
  const managed=isManaged(c.provider);
  const base = managed ? process.env[`${managedEnv(c.provider)}_BASE_URL`] : c.baseUrl;
  const key = managed ? process.env[`${managedEnv(c.provider)}_API_KEY`] : c.secretName ? process.env[c.secretName] : undefined;
  if(!base || (c.provider!=="cisa" && !key)) throw new GatewayError(409,"Provider endpoint or credential is not configured.");
  if(key && (/[^\x20-\x7e]/.test(key) || key.length>8192)) throw new GatewayError(400,"Credential format is invalid. Check the workspace secret.");
  return {base:base.replace(/\/$/,""),key:key ?? "",managed};
}
export async function gatewayChat(c:Connector,messages:ChatMessage[], test=false):Promise<string> {
  if(c.kind!=="ai") throw new GatewayError(400,"Select an AI connector, not a threat intelligence connector.");
  const {base,key,managed}=api(c);
  const max = test ? 512 : 4096;
  let result:any, text:string|undefined;
  if(c.provider==="anthropic") {
    result=await gatewayJson(`${base}/v1/messages`,{trustedManaged:managed,headers:{"x-api-key":key,"anthropic-version":"2023-06-01"},body:{
      model:c.model,max_tokens:max,system:messages.filter(m=>m.role==="system").map(m=>m.content).join("\n"),
      messages:messages.filter(m=>m.role!=="system"),
    }});
    text=result.content?.filter((v:any)=>v.type==="text").map((v:any)=>v.text).join("\n");
  } else if(c.provider==="gemini") {
    result=await gatewayJson(`${base}/models/${encodeURIComponent(c.model!)}:generateContent`,{trustedManaged:managed,headers:{"x-goog-api-key":key},body:{
      systemInstruction:{parts:[{text:messages.filter(m=>m.role==="system").map(m=>m.content).join("\n")}]},
      contents:messages.filter(m=>m.role!=="system").map(m=>({role:m.role==="assistant"?"model":"user",parts:[{text:m.content}]})),
      generationConfig:{maxOutputTokens:max},
    }});
    text=result.candidates?.[0]?.content?.parts?.map((v:any)=>v.text??"").join("\n");
  } else {
    result=await gatewayJson(`${base}/chat/completions`,{trustedManaged:managed,headers:{Authorization:`Bearer ${key}`},body:{
      model:c.model,messages,...(c.provider==="openai"?{max_completion_tokens:max}:{max_tokens:max}),
    }});
    text=result.choices?.[0]?.message?.content;
  }
  if(typeof text!=="string" || !text.trim()) throw new GatewayError(502,"Provider returned no text. Verify this model supports the selected text API and output budget.");
  return (key ? text.replaceAll(key,"[REDACTED CREDENTIAL]") : text).slice(0,100_000);
}
export async function gatewayCti(c:Connector,query:string,test=false):Promise<string> {
  const {base,key}=api(c);
  let result:any;
  if(c.provider==="cisa") {
    if(!test && !/^CVE-\d{4}-\d{4,}$/i.test(query)) throw new GatewayError(400,"Enter an exact CVE ID, for example CVE-2021-44228.");
    const feed=await gatewayJson(base,{maxBytes:16_000_000});
    if(!Array.isArray(feed.vulnerabilities)) throw new GatewayError(502,"Unexpected CISA catalog response.");
    result=test ? {catalogVersion:feed.catalogVersion,dateReleased:feed.dateReleased,count:feed.vulnerabilities.length} :
      {source:"CISA KEV",catalogVersion:feed.catalogVersion,dateReleased:feed.dateReleased,matches:feed.vulnerabilities.filter((v:any)=>v.cveID===query.toUpperCase()).slice(0,20),interpretation:"Catalog membership does not establish asset applicability. No match does not mean safe."};
  } else if(["virustotal","abuseipdb","otx"].includes(c.provider)) {
    // Tests use a documented public resolver indicator, not an active scan.
    const ip=test ? "1.1.1.1" : query;
    if(!isPublicIPv4(ip)) throw new GatewayError(400,"Enter one public IPv4 address; private, reserved and documentation ranges are not sent.");
    if(c.provider==="virustotal") {
      result=await gatewayJson(`${base}/ip_addresses/${ip}`,{headers:{"x-apikey":key}});
      if(!result.data?.attributes) throw new GatewayError(502,"Unexpected VirusTotal response.");
    } else if(c.provider==="abuseipdb") {
      result=await gatewayJson(`${base}/check?ipAddress=${ip}&maxAgeInDays=90`,{headers:{Key:key}});
      if(!result.data?.ipAddress) throw new GatewayError(502,"Unexpected AbuseIPDB response.");
    } else {
      result=await gatewayJson(`${base}/indicators/IPv4/${ip}/general`,{headers:{"X-OTX-API-KEY":key}});
      if(!result.pulse_info && !result.indicator) throw new GatewayError(502,"Unexpected OTX response.");
    }
  } else if(c.provider==="misp") {
    if(query.length>200) throw new GatewayError(400,"Indicator search is limited to 200 characters.");
    result=test ? await gatewayJson(`${base}/servers/getVersion`,{headers:{Authorization:key}}) :
      await gatewayJson(`${base}/attributes/restSearch`,{headers:{Authorization:key},body:{returnFormat:"json",value:query,limit:20,page:1}});
    if(result.errors || result.error) throw new GatewayError(502,"MISP rejected the read-only request. Check permissions and API version.");
    if(test ? typeof result.version!=="string" : !Array.isArray(result.response?.Attribute)) throw new GatewayError(502,"Unexpected MISP response. Check API compatibility.");
  } else if(c.provider==="opencti") {
    if(query.length>200) throw new GatewayError(400,"Observable search is limited to 200 characters.");
    result=await gatewayJson(`${base}/graphql`,{headers:{Authorization:`Bearer ${key}`},body:test ? {query:"query { about { version } }"} :
      {query:"query GatewayObservables($search: String!) { stixCyberObservables(search: $search, first: 20) { edges { node { id entity_type observable_value } } } }",variables:{search:query}}});
    if(result.errors || !result.data) throw new GatewayError(502,"OpenCTI rejected the read-only query. Check token permissions and schema compatibility.");
  } else if(c.provider==="taxii") {
    if(!test && !/^[a-zA-Z0-9_.:-]{1,150}$/.test(query)) throw new GatewayError(400,"Enter one collection ID from the connection test.");
    result=await gatewayJson(test ? `${base}/collections/` : `${base}/collections/${encodeURIComponent(query)}/objects/?limit=20`,{headers:{Authorization:key,Accept:"application/taxii+json;version=2.1"}});
    if(test ? !Array.isArray(result.collections) : !Array.isArray(result.objects)) throw new GatewayError(502,"Unexpected TAXII 2.1 response. Check the API root and collection permissions.");
    result=test ? {collections:result.collections.slice(0,20),note:"First 20 collections only."} : {...result,objects:result.objects.slice(0,20),note:"First page only; no background sync or pagination."};
  } else throw new GatewayError(400,"Select a CTI connector.");
  const raw=JSON.stringify(result,null,2);
  const json=key ? raw.replaceAll(key,"[REDACTED CREDENTIAL]") : raw;
  return json.length>100_000 ? json.slice(0,100_000)+"\n[Display truncated at 100,000 characters]" : json;
}
