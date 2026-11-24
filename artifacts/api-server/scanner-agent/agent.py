#!/usr/bin/env python3
"""SPECTRE public TCP inventory worker. Standard library only; Nmap is external."""
import hashlib
import ipaddress
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

VERSION = "1.0.0"
MAX_XML = 262144
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


def public_ip(value):
    try:
        ip = ipaddress.IPv4Address(value)
        return str(ip) == value and not any(ip in net for net in BLOCKS)
    except (ValueError, TypeError):
        return False


def validate_job(job, allowed):
    if not public_ip(job.get("ip", "")) or job["ip"] not in allowed:
        raise ValueError("Target not in this worker's public-IP allowlist.")
    profile = job.get("profile")
    if profile not in PROFILES or job.get("ports") != PROFILES[profile]:
        raise ValueError("Unrecognized scan profile or port set.")


def command(binary, job):
    # No shell, NSE scripts, arbitrary arguments, DNS resolution, UDP or privileged SYN scan.
    return [binary, "--unprivileged", "-sT", "-Pn", "-n", "-sV", "--version-light",
            "--max-retries", "1", "--host-timeout", "180s", "--max-rate", "20",
            "--scan-delay", "100ms", "--reason", "-p", ",".join(map(str, PROFILES[job["profile"]])),
            "-oX", "-", job["ip"]]


def parse_xml(raw, job):
    # Nmap emits this harmless declaration; reject external/internal DTD definitions.
    xml = raw.replace("<!DOCTYPE nmaprun>", "")
    if len(raw.encode()) > MAX_XML or "<!DOCTYPE" in xml or "<!ENTITY" in xml:
        raise ValueError("Unsafe or oversized evidence.")
    root = ET.fromstring(xml)
    if root.tag != "nmaprun" or root.find("runstats/finished") is None:
        raise ValueError("Incomplete Nmap evidence.")
    if root.find("runstats/finished").get("exit") != "success":
        raise ValueError("Nmap did not finish successfully.")
    services, host_status = [], "unknown"
    hosts = root.findall("host")
    if not hosts:
        raise ValueError("Nmap returned no host evidence; discovery may have timed out.")
    for host in hosts:
        if not any(a.get("addr") == job["ip"] and a.get("addrtype") == "ipv4" for a in host.findall("address")):
            raise ValueError("Evidence target mismatch.")
        state = host.find("status")
        host_status = state.get("state", "unknown") if state is not None else "unknown"
        accounted = len(host.findall("ports/port")) + sum(int(p.get("count", "0")) for p in host.findall("ports/extraports"))
        if accounted != len(PROFILES[job["profile"]]):
            raise ValueError("Incomplete port coverage; host may have timed out. No complete scan asserted.")
        for p in host.findall("ports/port"):
            port = int(p.get("portid", "0"))
            if p.get("protocol") != "tcp" or port not in PROFILES[job["profile"]]:
                raise ValueError("Unexpected port in evidence.")
            state, service = p.find("state"), p.find("service")
            services.append({
                "port": port, "state": state.get("state", "filtered") if state is not None else "filtered",
                "reason": (state.get("reason", "") if state is not None else "")[:200],
                "service": (service.get("name", "unknown") if service is not None else "unknown")[:100],
                "product": (service.get("product", "") if service is not None else "")[:200],
                "version": (service.get("version", "") if service is not None else "")[:200],
            })
    return services, host_status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Refusing API redirect; check the HTTPS endpoint.")


class Worker:
    def __init__(self, api, token, allowed, binary):
        self.api, self.token, self.allowed, self.binary = api, token, allowed, binary
        self.opener = urllib.request.build_opener(NoRedirect())
        self.process = None
        result = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=10, check=True)
        self.nmap_version = result.stdout.splitlines()[0][:200]

    def api_call(self, path, data):
        req = urllib.request.Request(self.api + path, data=json.dumps(data).encode(),
                                     headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"},
                                     method="POST")
        with self.opener.open(req, timeout=10) as response:
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise ValueError("Oversized API response.")
            return json.loads(raw)

    def poll(self, job=None, lease=None):
        data = {"version": VERSION, "nmapVersion": self.nmap_version}
        if job:
            data.update(jobId=job["id"], leaseId=lease)
        return self.api_call("/v1/scanner/poll", data)

    def stop(self):
        if self.process and self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=3)

    def run_job(self, job, lease):
        result = {"jobId": job["id"], "leaseId": lease, "status": "failed", "services": [], "rawXml": "", "hostStatus": "unknown"}
        try:
            validate_job(job, self.allowed)
            with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
                self.process = subprocess.Popen(command(self.binary, job), stdout=output, stderr=errors, start_new_session=True)
                started, heartbeat = time.monotonic(), 0
                while self.process.poll() is None:
                    if time.monotonic() - started > 190:
                        raise TimeoutError("Discovery exceeded the hard execution deadline.")
                    if os.fstat(output.fileno()).st_size > MAX_XML:
                        raise ValueError("Nmap evidence exceeded the size limit.")
                    if time.monotonic() - heartbeat >= 3:
                        if self.poll(job, lease).get("cancel"):
                            self.stop()
                            result.update(status="cancelled", error="Cancellation acknowledged by worker.")
                            break
                        heartbeat = time.monotonic()
                    time.sleep(0.3)
                if result["status"] != "cancelled":
                    if self.poll(job, lease).get("cancel"):
                        result.update(status="cancelled", error="Authorization or lease was cancelled.")
                    elif self.process.returncode != 0:
                        raise RuntimeError("Nmap failed. Check the scanner host logs and network access.")
                    else:
                        output.seek(0)
                        raw = output.read(MAX_XML + 1).decode("utf-8", "replace")
                        services, host_status = parse_xml(raw, job)
                        result.update(status="completed", rawXml=raw, services=services, hostStatus=host_status)
        except Exception as exc:
            self.stop()
            # No credential, command, remote response body or connection URL is logged.
            result["error"] = str(exc)[:600] if isinstance(exc, (ValueError, TimeoutError)) else "Worker stopped: scanner or control-plane connection failed."
        finally:
            self.stop()
            self.process = None
        # A result retry never starts another scan. The server fences stale leases.
        for attempt in range(3):
            try:
                self.api_call("/v1/scanner/result", result)
                print("Job finished:", result["status"], flush=True)
                return
            except Exception:
                time.sleep(2)
        print("Evidence delivery failed; server will expire the lease. No automatic rescan.", flush=True)

    def run(self):
        print("SPECTRE worker started. Waiting for authorized discovery jobs.", flush=True)
        while True:
            try:
                work = self.poll()
                if work.get("job") and work.get("leaseId"):
                    self.run_job(work["job"], work["leaseId"])
            except urllib.error.HTTPError as exc:
                if exc.code in (401, 403):
                    raise RuntimeError("Agent credential was rejected or revoked.") from None
                print("Control plane unavailable; no scan started.", flush=True)
            except Exception:
                print("Control plane unavailable; no scan started.", flush=True)
            time.sleep(3)


def main():
    if os.name != "posix" or os.geteuid() == 0:
        raise ValueError("Run on Linux as a dedicated non-root service user.")
    api = os.environ.get("SPECTRE_API_URL", "").rstrip("/")
    url = urllib.parse.urlsplit(api)
    if url.scheme != "https" or not url.netloc or url.username or url.password or url.query or url.fragment or url.path != "/api":
        raise ValueError("SPECTRE_API_URL must be an HTTPS URL ending in /api.")
    token = os.environ.get("SPECTRE_AGENT_TOKEN", "")
    allowed = {ip.strip() for ip in os.environ.get("SPECTRE_ALLOWED_IPS", "").split(",") if ip.strip()}
    if not token.startswith("spct_") or not allowed or len(allowed) > 10 or not all(public_ip(ip) for ip in allowed):
        raise ValueError("Configure the issued token and one to ten exact authorized public IPv4 addresses.")
    binary = shutil.which("nmap")
    if not binary:
        raise ValueError("Install Nmap 7+ on this external host first.")
    worker = Worker(api, token, allowed, binary)
    if "--check" in sys.argv:
        print("Local configuration and Nmap checked. No network scan performed.")
        return
    def shutdown(_signal, _frame):
        worker.stop()
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    worker.run()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("Worker stopped:", str(exc), file=sys.stderr)
        sys.exit(1)
