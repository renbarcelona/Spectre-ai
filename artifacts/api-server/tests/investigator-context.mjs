import assert from "node:assert/strict";
import { embeddedContext, investigatorRules } from "../src/lib/investigator-context.ts";

const job = {
  id: "fixture-check", engine: "embedded", ip: "203.0.113.10",
  profile: "web", status: "completed", ports: [80, 443],
  createdAt: "2026-11-02T00:00:00Z", finishedAt: "2026-11-02T00:01:00Z",
  evidenceSha256: "fixture-hash",
  services: [{port:80,state:"closed",service:"Unidentified"}, {port:443,state:"open",service:"TLS"}],
  createdBy: "private-owner", leaseId: "internal-lease", rawEvidence: "excluded-raw",
};
const result = embeddedContext(job);
assert.equal(result.check.id, job.id);
assert.deepEqual(result.check.services, job.services);
assert.equal(result.check.evidenceSha256, job.evidenceSha256);
assert.equal(result.check.status, "completed");
for (const field of ["createdBy", "leaseId", "rawEvidence", "agentId"]) {
  assert.ok(!(field in result.check), `${field} must not be sent`);
}
assert.ok(result.source.includes("not demonstration"));
assert.ok(!("findings" in result));
assert.ok(!("assets" in result));
assert.equal(embeddedContext({...job,status:"failed",services:[],error:"Fixture Failure"}).check.error, "Fixture Failure");
assert.ok(investigatorRules.includes("untrusted data"));
assert.ok(investigatorRules.includes("You have no tools"));
assert.ok(investigatorRules.includes("No live CVE lookup"));
console.log("Investigator context tests passed: source separation, evidence retention, minimized fields and incomplete results.");
