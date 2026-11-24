import unittest
import agent
from unittest.mock import Mock, patch

class SafetyTests(unittest.TestCase):
    def test_scope(self):
        for ip in ["127.0.0.1","10.0.0.1","172.16.0.1","192.168.0.1","169.254.169.254","100.64.0.1","192.0.2.1","203.0.113.1","224.0.0.1","::1","example.com","8.8.8.8;id"]:
            self.assertFalse(agent.public_ip(ip))
        self.assertTrue(agent.public_ip("8.8.8.8"))
    def test_allowlist_and_command(self):
        job = {"ip":"8.8.8.8","profile":"web","ports":agent.PROFILES["web"]}
        with self.assertRaises(ValueError): agent.validate_job(job, {"1.1.1.1"})
        agent.validate_job(job, {"8.8.8.8"})
        cmd = agent.command("/usr/bin/nmap",job)
        self.assertIn("-sT",cmd)
        self.assertNotIn("--script",cmd)
        self.assertEqual(cmd[-1],"8.8.8.8")
        with self.assertRaises(ValueError): agent.validate_job({**job,"ports":[22]}, {"8.8.8.8"})
    def test_evidence(self):
        job = {"ip":"8.8.8.8","profile":"web"}
        raw = '<!DOCTYPE nmaprun><nmaprun><host><status state="up"/><address addr="8.8.8.8" addrtype="ipv4"/><ports><extraports state="filtered" count="3"/><port protocol="tcp" portid="443"><state state="open"/><service name="https"/></port></ports></host><runstats><finished exit="success"/></runstats></nmaprun>'
        self.assertEqual(agent.parse_xml(raw,job)[0][0]["port"],443)
        for bad in [raw.replace('8.8.8.8','1.1.1.1'),raw.replace('443','22'),raw.replace('success','error'),'<!DOCTYPE x>'+raw]:
            with self.assertRaises(ValueError): agent.parse_xml(bad,job)
    def test_fail_closed_and_cancellation(self):
        # Mock the process boundary: no Nmap or network traffic is executed.
        for unavailable in (True, False):
            worker = agent.Worker.__new__(agent.Worker)
            worker.allowed = {"8.8.8.8"}
            worker.binary = "/not-executed/nmap"
            worker.process = None
            worker.stop = Mock()
            worker.poll = Mock(side_effect=OSError("unavailable")) if unavailable else Mock(return_value={"cancel": True})
            worker.api_call = Mock(return_value={})
            process = Mock()
            process.poll.return_value = None
            job = {"id":"fixture", "ip":"8.8.8.8", "profile":"web", "ports":agent.PROFILES["web"]}
            with patch.object(agent.subprocess, "Popen", return_value=process):
                worker.run_job(job,"lease")
            self.assertTrue(worker.stop.called)
            result = worker.api_call.call_args.args[1]
            self.assertEqual(result["status"], "failed" if unavailable else "cancelled")

if __name__ == "__main__": unittest.main()
