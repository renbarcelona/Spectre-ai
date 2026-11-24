import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { GetWorkspaceResponse } from "@workspace/api-zod";
import { activeInsightSections } from "./executive-insights";
import { DEFAULT_AI_MODEL } from "./ai-model";

export type Workspace = ReturnType<typeof GetWorkspaceResponse.parse>;

export function seedWorkspace(): Workspace {
  const hosts = ["edge-fw-01","core-sw-01","web-prod-01","dc-primary","db-finance","app-api-01","file-srv-01","dmz-gateway","ws-analyst","print-office"];
  const risks = [45,38,96,92,87,81,76,70,52,31];
  const assets = hosts.map((hostname, i) => ({
    id: `asset-${i+1}`, hostname, ip: `192.168.10.${i+1}`,
    os: i === 3 || i === 6 || i === 8 ? "Windows Server 2019" : "Ubuntu 22.04",
    type: ["router","switch","server","server","server","server","server","router","endpoint","printer"][i]!,
    zone: i === 2 || i === 7 ? "Industrial DMZ" : "Enterprise IT",
    risk: risks[i]!, ports: i === 3 ? [53,88,389,445] : i === 9 ? [631,9100] : [22,80,443],
    recommendation: i === 3 ? "Restrict SMB and validate supported security updates." : "Validate vendor updates and restrict exposed management services.",
  }));
  const examples = [
    ["Apache HTTP Server path traversal","CVE-2021-41773","critical",9.8,true,"T1190",2],
    ["Windows Netlogon elevation of privilege","CVE-2020-1472","critical",10,true,"T1068",3],
    ["PostgreSQL access boundary misconfiguration","Configuration","high",8.7,false,"T1078",4],
    ["Apache Log4j remote code execution","CVE-2021-44228","critical",10,true,"T1190",5],
    ["SMB signing not enforced","Configuration","high",8.1,false,"T1557",6],
    ["Administrative service exposed in DMZ","Configuration","high",7.8,false,"T1021",7],
    ["Legacy TLS configuration","Configuration","medium",5.9,false,"T1040",0],
    ["Excessive workstation privileges","Configuration","medium",5.4,false,"T1078",8],
    ["Printer management access unrestricted","Configuration","low",3.1,false,"T1046",9],
    ["Network segmentation review required","Configuration","medium",5.2,false,"T1046",1],
  ] as const;
  return {
    mode: "demonstration", aiAvailable: true, aiModel: DEFAULT_AI_MODEL, riskScore: 74,
    settings: {organization:"Meridian Enterprise",allowedSubnet:"192.168.10.0/24",notifications:true},
    assets,
    vulnerabilities: examples.map((v,i)=>({
      id:`finding-${i+1}`,assetId:assets[v[6]]!.id,title:v[0],cve:v[1],severity:v[2],score:v[3],kev:v[4],technique:v[5],
      recommendation:v[1].startsWith("CVE") ? `Confirm affected versions against https://nvd.nist.gov/vuln/detail/${v[1]}, then test the vendor-supported update in staging before requesting production approval.` : assets[v[6]]!.recommendation,
      status:"pending",confidence:i===9?62:94-i*2,
    })),
    scans:[{id:"scan-baseline",target:"192.168.10.0/24",type:"subnet",speed:"T3",ports:"1-1024",status:"completed",progress:100,createdAt:new Date().toISOString(),findings:10}],
    activity:[{id:randomUUID(),message:"Demonstration baseline loaded. No network assessment has been performed.",timestamp:new Date().toISOString(),type:"info"}],
    compliance:[{name:"NIST CSF 2.0",score:72,assessed:36,total:50},{name:"ISO 27001:2022",score:68,assessed:63,total:93},{name:"RA 10173",score:81,assessed:17,total:21}],
  };
}

// Row-level transaction serializes mutations and prevents lost updates.
export async function workspaceOperation<T>(id:string, fn:(state:Workspace)=>T):Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO assessment_workspaces (id,data) VALUES ($1,$2) ON CONFLICT DO NOTHING",[id,JSON.stringify(seedWorkspace())]);
    const result = await client.query("SELECT data FROM assessment_workspaces WHERE id=$1 FOR UPDATE",[id]);
    const stored = result.rows[0].data;
    stored.aiModel = DEFAULT_AI_MODEL;
    // Remove retired presentation sections before schema parsing, including old
    // database restores. The transaction persists cleanup without touching evidence.
    if (Array.isArray(stored.executiveInsights?.sections)) {
      stored.executiveInsights.sections = activeInsightSections(stored.executiveInsights.sections);
    }
    const state = GetWorkspaceResponse.parse(stored);
    for (const scan of state.scans) {
      if(scan.status === "running"){
        scan.progress = Math.min(100,Math.floor((Date.now()-new Date(scan.createdAt).getTime())/250));
        if(scan.progress===100){scan.status="completed";scan.findings=state.vulnerabilities.length;}
      }
    }
    const value=fn(state);
    await client.query("UPDATE assessment_workspaces SET data=$2 WHERE id=$1",[id,JSON.stringify(state)]);
    await client.query("COMMIT");
    return value;
  } catch(e){await client.query("ROLLBACK");throw e;} finally{client.release();}
}

export function activity(state:Workspace,message:string,type="info"){
  state.activity.unshift({id:randomUUID(),message,timestamp:new Date().toISOString(),type});
  state.activity=state.activity.slice(0,100);
}
