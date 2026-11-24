// Integration check against the development proxy. Uses a separate demo workspace.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:80/api";
const cookie = `sentinel_demo=${randomUUID()}`;
async function request(path, method = "GET", data) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", Cookie: cookie },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return { status: res.status, body: await res.json() };
}
const keys = ["briefing", "technical", "financial", "direction", "decisions", "themes", "priority", "threatMap"];
const initial = (await request("/v1/workspace")).body;
const baseline = { assets: initial.assets, vulnerabilities: initial.vulnerabilities, scans: initial.scans, riskScore: initial.riskScore, compliance: initial.compliance };
const config = {
  revision: 0,
  sections: keys.map(key => ({
    key, mode: "manual", source: "Integration Test Fixture", owner: "Test Function",
    asOf: "2026-11-02", reason: "Verify isolated presentation controls", rows: [],
  })),
};
const section = key => config.sections.find(s => s.key === key);
section("briefing").rows = [
  ["openFindings", 12], ["knownExploited", 3], ["awaitingReview", 5], ["scansCompleted", 4], ["totalScans", 6],
].map(([id, value]) => ({ id, label: id, value }));
section("technical").value = 62;
Object.assign(section("financial"), { value: 10000, secondaryValue: 50000, unit: "PHP" });
Object.assign(section("direction"), { value: 62, secondaryValue: 74 });
section("decisions").rows = [{ id: "decision", label: "Review Recovery Budget", detail: "Scenario estimate", owner: "CFO" }];
section("themes").rows = [{ id: "theme", label: "Service Disruption", rating: "Elevated", detail: "Manually declared scenario" }];
section("priority").rows = [{ id: "priority", label: "Critical Service", value: 88, detail: "Review recovery" }];
section("threatMap").rows = [{ id: "context", label: "External Context", detail: "Manual briefing note" }];
let result = await request("/v1/executive-insights", "PUT", config);
assert.equal(result.status, 200, JSON.stringify(result.body));
assert.equal(result.body.revision, 1);
assert.ok(result.body.updatedAt);
const saved = structuredClone(result.body);
const loaded = (await request("/v1/workspace")).body;
assert.deepEqual(loaded.executiveInsights, saved, "Configuration persists through workspace reads");
for (const [key, value] of Object.entries(baseline)) assert.deepEqual(loaded[key], value, `${key} must not be changed by presentation overrides`);
assert.equal((await request("/v1/executive-insights", "PUT", config)).status, 409, "Stale revision rejected");
const invalidCases = [
  c => c.sections.pop(),
  c => { c.sections[1].key = "briefing"; },
  c => { c.sections[0].rows[1].value = 20; },
  c => { c.sections[0].rows[3].value = 7; },
  c => { c.sections[0].rows[0].value = -1; },
  c => { c.sections[0].rows[0].value = 0.5; },
  c => { c.sections[1].value = 101; },
  c => { c.sections[2].secondaryValue = 1; },
  c => { c.sections[2].unit = "money"; },
  c => { c.sections[3].value = 101; },
  c => { c.sections[5].rows[0].rating = undefined; },
  c => { c.sections[6].rows[0].secondaryValue = 0; },
  c => { c.sections[6].rows[0].value = 9; },
  c => { c.sections[7].rows[0].observedAt = "invalid"; },
  c => { c.sections[8].rows[0].value = 101; },
  c => { c.sections[8].rows = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, label: "Test", value: 10 })); },
  c => { c.sections[9].source = ""; },
  c => { c.sections[9].owner = ""; },
  c => { c.sections[9].asOf = "invalid"; },
  c => { c.sections[9].reason = ""; },
  c => { c.sections[4].rows.push(c.sections[4].rows[0]); },
];
for (const [i, mutate] of invalidCases.entries()) {
  const bad = structuredClone(saved);
  mutate(bad);
  result = await request("/v1/executive-insights", "PUT", bad);
  assert.equal(result.status, 400, `Validation case ${i}: ${JSON.stringify(result.body)}`);
}
// Existing general settings endpoint must not erase the new configuration.
assert.equal((await request("/v1/settings", "PUT", initial.settings)).status, 200);
assert.deepEqual((await request("/v1/workspace")).body.executiveInsights, saved);
// Two simultaneous editors cannot silently overwrite one another.
const competing = await Promise.all([
  request("/v1/executive-insights", "PUT", saved),
  request("/v1/executive-insights", "PUT", saved),
]);
assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
const reset = structuredClone(competing.find(r => r.status === 200).body);
reset.sections.forEach(s => { s.mode = "automated"; });
result = await request("/v1/executive-insights", "PUT", reset);
assert.equal(result.status, 200);
assert.ok((await request("/v1/workspace")).body.executiveInsights.sections.every(s => s.mode === "automated"));
console.log(`Passed: all 10 manual sections persist, ${invalidCases.length} invalid inputs rejected, stale/concurrent saves protected, automated reset and raw assessment preservation.`);
