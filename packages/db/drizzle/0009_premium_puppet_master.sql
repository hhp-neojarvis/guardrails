CREATE TABLE "llm_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"workflow" text NOT NULL,
	"model" text DEFAULT 'gpt-4o-mini' NOT NULL,
	"system_prompt" text NOT NULL,
	"temperature" real DEFAULT 0 NOT NULL,
	"max_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "llm_configs_company_id_workflow_unique" UNIQUE("company_id","workflow")
);
--> statement-breakpoint
ALTER TABLE "guardrails" ALTER COLUMN "check" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "guardrails" ALTER COLUMN "check" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_configs" ADD CONSTRAINT "llm_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;