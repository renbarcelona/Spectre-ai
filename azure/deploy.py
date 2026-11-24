"""Guided deployment to pre-provisioned Azure resources; uses existing CLI identity."""
import json, subprocess, sys, pathlib, datetime, urllib.request
root=pathlib.Path(__file__).resolve().parents[1]
def az(*args):
    return subprocess.check_output(["az",*args,"--output","json"],text=True)
config=root/"azure/config.json"
if not config.exists():sys.exit("Copy azure/config.example.json to azure/config.json and supply your existing staging resource names.")
c=json.loads(config.read_text())
for k in ("subscription","resourceGroup","registry","app"):
    if not c.get(k) or "REPLACE" in c[k]:sys.exit("Missing configuration: "+k)
sub=json.loads(az("account","show"))
if sub["id"]!=c["subscription"]:sys.exit("Select the approved subscription with az account set before continuing.")
app=json.loads(az("containerapp","show","-g",c["resourceGroup"],"-n",c["app"]))
registry=json.loads(az("acr","show","-n",c["registry"]))
container=app["properties"]["template"]["containers"]
if len(container)!=1:sys.exit("Expected a single application container. Review multi-container deployment manually.")
env={e["name"]:e for e in container[0].get("env",[])}
required=["DATABASE_URL","SPECTRE_SETUP_CODE","AI_INTEGRATIONS_OPENAI_API_KEY","AI_INTEGRATIONS_OPENAI_BASE_URL","AI_MODEL"]
if any(k not in env for k in required):sys.exit("Configure required runtime variables and Key Vault references first: "+", ".join(required))
for k in ["DATABASE_URL","SPECTRE_SETUP_CODE","AI_INTEGRATIONS_OPENAI_API_KEY"]:
    if not env[k].get("secretRef"):sys.exit(k+" must use a secret reference.")
print("Destination:",c["subscription"],c["resourceGroup"],c["app"])
print("This builds a billable ACR image and replaces the app revision. Drain active scans first.")
if input("Type DEPLOY to authorize: ")!="DEPLOY":sys.exit("Cancelled.")
tag="release-"+datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S")
subprocess.run(["az","acr","build","--registry",c["registry"],"--image","spectre:"+tag,"--file","Dockerfile.azure","."],cwd=root,check=True)
digest=json.loads(az("acr","repository","show","-n",c["registry"],"--image","spectre:"+tag))["digest"]
image=registry["loginServer"]+"/spectre@"+digest
record={"previousImage":container[0]["image"],"newImage":image,"app":c["app"],"resourceGroup":c["resourceGroup"]}
(root/"azure/last-release.json").write_text(json.dumps(record,indent=2))
az("containerapp","update","-g",c["resourceGroup"],"-n",c["app"],"--image",image)
host=app["properties"]["configuration"]["ingress"]["fqdn"]
for path in ("/api/healthz","/api/readyz"):
    with urllib.request.urlopen("https://"+host+path,timeout=20) as r:
        if r.status!=200:raise RuntimeError("Health check failed")
print("Deployed:",image,"\nVerify login, permissions, AI, scans and reports before production approval.")
