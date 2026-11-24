import { pgTable, text, jsonb } from "drizzle-orm/pg-core";

// Demonstration workspaces contain no real network telemetry or credentials.
export const assessmentWorkspaces = pgTable("assessment_workspaces", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
});
