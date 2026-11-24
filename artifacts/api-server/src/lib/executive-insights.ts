import { SaveExecutiveInsightsBody } from "@workspace/api-zod";

type Config = ReturnType<typeof SaveExecutiveInsightsBody.parse>;
export const KEYS = ["briefing", "technical", "financial", "direction", "decisions", "themes", "priority", "threatMap"];
export function activeInsightSections<T extends { key: string }>(sections: T[]): T[] {
  return sections.filter(section => KEYS.includes(section.key));
}
const count = (n: number | undefined) => n !== undefined && Number.isInteger(n) && n >= 0 && n <= 1_000_000;
const score = (n: number | undefined) => n !== undefined && Number.isFinite(n) && n >= 0 && n <= 100;
const date = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(s) && Number.isFinite(Date.parse(s));

/** Validate presentation overrides without changing any assessment evidence. */
export function validateExecutiveInsights(config: Config): string[] {
  const errors: string[] = [];
  const keys = config.sections.map(s => s.key);
  if (KEYS.some(k => !keys.includes(k as typeof keys[number])) || new Set(keys).size !== KEYS.length) {
    errors.push("Provide each of the eight sections exactly once.");
  }
  for (const s of config.sections) {
    const fail = (message: string) => errors.push(`${s.key}: ${message}`);
    if (new Set(s.rows.map(r => r.id)).size !== s.rows.length) fail("Row IDs must be unique.");
    if (s.mode !== "manual") continue;
    if (!s.source?.trim() || !s.owner?.trim() || !s.reason?.trim()) fail("Source, declared owner, and reason are required for manual entry.");
    if (!date(s.asOf)) fail("A valid as-of date is required.");
    if (s.rows.some(r => !r.label.trim())) fail("Every row needs a label.");
    if (s.rows.some(r => r.observedAt && !date(r.observedAt))) fail("Observation dates must be valid ISO dates.");
    switch (s.key) {
      case "briefing": {
        const required = ["openFindings", "knownExploited", "awaitingReview", "scansCompleted", "totalScans"];
        if (s.rows.length !== required.length || required.some(id => !s.rows.some(r => r.id === id))) {
          fail("Provide Open Findings, Known Exploited, Awaiting Review, Scans Completed, and Total Scans.");
          break;
        }
        const values = Object.fromEntries(s.rows.map(r => [r.id, r.value]));
        if (s.rows.some(r => !count(r.value))) fail("Counts must be whole numbers from 0 to 1,000,000.");
        if (values.knownExploited! > values.openFindings! || values.awaitingReview! > values.openFindings!) fail("Known Exploited and Awaiting Review cannot exceed Open Findings.");
        if (values.scansCompleted! > values.totalScans!) fail("Scans Completed cannot exceed Total Scans.");
        break;
      }
      case "technical":
        if (!score(s.value)) fail("The technical index must be between 0 and 100.");
        break;
      case "financial":
        if (s.value === undefined || s.secondaryValue === undefined || s.secondaryValue < s.value) fail("Provide a nonnegative lower and upper financial estimate, with upper >= lower.");
        if (!/^[A-Z]{3}$/.test(s.unit ?? "")) fail("Currency must be a three-letter uppercase code, such as PHP or USD.");
        break;
      case "direction":
        if (!score(s.value) || !score(s.secondaryValue)) fail("Current and previous indices must each be between 0 and 100.");
        break;
      case "themes":
        if (s.rows.some(r => !r.rating)) fail("Each theme needs a priority rating.");
        break;
      case "priority":
        if (s.rows.length > 10 || s.rows.some(r => !score(r.value))) fail("Provide at most 10 priorities with indices from 0 to 100.");
        break;
    }
  }
  return errors;
}
