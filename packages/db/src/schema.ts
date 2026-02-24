import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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

export const metaAdAccounts = pgTable(
  "meta_ad_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    connectedByUserId: text("connected_by_user_id").notNull(),
    metaUserId: text("meta_user_id").notNull(),
    metaAccountId: text("meta_account_id").notNull(),
    metaAccountName: text("meta_account_name").notNull(),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    tokenStatus: text("token_status").notNull().default("valid"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.companyId, table.metaAccountId)],
);
