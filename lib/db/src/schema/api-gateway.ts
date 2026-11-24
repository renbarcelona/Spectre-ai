import { pgTable, text, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const apiGatewayWorkspaces = pgTable("api_gateway_workspaces", {
  ownerId: text("owner_id").primaryKey(),
  data: jsonb("data").notNull(),
});
export const insertApiGatewaySchema = createInsertSchema(apiGatewayWorkspaces);
export type ApiGatewayWorkspace = typeof apiGatewayWorkspaces.$inferSelect;
