# SPECTRE AI

Strategic Penetration & Exploit Cyber Threat Response Engine.

## Source Export

This repository contains the current Azure-ready source snapshot exported from the SPECTRE AI workspace. It is not a copy of the workspace's Git history and does not include credentials, account records, scan results, or database backups.

## Getting Started

- [Deployment Start Guide](START-HERE.md)
- [Azure Deployment Instructions](DEPLOYMENT-GUIDE.md)
- [AI Engine And API Reference](API-README.md)
- [PDF Deployment Guide](SPECTRE_AI_Azure_Hosting_Guide.pdf)
- [Word Deployment Guide](SPECTRE_AI_Azure_Hosting_Guide.docx)

## Runtime Requirements

The container uses Node.js 24, pnpm 10.26.1, and Python 3. Configure PostgreSQL, an OpenAI-compatible AI endpoint, and the initial administrator setup code separately. See `deployment/runtime.env.example` for placeholders; never commit populated credentials.

Build the container with `Dockerfile.azure`. The application serves the frontend and API together on port 8080. Azure App Service uses this as the main container target port. Infrastructure provisioning and database initialization are separate steps described in the deployment guide.

## Operational Boundaries

Use network assessment features only for assets you own or have explicit permission to assess. Start with one application instance because scan jobs are process-local. Successful compilation is not evidence of a completed Azure deployment; validate the configured environment before production use.
