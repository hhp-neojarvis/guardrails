import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const companyUsers = pgTable("company_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id"),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  email: text("email").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull(),
  inviteToken: text("invite_token"),
  resetToken: text("reset_token"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
