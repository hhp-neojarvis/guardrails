ALTER TABLE "company_users" ADD COLUMN "reset_token" text;--> statement-breakpoint
ALTER TABLE "company_users" ADD COLUMN "reset_token_expires_at" timestamp with time zone;