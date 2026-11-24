# 1. Purpose, Scope And Deployment Status

This guide accompanies the refreshed SPECTRE AI source export. It explains how to import the source, build an image and operate the platform on Azure Container Apps, an Azure Virtual Machine, Azure Container Instances (ACI), or Azure App Service. Container Instances and App Service are both covered because “app instance” can refer to either. No GitHub account or repository is required.

The archive contains current workspace source, including Feature Management, live-scan report generation, corporate report styling and the interactive live NetMapper. It includes destination-specific portability adaptations. This is not a running Azure installation, an Azure certification or a one-click production deployment. No Azure subscription was accessed, infrastructure provisioned, Docker image executed or live Azure acceptance test performed during export.

Use a staging environment first. Commands incur Azure charges when you execute them. Replace example names and approve the subscription, region, network boundaries and budget before proceeding. Commands use Bash syntax; on Windows use Azure Cloud Shell Bash or WSL, not unmodified PowerShell. Illustrations are procedure diagrams, not screenshots of your Azure tenant.

## Recommended Hosting Choice

| Target | Recommended Use And Important Constraint |
| --- | --- |
| Azure Container Apps | Preferred managed hosting: HTTPS ingress, revision-based releases, Key Vault secret references. Keep exactly one replica while embedded jobs and AI throttles are process-local. |
| Azure VM | Best when OS-level control, fixed scan egress and network troubleshooting are priorities. You manage OS security, Docker, certificates and recovery. |
| Azure Container Instances | Suitable for isolated staging or specific container workloads. ACI is not a complete production web platform; private networking and a separate HTTPS gateway are required by this guide. |
| Azure App Service | Suitable for the web/API application. Validate Python subprocess execution and outbound TCP/UDP scanning in your selected plan before relying on live checks. |

![Proposed Azure Application Architecture](az-architecture)

# 2. Package Contents And Import

1. Download SPECTRE_AI_Azure_Deployment_Package.zip to an approved workstation.
2. Extract it. Open the spectre folder; this is the build context. Do not run build commands from its parent.
3. Read START-HERE.md and API-README.md. The latter describes model behavior, request structure, credentials by name and limits.
4. Review SOURCE-EXPORT.json for export time, source commit and the notice that current uncommitted workspace changes are included.
5. Verify SHA256SUMS.json before changing any files. It lists hashes for every payload file except the checksum manifest itself.

```bash
unzip SPECTRE_AI_Azure_Deployment_Package.zip
cd spectre
python3 - <<'PY'
import hashlib, json
from pathlib import Path
for name, expected in json.loads(Path("SHA256SUMS.json").read_text()).items():
    actual = hashlib.sha256(Path(name).read_bytes()).hexdigest()
    assert actual == expected, name
print("All payload hashes match")
PY
```

The source includes artifacts/sentinel, artifacts/api-server, shared lib packages, the dependency lockfile, Dockerfile.azure, azure/deploy.py and the deployment directory. node_modules, compiled dist output, local environment secrets, database exports and user account data are not included.

The Word/PDF guide is enclosed in the ZIP and supplied separately for convenient reading. DEPLOYMENT-GUIDE.md is the editable procedure source. Hash validation detects accidental corruption, not publisher authenticity: keep the archive and its checksum in an approved artifact repository.

## Portability Adaptations

The exported API serves the built React application and API from one origin on port 8080. It adds /api/readyz, enables certificate-verified PostgreSQL TLS, disables legacy Replit login/logout routes, retains local SPECTRE team accounts, and selects the default AI model through AI_MODEL. The three frontend consumers of Replit's authentication helper use an exported local-team adapter instead. The running Replit project is not converted by the export.

Microsoft Entra SSO is not implemented. Optional external fonts, threat-map embeds and CTI endpoints are still external dependencies; review them for a Microsoft-only policy. Replit-managed AI credentials are not transferable Azure credentials.

# 3. Prepare Azure Access And Resource Names

1. Obtain an Azure subscription with an approved spending limit and a supported region.
2. Ask the Azure administrator for scoped resource deployment permission and permission to assign managed-identity roles. Contributor alone does not necessarily permit role assignments.
3. Install current Azure CLI, Python 3, unzip and curl. Docker is needed only for VM operation or local image testing; ACR can build remotely.
4. Sign in interactively. Never place passwords, access tokens or keys in this guide or source repository.

```bash
az login
az account list --output table
az account set --subscription "REPLACE_SUBSCRIPTION_ID"
az account show --query "{Name:name,Id:id}" --output table
az extension add --name containerapp --upgrade

export RG="spectre-staging-rg"
export LOCATION="southeastasia"
export ACR="REPLACE_GLOBALLY_UNIQUE_REGISTRY"
export APP="spectre-staging"
export ENV="spectre-staging-env"
export IDENTITY="spectre-runtime"
export KV="REPLACE_UNIQUE_KEYVAULT"
export TAG="release-REPLACE_TIMESTAMP"

az group create --name "$RG" --location "$LOCATION"
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.ContainerRegistry
az provider register --namespace Microsoft.ContainerInstance
az provider register --namespace Microsoft.Web
az provider register --namespace Microsoft.DBforPostgreSQL
```

Choose registry and vault names that comply with Azure naming rules. Confirm provider registration has completed before provisioning dependent resources. Cloud Shell is convenient for control-plane commands, but standard Cloud Shell does not automatically have access to a private PostgreSQL network; use a private runner or administration VM for database work.

# 4. Network And Security Prerequisites

1. Plan one Azure virtual network with separate subnets for the chosen app platform, private database access, administration and any Application Gateway.
2. For Container Apps, create a workload-profiles environment integrated with a supported subnet. For ACI, dedicate a subnet delegated to Microsoft.ContainerInstance/containerGroups. Do not share those platform subnets.
3. Create PostgreSQL with private access/private endpoint as appropriate to the selected networking model and link the corresponding private DNS zone to the runtime VNet.
4. Permit runtime-to-database TCP 5432 and required outbound HTTPS for AI. Resolve the database's normal fully qualified domain name to its approved private address.
5. For controlled public scanning, use supported VNet/NAT configuration and a stable approved egress IP. Obtain written target authorization before testing. Actual egress restrictions vary by Azure service and plan.
6. Do not expose PostgreSQL publicly or use an “allow all Azure services” firewall rule as a substitute for private connectivity.
7. Permit administrator access through Bastion/VPN where possible. Never expose SSH globally or publish application port 8080 directly to internet users.

Only bounded authorized public IPv4 TCP/UDP checks are supported by the embedded engine. No privileged container, raw-socket scanner or full vulnerability scanner is added by migration. UDP silence remains ambiguous. The NetMapper shows logical associations, not measured router paths.

# 5. Configure PostgreSQL

1. In Azure Portal select Create A Resource, Azure Database For PostgreSQL Flexible Server.
2. Select the approved subscription, resource group, region and a supported PostgreSQL version compatible with your source database.
3. Configure compute/storage, backups, retention and private networking. Enable production resilience according to policy; do not infer recovery guarantees from this source package.
4. Record the server FQDN. Create a database named spectre and a dedicated application database role. Use separate migration and runtime roles for production.
5. The bootstrap role must be allowed to create required schema objects. After bootstrap, the runtime needs appropriate table/sequence access and may need startup DDL permission for the application's existing ensure-table logic; test least-privilege grants before revoking privileges.
6. Use TLS with certificate verification. The exported Node PostgreSQL pool explicitly sets rejectUnauthorized=true. Do not add sslmode=require, disable certificate checks or replace verification with rejectUnauthorized=false.

The DATABASE_URL secret follows this shape:

```text
postgresql://USER:URL_ENCODED_PASSWORD@SERVER.postgres.database.azure.com:5432/spectre
```

Percent-encode reserved characters in the username/password. Do not append SSL query parameters that override the pool's TLS configuration. Use an approved CA chain; the image installs system CA certificates. If your organization introduces a private CA, supply and test its trusted certificate through a controlled image/configuration change.

## Choose Fresh Installation Or Migration

Fresh installation: initialize only an empty database using deployment/init-db.mjs after building the image. The helper checks for existing user tables and refuses initialization when any exist.

Existing installation: restore an approved backup instead. Do not run the empty-database helper or a destructive schema push against restored data. Review schema differences using the exported lib/db schema and existing startup logic. Feature Management uses the existing workspace JSON record, not a separate new table.

# 6. Migrate Existing Records Safely

![Database Migration And Cutover Procedure](az-migration)

1. Inventory the source database version, extensions, schema, approximate size and data owners. Keep records of the export authorization.
2. Put the source into an approved maintenance window. Stop new writes and drain active embedded scans and demo exercises. Feature disabling alone does not cancel already submitted work.
3. From a trusted host with source access, create a custom-format PostgreSQL backup. Use a protected PostgreSQL service/password file rather than exposing credentials in command history.

```bash
pg_dump --dbname="service=spectre_source" \
  --format=custom --no-owner --no-acl \
  --file=spectre-approved-backup.dump

pg_restore --dbname="service=spectre_destination" \
  --no-owner --no-acl --exit-on-error \
  spectre-approved-backup.dump
```

4. Use client tooling compatible with the source/destination PostgreSQL versions. The destination should be an empty migration database. Configure sslmode=verify-full and trusted root settings in the client service definition.
5. Transfer the dump through approved encrypted storage, limit access and remove it after the retention window. It can contain password hashes, sessions, targets, findings and raw evidence; it is not source code.
6. Compare source/destination row counts and representative records for assessment_workspaces, live scan state, gateway configuration, accounts and session-related tables. Inventory actual table names from lib/db/src/schema; do not assume the list is exhaustive.
7. Invalidate migrated sessions using a reviewed administrative procedure. Preserve account password hashes unless an approved reset is required; never manually replace credentials.
8. Review imported scope authorization expiry, feature flags and gateway secret references. Provision corresponding secret values separately on Azure.
9. Retain the source read-only until acceptance. Never allow both environments to accept independent writes after cutover.

# 7. Configure Azure AI And Runtime Secrets

1. Provision an approved Azure OpenAI resource and deploy a chat model with the required quota.
2. Choose a deployment name such as spectre-chat. AI_MODEL must equal the actual Azure deployment name, not necessarily the underlying model family.
3. Configure the Azure OpenAI v1 base URL, without a trailing slash: https://YOUR_RESOURCE.openai.azure.com/openai/v1.
4. Obtain the destination credential through Azure's approved key-management process. The current application uses API-key authentication for this client; managed identity for registry or Key Vault access does not automatically authenticate AI calls.
5. Use a model compatible with the exported Chat Completions call and request parameters. Validate an actual AI Investigator request; the “Available” badge is not an inference health test.
6. Configure additional gateway/CTI connectors separately. API Settings shows the exact secret variable names for each connector. Do not assume the default AI key grants access to other providers.

| Runtime Variable | Configuration |
| --- | --- |
| NODE_ENV | production |
| PORT | 8080 |
| STATIC_DIR | /app/artifacts/sentinel/dist/public |
| DATABASE_URL | Secret: encoded PostgreSQL connection URL |
| SPECTRE_SETUP_CODE | Secret: long randomly generated first-admin setup code |
| AI_INTEGRATIONS_OPENAI_BASE_URL | Azure OpenAI v1 endpoint |
| AI_INTEGRATIONS_OPENAI_API_KEY | Secret: destination AI key |
| AI_MODEL | Actual Azure model deployment name |

Store secret values in Key Vault through its Portal secret form or an approved secret pipeline. Do not put them in source, screenshots, deployment tickets or CLI output. Keep the setup code available only to the authorized first administrator. Existing migrated installations retain their accounts; setup does not replace them.

Create a user-assigned identity and a registry. The following nonsecret commands are examples:

```bash
az acr create -g "$RG" -n "$ACR" --sku Basic
az identity create -g "$RG" -n "$IDENTITY"
export ID=$(az identity show -g "$RG" -n "$IDENTITY" --query id -o tsv)
export PRINCIPAL=$(az identity show -g "$RG" -n "$IDENTITY" --query principalId -o tsv)
export REGISTRY_ID=$(az acr show -n "$ACR" --query id -o tsv)
export LOGIN=$(az acr show -n "$ACR" --query loginServer -o tsv)
az role assignment create --assignee-object-id "$PRINCIPAL" \
  --assignee-principal-type ServicePrincipal --role AcrPull \
  --scope "$REGISTRY_ID"
```

Basic ACR is a staging example with a public registry endpoint protected by Azure identity; use Premium/private endpoints if policy requires private registry access. For registries using ABAC repository permissions, use the applicable repository-reader role instead of assuming AcrPull is sufficient.

Create a Key Vault using Azure RBAC, enable appropriate recovery protections and grant the runtime identity Key Vault Secrets User at the required scope. A secret administrator needs separate secret-write permissions. Create database-url, ai-key and setup-code secrets. Use the vault's actual secret URIs, never secret values, in the Container Apps/App Service configuration.

# 8. Build The Image Without GitHub

1. From the extracted spectre directory, review Dockerfile.azure and .dockerignore.
2. Build on Azure Container Registry. This uploads the selected source build context and runs dependency installation, library checks, application type checks and both builds.

```bash
az acr build --registry "$ACR" \
  --image "spectre:$TAG" --file Dockerfile.azure .
export DIGEST=$(az acr repository show -n "$ACR" \
  --image "spectre:$TAG" --query digest -o tsv)
export IMAGE="$LOGIN/spectre@$DIGEST"
printf '%s\n' "$IMAGE"
```

3. Record the immutable image digest in the release ticket. Prefer deployment by digest over a mutable latest tag.
4. Review ACR build output and organizational vulnerability/image scanning results. A successful build is not proof that database, AI or live scanning works.
5. The runtime includes Node 24, Python 3, CA certificates and tini. It runs as a non-root user. Do not enable privileged mode.
6. Pin organizationally approved base image digests before production. The package uses upstream tags to remain buildable, not a frozen supply-chain attestation.

No database or API secret is needed during the image build. Never place populated runtime.env files, dumps or credentials into the build context. The archive's .dockerignore excludes common secret and generated-file locations; independently inspect any files you add.

# 9. Initialize A Fresh Database

Perform this step from an approved Docker-capable host with network access to the private database. A Windows workstation without VNet connectivity cannot initialize it just because the image exists in ACR.

1. Authenticate to ACR on the trusted host. For an Azure VM with the assigned identity, use az login --identity --client-id followed by the identity client ID, then az acr login --name followed by the registry name.
2. Copy deployment/runtime.env.example to deployment/.env.runtime on that host only. Populate values from the approved vault workflow and set file permissions to owner-only.
3. Run the empty-database initialization helper:

```bash
chmod 600 deployment/.env.runtime
docker pull "$IMAGE"
docker run --rm --env-file deployment/.env.runtime \
  --entrypoint node "$IMAGE" deployment/init-db.mjs
```

4. Review the proposed Drizzle schema operation interactively; do not add --force. Stop if the empty-database check refuses initialization.
5. Verify expected tables exist and the runtime role has appropriate access. Remove temporary secret files from the runner when no longer needed.

For ongoing upgrades, use reviewed migrations and tested backups, not this initialization helper.

# 10. Deploy To Azure Container Apps

1. In Azure Portal create a Container Apps Environment in the approved VNet/subnet. Choose workload profiles and any required NAT/private DNS connectivity. Record its name as ENV.
2. Confirm the user-assigned identity has registry pull and Key Vault secret-read permissions. Allow role assignments time to propagate.
3. Create the Container App using the image digest, managed identity, secret references and port 8080:

```bash
export DB_SECRET_URI="https://YOUR_VAULT.vault.azure.net/secrets/database-url"
export AI_SECRET_URI="https://YOUR_VAULT.vault.azure.net/secrets/ai-key"
export SETUP_SECRET_URI="https://YOUR_VAULT.vault.azure.net/secrets/setup-code"
export AI_BASE="https://YOUR_AI_RESOURCE.openai.azure.com/openai/v1"
export MODEL="YOUR_MODEL_DEPLOYMENT"

az containerapp create -g "$RG" -n "$APP" \
  --environment "$ENV" --image "$IMAGE" \
  --user-assigned "$ID" --registry-server "$LOGIN" \
  --registry-identity "$ID" --ingress external --target-port 8080 \
  --min-replicas 1 --max-replicas 1 --cpu 1 --memory 2Gi \
  --secrets "database-url=keyvaultref:$DB_SECRET_URI,identityref:$ID" \
    "ai-key=keyvaultref:$AI_SECRET_URI,identityref:$ID" \
    "setup-code=keyvaultref:$SETUP_SECRET_URI,identityref:$ID" \
  --env-vars NODE_ENV=production PORT=8080 \
    STATIC_DIR=/app/artifacts/sentinel/dist/public \
    DATABASE_URL=secretref:database-url \
    SPECTRE_SETUP_CODE=secretref:setup-code \
    AI_INTEGRATIONS_OPENAI_API_KEY=secretref:ai-key \
    "AI_INTEGRATIONS_OPENAI_BASE_URL=$AI_BASE" "AI_MODEL=$MODEL"
```

4. External ingress exposes the sign-in page publicly through HTTPS. Use internal ingress instead where policy requires a private service, and provide an approved private access path. Do not enable insecure HTTP ingress.
5. In Containers → Health Probes configure startup/liveness on /api/healthz and readiness on /api/readyz, all targeting HTTP port 8080. Allow adequate startup time.
6. Use single revision mode for normal operation. During releases, drain in-process scans; old/new revision overlap can still occur even with one replica per revision.
7. In Ingress configure the custom hostname and supported managed certificate, or use the provided HTTPS hostname for staging. Validate DNS ownership.
8. Open Log Stream, check application startup, then run the acceptance chapter.

## Subsequent Guided Releases

Copy azure/config.example.json to azure/config.json and fill the existing subscription/resource-group/registry/app names. Run python3 azure/deploy.py. The script checks prerequisites, asks for DEPLOY confirmation, builds remotely and updates the image by digest. It is not an infrastructure bootstrapper or database migration tool.

The immediate health check can fail while a revision starts. Inspect revision health and logs rather than repeatedly deploying or assuming automatic rollback. Azure must be tested in your tenant before declaring the release successful.

# 11. Deploy To An Azure Virtual Machine

1. Create an Ubuntu LTS VM in the approved VNet with private database reachability. A practical staging starting point is 2–4 vCPU and 4–8 GB RAM; measure actual workload needs.
2. Use managed disks, patching, backup policy and Bastion/VPN administration. Assign the user-managed runtime identity and the registry pull role.
3. Install Docker Engine and the Compose plugin following Docker's current Ubuntu instructions. Install Azure CLI and Python 3. Confirm docker version and docker compose version.
4. Copy the extracted package to /opt/spectre using approved transfer tooling. No Git repository is required.
5. Authenticate the VM to Azure with its managed identity and authenticate Docker to ACR. Avoid long-lived registry administrator passwords.
6. Initialize or restore the database as described earlier.
7. In /opt/spectre/deployment copy runtime.env.example to .env.runtime, populate secrets and protect it. Create release.env containing nonsecret deployment values:

```text
SPECTRE_IMAGE=YOUR_REGISTRY.azurecr.io/spectre@sha256:YOUR_DIGEST
SPECTRE_DOMAIN=spectre.YOUR_DOMAIN
ACME_EMAIL=YOUR_CERTIFICATE_OPERATIONS_EMAIL
```

8. Create a DNS A record pointing to the VM's static public IP, unless your approved architecture uses a private reverse proxy instead. Permit TCP 80/443 for the bundled Caddy public-certificate flow. Remove incorrect AAAA records. Do not publish port 8080.
9. Start the included composition from the deployment directory:

```bash
cd /opt/spectre/deployment
chmod 600 .env.runtime
docker compose --env-file release.env -f compose.vm.yaml pull
docker compose --env-file release.env -f compose.vm.yaml up -d --wait
docker compose --env-file release.env -f compose.vm.yaml ps
docker compose --env-file release.env -f compose.vm.yaml logs --tail=100 app
```

10. Open https://YOUR_DOMAIN and verify /api/healthz and /api/readyz. Caddy terminates HTTPS and forwards to the non-public app container.

The VM template supplies one reverse proxy hop, matching the exported trust-proxy setting. Adding Front Door or Application Gateway introduces another proxy layer; review forwarded-header trust rather than copying the setting blindly. Runtime environment files are local secrets, not encrypted Key Vault storage. Protect the disk and administrators; implement a reviewed retrieval/rotation process. Caddy data volumes retain certificates across container replacement.

Do not use docker compose down --volumes for routine releases. That removes persistent proxy certificate volumes. PostgreSQL remains external to this composition.

# 12. Deploy To Azure Container Instances

ACI requires extra networking/TLS work. Use it for controlled staging unless a complete production availability and HTTPS design is approved. It does not provide Container Apps revision routing or App Service features.

1. Create a dedicated subnet delegated to Microsoft.ContainerInstance/containerGroups. Establish outbound NAT and private DNS/database reachability according to current ACI networking requirements.
2. Use a user-assigned managed identity for ACR image pulls. System-assigned identity is not supported for ACI's ACR pull authentication.
3. Prepare an ACI YAML file locally using the following structure. Replace every REPLACE value. Supply actual secureValue entries only on the approved deployment host, with mode 600; never commit the populated file.

```yaml
apiVersion: '2023-05-01'
location: REPLACE_AZURE_REGION
name: spectre-aci
identity:
  type: UserAssigned
  userAssignedIdentities:
    REPLACE_IDENTITY_RESOURCE_ID: {}
properties:
  osType: Linux
  restartPolicy: Always
  subnetIds:
    - id: REPLACE_DELEGATED_SUBNET_RESOURCE_ID
  imageRegistryCredentials:
    - server: REPLACE_REGISTRY.azurecr.io
      identity: REPLACE_IDENTITY_RESOURCE_ID
  containers:
    - name: spectre
      properties:
        image: REPLACE_REGISTRY.azurecr.io/spectre@sha256:REPLACE_DIGEST
        resources:
          requests:
            cpu: 1
            memoryInGB: 2
        ports:
          - port: 8080
        environmentVariables:
          - name: NODE_ENV
            value: production
          - name: PORT
            value: '8080'
          - name: DATABASE_URL
            secureValue: REPLACE_PRIVATELY
          - name: SPECTRE_SETUP_CODE
            secureValue: REPLACE_PRIVATELY
          - name: AI_INTEGRATIONS_OPENAI_API_KEY
            secureValue: REPLACE_PRIVATELY
          - name: AI_INTEGRATIONS_OPENAI_BASE_URL
            value: https://REPLACE_RESOURCE.openai.azure.com/openai/v1
          - name: AI_MODEL
            value: REPLACE_DEPLOYMENT
        readinessProbe:
          httpGet:
            path: /api/readyz
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /api/healthz
            port: 8080
          initialDelaySeconds: 60
          periodSeconds: 30
  ipAddress:
    type: Private
    ports:
      - protocol: TCP
        port: 8080
```

4. ACI secureValue is not a Key Vault URI reference. It supplies the literal secret to the container. Use approved automation to retrieve values without printing them. Rotation requires an explicit container-group update/redeployment.
5. Deploy, inspect state and remove the temporary populated YAML according to policy:

```bash
chmod 600 deployment/aci.private.yaml
az container create -g "$RG" --file deployment/aci.private.yaml
az container show -g "$RG" -n spectre-aci \
  --query "{State:instanceView.state,IP:ipAddress.ip}" -o table
az container logs -g "$RG" -n spectre-aci --container-name spectre
```

6. Create Azure Application Gateway in its own subnet. Configure an HTTPS listener for the application hostname using an approved certificate, a backend pool containing the ACI private IP, backend HTTP port 8080 and a custom probe on /api/readyz. Restrict backend reachability to the gateway path.
7. Verify the gateway preserves the host and supplies the expected forwarded HTTPS information. The exported app trusts one proxy hop. Complete login/logout and secure-cookie testing through HTTPS.
8. Do not send passwords to an ACI public HTTP endpoint. ACI's private IP may change during replacement; refresh the gateway backend pool before cutover.
9. Initialize/restore PostgreSQL separately before directing real users to this container group. Do not use container-local disk for durable data.

# 13. Deploy To Azure App Service

Use a Linux App Service custom-container deployment, not a source-code ZIP deployment that expects App Service to infer the pnpm build.

1. Create a Linux App Service Plan in the approved region. Select a tier supporting Always On and the required VNet integration. Configure one instance initially.
2. Create a Web App with Publish = Container. Choose the private ACR registry and the built SPECTRE image. Prefer the current sidecar-enabled container configuration and designate SPECTRE as the main container.
3. Enable/assign managed identity to the Web App. Grant it the required registry pull and Key Vault secret-read roles. In container registry authentication select managed identity; verify private registry DNS/routing if applicable.
4. Configure the main container target port as 8080. In legacy non-sidecar custom-container mode use WEBSITES_PORT=8080 instead. WEBSITES_PORT is not the target-port control for the newer sidecar model.
5. In Settings → Environment Variables add NODE_ENV, PORT, STATIC_DIR, AI_INTEGRATIONS_OPENAI_BASE_URL and AI_MODEL as listed earlier.
6. For DATABASE_URL, SPECTRE_SETUP_CODE and AI_INTEGRATIONS_OPENAI_API_KEY use App Service Key Vault reference values:

```text
@Microsoft.KeyVault(SecretUri=https://YOUR_VAULT.vault.azure.net/secrets/database-url)
```

7. Configure the reference identity if using a user-assigned identity. Confirm Key Vault references resolve successfully; a literal unresolved reference is not a usable database URL.
8. Configure VNet integration/private DNS for PostgreSQL and any private AI/registry endpoints. Enable Always On, HTTPS Only and a suitable minimum TLS policy. Configure Health Check path /api/readyz.
9. Leave the startup command blank so Dockerfile.azure's entrypoint and command run. Do not replace it with npm start or a frontend-only server.
10. Save, restart once and inspect Log Stream. Configure a custom domain/certificate or use the App Service HTTPS hostname for staging.
11. Execute the acceptance chapter, including a small authorized TCP check and UDP behavior validation. App Service network restrictions can produce inconclusive scan results even when the web UI works.

Do not upload the VM Compose file as an App Service multi-container deployment. Microsoft documents retirement of the older App Service Docker Compose feature on March 31, 2027; use the current sidecar model for new deployments.

# 14. First Login And Functional Acceptance

![Release Verification Sequence](az-release)

1. Confirm both health endpoints respond through the final HTTPS origin:

```bash
curl --fail https://YOUR_HOST/api/healthz
curl --fail https://YOUR_HOST/api/readyz
```

2. Open the landing page. For a fresh database, use the protected setup code to create the first administrator. For migrated data, use an existing authorized account.
3. Confirm logout works, an unauthenticated API call is rejected and a read-only account cannot create scans, modify settings or change module availability.
4. In Settings → Feature Management, disable a harmless module in staging, verify it remains grayed out and cannot be opened directly, then re-enable it. Confirm the choice persists after refresh.
5. Check Executive Insights and the demo console. Synthetic data must remain labeled separately from live evidence.
6. In API Settings test the intended model connector, then submit an approved non-sensitive AI Investigator question. Verify the deployment alias and destination; a successful health response alone does not test AI.
7. In Intelligent VAPT Scans authorize only an asset you control and a narrow approved profile. Confirm the scan completes, TCP/UDP states persist, and no unauthorized target is accepted.
8. Confirm NetMapper selection opens the corresponding historical evidence. Uncertain UDP observations must not be treated as proven open ports or CVEs.
9. Generate Executive and Technical Reports directly from that completed scan. Verify scan ID, target, timestamps and evidence hash. Confirm there is no silent demo-data fallback.
10. Save a PDF with Background Graphics enabled. Executive output should be two A4 pages; Technical output expands with evidence.
11. Restart the staging application after draining work. Confirm accounts, records, feature flags and saved scans remain available from PostgreSQL.
12. Test recovery from a database backup into an isolated environment before production approval.

Record each result, timestamp, tester, image digest and deviation. Do not use production scanning or destructive test actions merely to complete this checklist.

# 15. Releases, Rollback And Operations

Keep the same reviewed source archive, checksum manifest, image digest, database backup identifier and environment configuration record for each release. The source ZIP does not contain operational data.

For Container Apps, use the included azure/deploy.py against existing configured resources or update the image through Portal. For VM, change only SPECTRE_IMAGE in release.env to the approved digest and use compose pull / up. For ACI, review and redeploy the container group and recheck its backend IP. For App Service, change the main image and use a staging slot if your plan supports it and the database strategy has been reviewed.

Before any deployment, stop new scans, drain in-process jobs and confirm session/user impact. Replicas, container restarts or revision swaps can interrupt embedded subprocesses. Do not scale horizontally until job coordination and rate limits have been redesigned and tested.

Rollback requires compatibility review. Reverting an image does not reverse a schema migration or reconcile writes accepted after cutover. Keep the previous digest, test its database compatibility and use a maintenance window. Never restore over production without explicit approval and a recovery plan.

Monitor application failures, database latency/connections, AI response failures, incomplete jobs, denied requests, disk/log growth and backup success. Route logs to approved Azure monitoring services, redact credentials and set retention. Do not log raw secrets or unnecessary evidence contents.

## Secret Rotation

Create new secret versions under the approved vault policy, refresh references/restart as required by the hosting service, and verify database access and real AI inference. VM environment files and ACI secureValue inputs require explicit update. Remove old credentials only after successful validation and rollback planning.

# 16. Troubleshooting

| Symptom | Checks And Corrective Action |
| --- | --- |
| Image pull denied | Verify runtime identity, registry role, ABAC mode, ACR audience-token policy and private DNS. Do not enable registry admin passwords as the first workaround. |
| Container exits immediately | Inspect runtime logs. Missing AI base URL/key can fail startup during module import. Confirm variables and secret-reference resolution. |
| /api/healthz Works But /api/readyz Fails | Check database DNS, routing, role permissions, database name, encoded password and trusted certificate chain. |
| Blank Page Or Deep-Link 404 | Confirm the source adaptation was used, frontend was built with BASE_PATH=/, and STATIC_DIR points to the packaged dist/public directory. |
| Login Or CSRF Failure | Use the final HTTPS origin. Check trusted proxy count, forwarded headers, host preservation and secure cookies. Do not disable origin checks. |
| AI 401/404/429 | Check destination key, v1 base URL, actual model deployment alias, model compatibility and quota. |
| All Ports Timeout | Inspect platform egress, firewall/NAT, source-IP allowlisting and target authorization. Do not automatically classify timeouts as vulnerabilities. |
| Init-DB Refuses To Run | The database contains user tables. Use the migration/upgrade procedure; do not delete data to bypass the safeguard. |
| Report Button Unavailable | Select a completed accessible embedded scan and ensure Reports is enabled. Failed or active jobs are not completed assessment evidence. |
| Module Is Grayed Out | Ask an administrator to review Settings → Feature Management. This is distinct from account permissions. |

# 17. Production Approval And Responsibility Checklist

- Deployment owner: confirms subscription, cost limits, chosen platform and rollback authority.
- Network owner: approves private DNS, database reachability, TLS gateway and scan egress.
- Database owner: approves backup/restore, least privilege, retention and recovery tests.
- Security owner: approves target scope, roles, evidence retention, secrets and image scanning.
- AI owner: confirms provider deployment, data handling, model compatibility and quota.
- Application owner: records signed-in acceptance, restart persistence, reports and feature controls.

The package does not include an automated infrastructure deployment, an existing database backup, production certificates, Azure resources, provider credentials or proof of deployment success. Azure staging migration remains a required validation step.

# 18. Official References

Consult current Microsoft documentation before execution; Portal labels, service support and quotas can change.

- Azure CLI Container Apps: https://learn.microsoft.com/en-us/cli/azure/containerapp
- Container Apps Key Vault secrets: https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets
- ACR managed identity with ACI: https://learn.microsoft.com/en-us/azure/container-instances/using-azure-container-registry-mi
- ACI VNet deployment: https://learn.microsoft.com/en-us/azure/container-instances/container-instances-vnet
- App Service custom containers: https://learn.microsoft.com/en-us/azure/app-service/configure-custom-container
- App Service sidecar configuration: https://learn.microsoft.com/en-us/azure/app-service/configure-sidecar
- App Service Key Vault references: https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references
- PostgreSQL networking: https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-networking
- Docker Engine on Ubuntu: https://docs.docker.com/engine/install/ubuntu/

Use API-README.md and lib/api-spec/openapi.yaml for the source package's actual API contract. Platform documentation explains Azure features; it does not certify SPECTRE's implementation.
