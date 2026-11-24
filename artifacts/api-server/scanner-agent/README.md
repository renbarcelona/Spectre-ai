# SPECTRE Public Discovery Worker

This agent performs real TCP connections and light service-version probes. Only run it against public IPs you own or have explicit written permission to assess. No exploitation, NSE scripts, brute force, UDP, CIDR ranges, DNS targets or live OT testing is supported.

## Requirements

- A dedicated Linux server you control, Python 3.10+, Nmap 7+, and a non-root service account.
- Outbound HTTPS to your SPECTRE API and approved outbound TCP access to the target IPs. No inbound worker port is needed.
- An appropriate maintenance window and permission from target owners and the scanner host provider.
- A fixed egress IP is recommended so the target owner can identify your scanner.

## Setup

1. In SPECTRE, open **Scans → Live Public Discovery**, sign in, register a scanner, and securely copy its one-time credential. Dismiss it after storing it on this external host. Never send it in chat or commit it.
2. Install Python and Nmap using your server OS package manager; create a dedicated `spectre-scanner` non-root account.
3. Place `agent.py` at `/opt/spectre-scanner/agent.py`, readable by the service user. Use a root-owned file so the service cannot modify its own code.
4. Create `/etc/spectre-scanner.env`, owned by root with mode `0600`. Configure:

```text
SPECTRE_API_URL=https://YOUR-SPECTRE-HOST/api
SPECTRE_AGENT_TOKEN=YOUR-ONE-TIME-AGENT-CREDENTIAL
SPECTRE_ALLOWED_IPS=YOUR-EXACT-AUTHORIZED-PUBLIC-IP
```

Use a comma-separated list for up to ten addresses. **These are placeholders**, not working targets. Keep the worker's allowlist under the host administrator's control. SPECTRE scope approval cannot expand this list.

5. Install the supplied systemd service at `/etc/systemd/system/spectre-scanner.service`. Run `sudo systemctl daemon-reload` then `sudo systemctl enable --now spectre-scanner`. Inspect `sudo journalctl -u spectre-scanner`.
6. Wait for SPECTRE to show the agent connected. Approve a matching target with an authorization reference and an expiry no more than 30 days away.
7. Select Web Services (4 ports) or Standard Services (25 ports), confirm permission, and start a job.

For foreground operation, inject the same environment securely into the non-root account and run `python3 agent.py`. `python3 agent.py --check` checks local configuration and Nmap without contacting any target.

Use your actual published HTTPS URL for durable operation. A preview URL is suitable for temporary integration tests only; the preview must remain running. Changing the API hostname requires updating this host's environment.

## Scope And Evidence

Web: 80,443,8080,8443. Standard: 21,22,25,53,80,110,143,443,445,465,587,993,995,1433,1521,3306,3389,5432,5900,6379,8000,8080,8443,9200,27017.

The worker uses unprivileged TCP connect scanning, no DNS lookups, and light version detection. Nmap host timeout is 180 seconds; the worker enforces a 190-second process deadline. Discovery probing is rate-limited; Nmap's service-detection connections have their own behavior and the rate option is **not a total traffic guarantee**.

`-Pn` bypasses initial host discovery, so an “up” host status is not independent proof of liveness. No open ports does not prove a host is down or safe. Version guesses are inventory observations, not confirmed vulnerabilities. Closed/filtered ports may appear grouped in raw XML rather than as individual service rows.

Evidence contains Nmap XML, scanner versions, target, profile, timestamps and a server-computed SHA-256. SHA-256 is an integrity fingerprint, not independent attestation. Results are trusted agent submissions and are not merged into synthetic demo findings. Current retention: last 50 terminal jobs plus active jobs; download evidence before it ages out. Activity history is bounded, not an immutable audit store.

## Cancellation And Failure

The worker polls roughly every 3 seconds. Cancelling, revoking a target or revoking an agent stops its process on its next control-plane check. HTTP calls time out after 10 seconds; on loss of control-plane contact, the worker kills Nmap rather than continuing unmonitored. The server marks expired 45-second leases failed, not successfully cancelled, when no acknowledgement arrives. These are bounded best-effort cancellation semantics, not instantaneous network isolation.

Agent credentials are scoped to one registered agent. Revoke a lost credential in SPECTRE and register a replacement. Never run two worker processes with the same credential. Local network isolation and firewall controls remain the administrator's responsibility.
