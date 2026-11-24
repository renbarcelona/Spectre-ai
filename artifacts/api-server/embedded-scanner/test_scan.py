import importlib.util
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import time
import threading
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location("embedded_scan", Path(__file__).with_name("scan.py"))
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)


class EmbeddedTests(unittest.TestCase):
    def test_custom_validation(self):
        self.assertEqual(scan.validate("8.8.8.8", "custom", [443, 22, 443], [53, 443]), ([22, 443], [53, 443]))
        for tcp, udp in [([], []), ([0], []), ([65536], []), ([True], []), (["22"], []),
                         (list(range(1, 31)), [1]), ([1.2], []), ("22", [])]:
            with self.assertRaises(ValueError):
                scan.validate("8.8.8.8", "custom", tcp, udp)
        with self.assertRaises(ValueError):
            scan.validate("8.8.8.8", "web", [22], [])

    def test_real_loopback_udp_reply(self):
        # Test only our own loopback fixture, never an internet endpoint.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as listener:
            listener.bind(("127.0.0.1", 0))
            listener.settimeout(2)
            def reply():
                data, source = listener.recvfrom(512)
                self.assertEqual(data, b"")
                listener.sendto(b"fixture", source)
            thread = threading.Thread(target=reply)
            thread.start()
            result = scan.probe_udp("127.0.0.1", listener.getsockname()[1])
            thread.join(timeout=3)
        self.assertEqual(result["protocol"], "udp")
        self.assertEqual(result["state"], "open")
        self.assertEqual(result["service"], "Unidentified")

    def test_udp_states_and_one_empty_datagram(self):
        for error, expected in [(TimeoutError(), "open|filtered"), (ConnectionRefusedError(), "closed"), (OSError(101, "unreachable"), "error")]:
            with patch.object(scan.socket, "socket") as factory:
                conn = factory.return_value.__enter__.return_value
                conn.recv.side_effect = error
                result = scan.probe_udp("8.8.8.8", 53)
                self.assertEqual(result["state"], expected)
                conn.send.assert_called_once_with(b"")

    def test_custom_dispatch_preserves_protocol(self):
        with patch.object(scan, "probe", return_value={"port": 53, "protocol": "tcp", "state": "closed"}) as tcp, \
             patch.object(scan, "probe_udp", return_value={"port": 53, "protocol": "udp", "state": "open|filtered"}) as udp, \
             patch.object(scan.time, "sleep"):
            result = scan.scan("8.8.8.8", "custom", [53], [53])
            tcp.assert_called_once_with("8.8.8.8", 53)
            udp.assert_called_once_with("8.8.8.8", 53)
            self.assertEqual(len(result["services"]), 2)
            self.assertEqual(result["udpPorts"], [53])

    def test_scope_rejected(self):
        for address in ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1",
                        "192.0.2.1", "198.51.100.1", "203.0.113.1", "224.0.0.1",
                        "::1", "example.com", "8.8.8.8/24", "8.8.8.8;id"]:
            with self.assertRaises(ValueError):
                scan.validate(address, "web")
        scan.validate("8.8.8.8", "web")  # validation only; never contacted
        with self.assertRaises(ValueError):
            scan.validate("8.8.8.8", "--script")

    def test_real_loopback_transport(self):
        # Directly test the transport against our own ephemeral listener only.
        # Public API/CLI validation still rejects loopback; there is no runtime bypass.
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            result = scan.probe("127.0.0.1", listener.getsockname()[1])
        self.assertEqual(result["state"], "open")
        self.assertEqual(result["service"], "Unidentified")
        self.assertGreaterEqual(result["elapsedMs"], 0)

    def test_failure_classifications(self):
        for error, expected in [(ConnectionRefusedError(), "closed"), (TimeoutError(), "timeout"), (OSError(101, "unreachable"), "error")]:
            with patch.object(scan.socket, "socket") as factory:
                factory.return_value.__enter__.return_value.connect.side_effect = error
                self.assertEqual(scan.probe("8.8.8.8", 80)["state"], expected)

    def test_tls_failure_does_not_hide_open_tcp(self):
        with patch.object(scan.socket, "socket"), patch.object(scan.ssl, "create_default_context") as context:
            context.return_value.wrap_socket.side_effect = ssl.SSLCertVerificationError()
            result = scan.probe("8.8.8.8", 443)
        self.assertEqual(result["state"], "open")
        self.assertIn("not a confirmed vulnerability", result["detail"])

    def test_full_profile_with_mocked_network(self):
        with patch.object(scan, "probe", side_effect=lambda ip, port: {"port": port, "state": "closed"}), patch.object(scan.time, "sleep"):
            result = scan.scan("8.8.8.8", "standard")
        self.assertEqual(len(result["services"]), 25)
        self.assertEqual(result["profile"], "standard")

    def test_parent_pipe_close_aborts_before_network(self):
        # The process receives an invalid local target and EOF, never a valid target.
        p = subprocess.run([sys.executable, "-I", str(Path(__file__).with_name("scan.py"))],
                           input='{"ip":"127.0.0.1","profile":"web"}\n', text=True,
                           capture_output=True, timeout=3)
        self.assertNotEqual(p.returncode, 0)
        self.assertEqual(p.stdout, "")

    def test_parent_disconnect_terminates_running_worker(self):
        # Replace only the scan function in this isolated test process; no sockets.
        script = str(Path(__file__).with_name("scan.py").resolve())
        code = f"""
import importlib.util,time
spec=importlib.util.spec_from_file_location('worker',{script!r})
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
def idle(*args):
    print('ready',flush=True)
    time.sleep(30)
worker.scan=idle
worker.main()
"""
        p = subprocess.Popen([sys.executable, "-I", "-c", code], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            p.stdin.write('{"ip":"8.8.8.8","profile":"web"}\n')
            p.stdin.flush()
            self.assertEqual(p.stdout.readline().strip(), "ready")
            p.stdin.close()
            self.assertEqual(p.wait(timeout=3), 1)
        finally:
            if p.poll() is None:
                p.kill()
                p.wait()
            p.stdout.close()
            p.stderr.close()


if __name__ == "__main__":
    unittest.main()
