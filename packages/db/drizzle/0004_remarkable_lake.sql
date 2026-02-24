CREATE TABLE "meta_ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"meta_user_id" text NOT NULL,
	"meta_account_id" text NOT NULL,
	"meta_account_name" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"token_status" text DEFAULT 'valid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "meta_ad_accounts_company_id_meta_account_id_unique" UNIQUE("company_id","meta_account_id")
);
--> statement-breakpoint
ALTER TABLE "meta_ad_accounts" ADD CONSTRAINT "meta_ad_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;