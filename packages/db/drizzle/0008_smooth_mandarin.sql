CREATE TABLE "guardrail_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"campaign_group_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"rule_description" text NOT NULL,
	"violation_message" text NOT NULL,
	"reason" text NOT NULL,
	"overridden_by_user_id" text NOT NULL,
	"overridden_by_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "excel_uploads" ADD COLUMN "guardrail_results" jsonb;--> statement-breakpoint
ALTER TABLE "guardrail_overrides" ADD CONSTRAINT "guardrail_overrides_upload_id_excel_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."excel_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_overrides" ADD CONSTRAINT "guardrail_overrides_campaign_group_id_campaign_groups_id_fk" FOREIGN KEY ("campaign_group_id") REFERENCES "public"."campaign_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_overrides" ADD CONSTRAINT "guardrail_overrides_rule_id_guardrails_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."guardrails"("id") ON DELETE no action ON UPDATE no action;