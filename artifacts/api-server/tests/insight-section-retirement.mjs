import assert from "node:assert/strict";
import { build } from "esbuild";
const bundled = await build({
  stdin: {
    contents: `export { KEYS, activeInsightSections, validateExecutiveInsights } from "./src/lib/executive-insights"; export { SaveExecutiveInsightsBody } from "@workspace/api-zod";`,
    resolveDir: new URL("..", import.meta.url).pathname,
    loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", write: false,
});
const { KEYS, activeInsightSections, validateExecutiveInsights, SaveExecutiveInsightsBody } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const sections = KEYS.map(key => ({ key, mode: "automated", rows: [] }));
const config = { revision: 0, sections };
assert.equal(KEYS.length, 8);
assert.equal(SaveExecutiveInsightsBody.safeParse(config).success, true);
assert.deepEqual(validateExecutiveInsights(config), []);
const legacy = [...sections, ...["assurance", "evidence"].map(key => ({ key, mode: "manual", rows: [{id:"old",label:"Old",value:3}] }))];
assert.equal(SaveExecutiveInsightsBody.safeParse({ ...config, sections: legacy }).success, false);
assert.deepEqual(activeInsightSections(legacy), sections);
assert.deepEqual(activeInsightSections(activeInsightSections(legacy)), sections);
assert.equal(legacy.length, 10, "Cleanup must not mutate its input");
assert.equal(SaveExecutiveInsightsBody.safeParse({ ...config, sections: sections.slice(1) }).success, false);
assert.ok(validateExecutiveInsights({...config, sections: [...sections.slice(1), sections[1]]}).length);
console.log("PASS: eight-section contract, retired-key rejection, legacy cleanup, preservation, idempotence and duplicate validation.");
