CREATE TABLE "campaign_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"markets" text NOT NULL,
	"channel" text NOT NULL,
	"campaign_name" text NOT NULL,
	"line_items" jsonb,
	"geo_intents" jsonb,
	"resolved_geo_targets" jsonb,
	"unresolved_intents" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "excel_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"meta_ad_account_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"total_rows" integer,
	"raw_data" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "geo_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"location_type" text NOT NULL,
	"country_code" text NOT NULL,
	"meta_key" text NOT NULL,
	"meta_name" text NOT NULL,
	"meta_type" text NOT NULL,
	"meta_region" text,
	"meta_region_id" integer,
	"meta_country_code" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "geo_cache_query_location_type_country_code_unique" UNIQUE("query","location_type","country_code")
);
--> statement-breakpoint
ALTER TABLE "campaign_groups" ADD CONSTRAINT "campaign_groups_upload_id_excel_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."excel_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_groups" ADD CONSTRAINT "campaign_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_uploads" ADD CONSTRAINT "excel_uploads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_uploads" ADD CONSTRAINT "excel_uploads_meta_ad_account_id_meta_ad_accounts_id_fk" FOREIGN KEY ("meta_ad_account_id") REFERENCES "public"."meta_ad_accounts"("id") ON DELETE no action ON UPDATE no action;