import type { DiscoveredService, LiveJob } from "@workspace/api-client-react";
import { protoOf, type Protocol } from "@/lib/live-exposure";

export interface Guidance {
  port: number;
  protocol: Protocol;
  priority: "Review First" | "Planned Hardening" | "Validate" | "Monitor";
  title: string;
  why: string;
  actions: string[];
  owner: string;
  verify: string;
  evidence: string;
}

// UDP: consolidated, bounded exposure advice. No protocol identification, no CVE inference.
function udpGuidance(s: DiscoveredService): Guidance {
  const evidence = `${s.port}/UDP · ${s.state} · ${s.reason || "No reason supplied"}${s.detail ? ` · ${s.detail}` : ""}`;
  const common = { port: s.port, protocol: "udp" as const, owner: "Network / Service Owner", evidence };
  if (s.state === "open") return { ...common, priority: "Planned Hardening", title: "Review Responding UDP Exposure",
    why: "A datagram response was received to a single empty probe. The responding service, its purpose and its security are not identified.",
    actions: ["Identify the listener on the host and its business owner. Disable it if unnecessary; otherwise restrict source addresses at the firewall.", "Review whether the service could be abused for amplification or information disclosure, and apply vendor guidance once the actual software is known."],
    verify: "Confirm the intended UDP exposure with the owner and re-run the same custom check after changes." };
  if (s.state === "closed") return { ...common, priority: "Monitor", title: "Maintain Restricted UDP Access",
    why: "A refusal (ICMP port unreachable) was observed. It does not prove the asset is secure.",
    actions: ["Keep unused UDP listeners disabled and deny unnecessary inbound UDP."],
    verify: "Repeat the same custom check after configuration changes." };
  return { ...common, priority: "Validate", title: "Resolve Uncertain UDP Observations",
    why: s.state === "open|filtered" ? "No response was received. UDP silence is ambiguous: the port may be open with no reply or filtered." : "The UDP probe produced an inconclusive result.",
    actions: ["Confirm intended UDP listeners from host configuration and firewall policy rather than relying on silence.", "Do not broaden public access to make a check conclusive."],
    verify: "Reconcile with listener inventory and firewall logs; corroborate from an authorized vantage point if needed." };
}

// TCP port associations are conditional hints, never service identification.
export function serviceGuidance(s: DiscoveredService): Guidance {
  if (protoOf(s) === "udp") return udpGuidance(s);
  const base: Guidance = {
    port: s.port, protocol: "tcp", priority: "Validate", title: "Resolve Inconclusive Evidence",
    why: "Filtering, packet loss or hosting-environment egress controls can prevent a conclusive observation.",
    actions: ["Review firewall and hosting egress logs with the network owner. Do not broaden public access merely to make a check pass.", "Repeat the approved profile after resolving network issues; corroborate with an authorized independent vantage point."],
    owner: "Network / Platform Team",
    verify: "Obtain a conclusive observation and reconcile it with listener configuration and firewall logs.",
    evidence: `${s.port}/TCP · ${s.state} · ${s.reason || "No reason supplied"}${s.detail ? ` · ${s.detail}` : ""}`,
  };
  if (s.state === "closed") return { ...base, priority: "Monitor", title: "Maintain Restricted Access",
    why: "A TCP refusal was observed from this network path. It does not prove the service is absent or the asset is secure.",
    actions: ["Keep unused listeners disabled and deny unnecessary inbound access.", "If the service should be available, check availability and firewall policy with its owner rather than treating refusal as a security defect."],
    verify: "Confirm the intended service inventory and repeat the same profile after changes; retain the dated evidence." };
  if (s.state !== "open") return base;
  const open: Guidance = { ...base, priority: "Planned Hardening", title: "Validate And Minimize Public Exposure",
    why: "A TCP connection was accepted. The application, version, authentication and exploitability are not established.",
    actions: ["Identify the actual listener and business owner using host configuration. Disable it if unnecessary; otherwise restrict source access where feasible.", "Check supported software versions against vendor advisories, apply approved patches, enforce least privilege and review authentication logs."],
    owner: "Service Owner / Security Team",
    verify: "Recheck from an authorized external location and verify application controls independently. An open port after hardening is not necessarily a failure." };
  if ([1433, 1521, 3306, 5432, 6379, 9200, 27017].includes(s.port)) {
    Object.assign(open, { priority: "Review First", title: "Review Possible Data-Service Exposure", owner: "Database / Cloud Team",
      why: "This TCP port is commonly used by a database, cache or search service. If confirmed, public reachability can expose sensitive data; access or data leakage has not been demonstrated.",
      actions: ["Confirm the listener. If it is a data service, move access behind private endpoints or a tightly scoped firewall allowlist; remove unrestricted ingress after dependency review.", "Require authenticated least-privilege accounts and encrypted transport. Patch supported versions, protect backups and review access logs; rotate credentials if compromise is suspected."],
      verify: "From an untrusted authorized vantage point, confirm access is blocked; from approved applications, confirm authenticated encrypted connectivity still works." });
  } else if ([22, 3389, 5900, 445].includes(s.port)) {
    Object.assign(open, { priority: "Review First", title: "Restrict Possible Administrative Or File Access", owner: "Infrastructure / IAM Team",
      why: "This TCP port is commonly associated with remote administration or file sharing. Confirm the service before deciding whether this exposure is necessary.",
      actions: ["Replace direct public administration with a VPN, zero-trust access gateway or bastion and narrow source allowlists. Avoid public SMB/file sharing.", "Use MFA at the access gateway, key-based SSH where applicable, least-privilege accounts and lockout/rate controls. Patch the actual service and alert on anomalous logins."],
      verify: "Confirm unapproved external clients cannot connect, approved administrators can still work, and access events are logged." });
  } else if ([21, 23, 110, 143].includes(s.port)) {
    Object.assign(open, { priority: "Review First", title: "Verify Transport Protection", owner: "Service Owner / IAM Team",
      why: "The conventional service on this TCP port may permit cleartext credentials. The check did not exchange credentials or confirm cleartext use.",
      actions: ["Identify the protocol and inspect its configuration. Replace legacy FTP/Telnet with SFTP/SSH if applicable; require TLS for mail access and disallow plaintext authentication.", "Disable obsolete listeners only after migration and client testing. Patch the service, require strong authentication and review account activity."],
      verify: "Validate that unencrypted authentication is rejected using approved protocol-specific testing; verify supported clients still connect securely." });
  } else if ([25, 465, 587, 993, 995].includes(s.port)) {
    Object.assign(open, { title: "Harden Possible Mail Services", owner: "Messaging / IAM Team",
      why: "These TCP ports commonly serve mail. Public SMTP may be intentional; relay policy, TLS and authentication were not tested.",
      actions: ["Confirm the mail service; require authenticated submission, restrict relay destinations and prevent unauthenticated open relay.", "Enforce appropriate TLS and strong user authentication, patch mail software, rate-limit abuse and monitor delivery/authentication logs."],
      verify: "Have the messaging team validate relay restrictions and TLS with an authorized mail test. Do not infer an open relay from an open TCP port." });
  } else if (s.port === 53) {
    Object.assign(open, { title: "Validate DNS Exposure", owner: "DNS / Network Team",
      why: "TCP 53 is commonly DNS. Neither recursion nor zone transfer was tested.",
      actions: ["Confirm whether this is an authoritative server or internal resolver. Limit recursion to trusted clients and zone transfers to approved secondaries.", "Patch DNS software, apply appropriate rate controls and monitor query abuse."],
      verify: "Validate recursion and transfer ACLs with authorized DNS tests while preserving legitimate authoritative resolution." });
  } else if ([80, 443, 8000, 8080, 8443].includes(s.port)) {
    Object.assign(open, { title: "Harden Possible Web Exposure", owner: "Application / Platform Team",
      why: "This TCP port commonly hosts a website, proxy or management console. No HTTP requests, authentication checks or application vulnerability tests were performed.",
      actions: ["Identify the application and whether it must be public. Remove development/debug endpoints; restrict management consoles to approved private access.", "For HTTP applications, enforce HTTPS, secure sessions and strong authentication; patch the stack, rate-limit abusive requests and use appropriate WAF controls. Enable HSTS only after HTTPS coverage is validated."],
      verify: "Validate the intended hostname, HTTPS redirect, authentication and application configuration separately; rerun TCP checks to verify the intended exposure." });
  }
  if ([443, 8443].includes(s.port)) {
    if (s.detail?.includes("verification against IP identity failed")) {
      open.title += " — Verify Certificate Identity";
      open.actions.push("Certificate verification against the IP failed. Retest with the intended DNS hostname and SNI, inspect SANs, expiry and trust chain; replace the certificate only if that validation confirms a defect. Do not disable certificate verification.");
    } else if (s.detail?.includes("negotiation was inconclusive")) {
      open.actions.push("TLS negotiation was inconclusive: confirm the actual protocol and expected hostname/SNI, then review TLS configuration and server logs. This is not proof of broken encryption.");
    } else if (s.detail?.includes("certificate validated against IP identity")) {
      open.actions.push("The observed TLS handshake validated the IP identity at check time. Monitor certificate expiry and renewal; this is not a complete TLS policy or application security assessment.");
    }
  }
  return open;
}

export function jobGuidance(job: LiveJob): Guidance[] {
  const rank = { "Review First": 0, Validate: 1, "Planned Hardening": 2, Monitor: 3 };
  return job.services.map(serviceGuidance).sort((a, b) => rank[a.priority] - rank[b.priority] || a.protocol.localeCompare(b.protocol) || a.port - b.port);
}

export function consolidatedGuidance(job: LiveJob) {
  const groups = new Map<string, Guidance & { ports: number[] }>();
  for (const item of jobGuidance(job)) {
    const title = item.title.split(" — ")[0];
    const key = `${item.protocol}:${item.priority}:${title}`;
    const group = groups.get(key);
    if (group) {
      if (!group.ports.includes(item.port)) group.ports.push(item.port);
      group.actions = [...new Set([...group.actions, ...item.actions])];
    } else {
      groups.set(key, { ...item, title, ports: [item.port], actions: [...item.actions] });
    }
  }
  return [...groups.values()];
}
