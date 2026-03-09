import { boolean, integer, jsonb, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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

// ─── V1: Excel Uploads ───────────────────────────────────────────────────────

export const excelUploads = pgTable("excel_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  uploadedByUserId: text("uploaded_by_user_id").notNull(),
  metaAdAccountId: uuid("meta_ad_account_id")
    .notNull()
    .references(() => metaAdAccounts.id),
  fileName: text("file_name").notNull(),
  status: text("status").notNull().default("processing"),
  totalRows: integer("total_rows"),
  rawData: jsonb("raw_data"),
  errorMessage: text("error_message"),
  guardrailResults: jsonb("guardrail_results"),
  strategy: text("strategy"), // "one_per_line_item" | "one_campaign" | null (not yet chosen)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── V1: Campaign Groups ────────────────────────────────────────────────────

export const campaignGroups = pgTable("campaign_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id")
    .notNull()
    .references(() => excelUploads.id),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  markets: text("markets").notNull(),
  channel: text("channel").notNull(),
  campaignName: text("campaign_name").notNull(),
  lineItems: jsonb("line_items"),
  geoIntents: jsonb("geo_intents"),
  resolvedGeoTargets: jsonb("resolved_geo_targets"),
  unresolvedIntents: jsonb("unresolved_intents"),
  lineItemConfigs: jsonb("line_item_configs"),
  campaignBuyType: jsonb("campaign_buy_type"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── V1: Geo Cache ──────────────────────────────────────────────────────────

export const geoCache = pgTable(
  "geo_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    query: text("query").notNull(),
    locationType: text("location_type").notNull(),
    countryCode: text("country_code").notNull(),
    metaKey: text("meta_key").notNull(),
    metaName: text("meta_name").notNull(),
    metaType: text("meta_type").notNull(),
    metaRegion: text("meta_region"),
    metaRegionId: integer("meta_region_id"),
    metaCountryCode: text("meta_country_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.query, table.locationType, table.countryCode)],
);

// ─── V4: Guardrail Overrides (Audit Log) ────────────────────────────────────

export const guardrailOverrides = pgTable("guardrail_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id")
    .notNull()
    .references(() => excelUploads.id),
  campaignGroupId: uuid("campaign_group_id")
    .notNull()
    .references(() => campaignGroups.id),
  ruleId: uuid("rule_id")
    .notNull()
    .references(() => guardrails.id),
  ruleDescription: text("rule_description").notNull(),
  violationMessage: text("violation_message").notNull(),
  reason: text("reason").notNull(),
  overriddenByUserId: text("overridden_by_user_id").notNull(),
  overriddenByEmail: text("overridden_by_email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── LLM Configs ────────────────────────────────────────────────────────────

export const llmConfigs = pgTable(
  "llm_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id),
    workflow: text("workflow").notNull(), // "geo_interpretation" | "guardrail_generation" | "guardrail_validation"
    model: text("model").notNull().default("gpt-4o-mini"),
    baseUrl: text("base_url"),
    encryptedApiKey: text("encrypted_api_key"),
    apiKeyIv: text("api_key_iv"),
    systemPrompt: text("system_prompt").notNull(),
    temperature: real("temperature").notNull().default(0),
    maxTokens: integer("max_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.companyId, table.workflow)],
);

// ─── V3: Guardrails ──────────────────────────────────────────────────────────

export const guardrails = pgTable("guardrails", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  description: text("description").notNull(),
  check: jsonb("check").default({}), // stores GuardrailCheck object (optional for LLM-based validation)
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ─── V7: Meta Campaign Snapshots ─────────────────────────────────────────────

export const metaCampaignSnapshots = pgTable(
  "meta_campaign_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => excelUploads.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    metaCampaignId: text("meta_campaign_id").notNull(),
    data: jsonb("data").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.uploadId, table.metaCampaignId)],
);

// ─── V7: Campaign Matches ────────────────────────────────────────────────────

export const campaignMatches = pgTable(
  "campaign_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => excelUploads.id),
    campaignGroupId: uuid("campaign_group_id")
      .notNull()
      .references(() => campaignGroups.id),
    metaCampaignId: text("meta_campaign_id").notNull(),
    confidence: real("confidence").notNull(),
    confirmedByUserId: text("confirmed_by_user_id").notNull(),
    lineItemMatches: jsonb("line_item_matches"), // Array<{ lineItemIndex: number; metaAdSetId: string }>
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique().on(table.uploadId, table.campaignGroupId)],
);

// ─── V7: Validation Reports ─────────────────────────────────────────────────

export const validationReports = pgTable("validation_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id")
    .notNull()
    .unique()
    .references(() => excelUploads.id),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  results: jsonb("results").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── V7: Validation Flags ───────────────────────────────────────────────────

export const validationFlags = pgTable("validation_flags", {
  id: uuid("id").primaryKey().defaultRandom(),
  uploadId: uuid("upload_id")
    .notNull()
    .references(() => excelUploads.id),
  campaignGroupId: uuid("campaign_group_id")
    .notNull()
    .references(() => campaignGroups.id),
  metaCampaignId: text("meta_campaign_id").notNull(),
  field: text("field").notNull(),
  severity: text("severity").notNull(),
  note: text("note").notNull(),
  flaggedByUserId: text("flagged_by_user_id").notNull(),
  flaggedByEmail: text("flagged_by_email").notNull(),
  flaggedAt: timestamp("flagged_at", { withTimezone: true }).defaultNow(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedByUserId: text("resolved_by_user_id"),
  resolvedByEmail: text("resolved_by_email"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
});
