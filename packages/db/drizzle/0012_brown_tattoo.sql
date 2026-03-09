CREATE TABLE "campaign_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"campaign_group_id" uuid NOT NULL,
	"meta_campaign_id" text NOT NULL,
	"confidence" real NOT NULL,
	"confirmed_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "campaign_matches_upload_id_campaign_group_id_unique" UNIQUE("upload_id","campaign_group_id")
);
--> statement-breakpoint
CREATE TABLE "meta_campaign_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"meta_campaign_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "meta_campaign_snapshots_upload_id_meta_campaign_id_unique" UNIQUE("upload_id","meta_campaign_id")
);
--> statement-breakpoint
CREATE TABLE "validation_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"campaign_group_id" uuid NOT NULL,
	"meta_campaign_id" text NOT NULL,
	"field" text NOT NULL,
	"severity" text NOT NULL,
	"note" text NOT NULL,
	"flagged_by_user_id" text NOT NULL,
	"flagged_by_email" text NOT NULL,
	"flagged_at" timestamp with time zone DEFAULT now(),
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by_user_id" text,
	"resolved_by_email" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "validation_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "validation_reports_upload_id_unique" UNIQUE("upload_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_matches" ADD CONSTRAINT "campaign_matches_upload_id_excel_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."excel_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_matches" ADD CONSTRAINT "campaign_matches_campaign_group_id_campaign_groups_id_fk" FOREIGN KEY ("campaign_group_id") REFERENCES "public"."campaign_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_campaign_snapshots" ADD CONSTRAINT "meta_campaign_snapshots_upload_id_excel_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."excel_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_campaign_snapshots" ADD CONSTRAINT "meta_campaign_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_flags" ADD CONSTRAINT "validation_flags_upload_id_excel_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."excel_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_flags" ADD CONSTRAINT "validation_flags_campaign_group_id_campaign_groups_id_fk" FOREIGN KEY ("campaign_group_id") REFERENCES "public"."campaign_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_reports" ADD CONSTRAINT "validation_reports_upload_id_excel_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."excel_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_reports" ADD CONSTRAINT "validation_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;