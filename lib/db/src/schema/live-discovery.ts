import { pgTable, text, jsonb } from "drizzle-orm/pg-core";

// Authenticated-owner inventory, intentionally separate from demonstration records.
export const liveDiscoveryWorkspaces = pgTable("live_discovery_workspaces", {
  ownerId: text("owner_id").primaryKey(),
  data: jsonb("data").notNull(),
});
