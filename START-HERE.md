# SPECTRE AI Azure Deployment Package

## Status
This is an isolated source release with Azure portability changes, not a deployed or Azure-certified installation. Do not treat successful image build as production acceptance. No credentials or database backup are included.

## Guided Staging Deployment
1. Read DEPLOYMENT-GUIDE.md or SPECTRE_AI_Azure_Hosting_Guide.pdf / .docx. These cover Container Apps, VM, Container Instances and App Service. No GitHub is needed. API-README.md documents API and AI configuration.
2. Follow the common prerequisites and your chosen hosting chapter in the guide. Infrastructure provisioning is NOT automated by this package.
3. Initialize an EMPTY database with deployment/init-db.mjs, or separately restore approved database backups as documented. Do not apply force-push schema commands to existing production data.
4. Configure the application's runtime variables and Key Vault references. DATABASE_URL must not contain sslmode/sslrootcert options overriding the explicit verified TLS setting. Use an Azure OpenAI v1 endpoint without trailing slash and set AI_MODEL to your deployment alias.
5. Set PORT=8080, NODE_ENV=production, STATIC_DIR=/app/artifacts/sentinel/dist/public, ingress target port 8080 and one minimum/maximum replica. Set startup/liveness to /api/healthz and readiness to /api/readyz. Runtime identity must have registry-pull and Key Vault secret-read access.
6. Install Python 3 and Azure CLI on an approved workstation, or use Azure Cloud Shell. Sign in with az login and select the approved subscription.
7. Copy azure/config.example.json to azure/config.json and enter resource names (no secrets).
8. Run `python3 azure/deploy.py` from the extracted package. It checks configuration, requests confirmation, builds remotely in ACR, deploys by digest and checks health.
9. Verify every acceptance scenario in the enclosed guide. If health fails immediately, inspect logs/readiness and allow startup time; the script does not silently roll back.

## Automated Releases
Optionally import the folder into private Azure Repos. The included azure-pipelines.yml is a reference for updating an existing staging app; review its service connection, environment and resource names. Infrastructure and database migrations are separate approval-controlled operations.

## Rollback
azure/last-release.json records the prior image. After confirming database compatibility and draining scans, use `az containerapp update -g YOUR_GROUP -n YOUR_APP --image PRIOR_IMAGE`. Do not automatically revert after Azure has accepted writes: reconcile data first.

## Important Boundaries
- Local team login is retained; Entra SSO is not implemented.
- Legacy Replit login/logout paths are disabled in this release.
- Embedded jobs remain in-process and can be interrupted by restarts.
- Database migration and external credential provisioning remain required.
- Fonts, threat-map embeds and optional CTI can contact non-Microsoft services. Review/disable these if your policy prohibits them.
- Pin the approved base image digest and add organizational image scanning before production use.
- This package includes the current source, not secrets, node_modules or database records.
