/**
 * drizzle/schema.ts — Stub schema for environments without a database.
 * DATABASE_URL is empty in this deployment; all DB operations are no-ops.
 */
import { mysqlTable, varchar, datetime } from "drizzle-orm/mysql-core";
import { InferSelectModel, InferInsertModel } from "drizzle-orm";

export const users = mysqlTable("users", {
  openId: varchar("open_id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: varchar("role", { length: 32 }),
  lastSignedIn: datetime("last_signed_in"),
});

export const widgetPrefs = mysqlTable("widget_prefs", {
  openId: varchar("open_id", { length: 255 }).primaryKey(),
  widgetIds: varchar("widget_ids", { length: 4096 }),
});

export type User = InferSelectModel<typeof users>;
export type InsertUser = InferInsertModel<typeof users>;
