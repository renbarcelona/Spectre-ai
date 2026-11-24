#!/usr/bin/env python3
"""Bounded TCP/UDP discovery using Python standard library only. No shell or DNS targets."""
import errno
import ipaddress
import json
import os
import socket
import ssl
import sys
import threading
import time

PROFILES = {
    "web": [80, 443, 8080, 8443],
    "standard": [21, 22, 25, 53, 80, 110, 143, 443, 445, 465, 587, 993, 995,
                 1433, 1521, 3306, 3389, 5432, 5900, 6379, 8000, 8080, 8443, 9200, 27017],
}
BLOCKS = [ipaddress.ip_network(n) for n in [
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
    "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16",
    "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/3",
]]
TIMEOUT = 1.5


def validate(ip, profile, tcp_ports=None, udp_ports=None):
    address = ipaddress.IPv4Address(ip)
    if str(address) != ip or any(address in block for block in BLOCKS):
        raise ValueError("Only canonical public IPv4 targets are permitted.")
    if profile == "custom":
        def ports(values):
            if values is None:
                return []
            if not isinstance(values, list) or len(values) > 30:
                raise ValueError("Maximum 30 protocol/port checks.")
            if any(type(p) is not int or p < 1 or p > 65535 for p in values):
                raise ValueError("Ports must be integers from 1 to 65535.")
            return sorted(set(values))
        tcp, udp = ports(tcp_ports), ports(udp_ports)
        if not 1 <= len(tcp) + len(udp) <= 30:
            raise ValueError("Choose 1-30 combined TCP/UDP checks.")
        return tcp, udp
    if profile not in PROFILES or tcp_ports is not None or udp_ports is not None:
        raise ValueError("Custom port lists require the custom profile.")
    return list(PROFILES[profile]), []


def probe(ip, port):
    started = time.monotonic()
    result = {"port": port, "protocol": "tcp", "state": "error", "service": "Unidentified",
              "reason": "", "detail": ""}
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
            connection.settimeout(TIMEOUT)
            connection.connect((ip, port))
            result.update(state="open", reason="TCP connection accepted",
                          detail="Connection accepted. No service version or vulnerability inferred.")
            if port in (443, 8443):
                try:
                    context = ssl.create_default_context()
                    with context.wrap_socket(connection, server_hostname=ip) as tls:
                        cert = tls.getpeercert()
                        result.update(service="TLS", detail=(
                            f"{tls.version()}; certificate validated against IP identity; "
                            f"notAfter={cert.get('notAfter', 'unknown')}."
                        ))
                except ssl.SSLCertVerificationError:
                    result["detail"] = "TCP open; TLS certificate verification against IP identity failed. A hostname certificate may still be valid; this is not a confirmed vulnerability."
                except (ssl.SSLError, OSError):
                    result["detail"] = "TCP open; TLS negotiation was inconclusive. The service may use a different protocol."
    except ConnectionRefusedError:
        result.update(state="closed", reason="TCP connection refused",
                      detail="Refusal observed from the network path; it may originate from the host or a firewall.")
    except (TimeoutError, socket.timeout):
        result.update(state="timeout", reason="TCP connection timed out",
                      detail="Inconclusive: target filtering, network loss or hosting restrictions are possible.")
    except OSError as exc:
        result.update(state="error", reason=errno.errorcode.get(exc.errno, "NETWORK_ERROR"),
                      detail="Local or network connection error. No target vulnerability inferred.")
    result["elapsedMs"] = round((time.monotonic() - started) * 1000, 2)
    return result


def probe_udp(ip, port):
    started = time.monotonic()
    result = {"port": port, "protocol": "udp", "state": "error", "service": "Unidentified",
              "reason": "", "detail": ""}
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
            connection.settimeout(TIMEOUT)
            connection.connect((ip, port))
            # One empty datagram: no reflection request, authentication or application command.
            connection.send(b"")
            connection.recv(512)
            result.update(state="open", reason="UDP reply received",
                          detail="A datagram reply was observed from this endpoint. Service identity and vulnerabilities are not established.")
    except ConnectionRefusedError:
        result.update(state="closed", reason="UDP probe refused",
                      detail="An ICMP refusal was reported on the connected UDP socket. It may originate from the host or a firewall.")
    except (TimeoutError, socket.timeout):
        result.update(state="open|filtered", reason="No UDP reply received before timeout",
                      detail="Inconclusive: an open service may ignore empty datagrams, or filtering/loss may prevent a reply. Silence is not proof that the port is closed.")
    except OSError as exc:
        result.update(state="error", reason=errno.errorcode.get(exc.errno, "NETWORK_ERROR"),
                      detail="Local or network UDP error. No target vulnerability inferred.")
    result["elapsedMs"] = round((time.monotonic() - started) * 1000, 2)
    return result


def scan(ip, profile, tcp_ports=None, udp_ports=None):
    tcp, udp = validate(ip, profile, tcp_ports, udp_ports)
    started = time.monotonic()
    services = []
    for protocol, port in [("tcp", p) for p in tcp] + [("udp", p) for p in udp]:
        if time.monotonic() - started > 65:
            raise TimeoutError("Embedded scan execution deadline exceeded.")
        services.append(probe(ip, port) if protocol == "tcp" else probe_udp(ip, port))
        time.sleep(0.15)
    return {"ip": ip, "profile": profile, "tcpPorts": tcp, "udpPorts": udp,
            "version": f"Python {sys.version.split()[0]} / socket+ssl 1.1",
            "method": "Sequential TCP connect with verified TLS on TCP 443/8443; one empty datagram per UDP port. UDP silence is open|filtered, not closed. No DNS, scripts or service fingerprinting.",
            "timeoutSeconds": TIMEOUT, "services": services}


def main():
    raw = sys.stdin.readline(4096)
    payload = json.loads(raw)
    # Parent keeps the pipe open. On API restart/crash, EOF kills the worker rather
    # than leaving an orphan scanning process. Normal cancellation uses SIGTERM.
    def watch_parent():
        sys.stdin.read(1)
        os._exit(1)
    threading.Thread(target=watch_parent, daemon=True).start()
    result = scan(payload["ip"], payload["profile"], payload.get("tcpPorts"), payload.get("udpPorts"))
    print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Embedded scan failed validation or execution.", file=sys.stderr)
        sys.exit(1)
