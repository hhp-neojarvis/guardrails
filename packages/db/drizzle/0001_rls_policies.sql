-- Enable Row Level Security on companies and company_users
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "company_users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Policy: companies — only accessible when app.company_id matches the row id
CREATE POLICY "tenant_isolation" ON "companies"
  FOR ALL
  USING (id = current_setting('app.company_id', true)::uuid);
--> statement-breakpoint

-- Policy: company_users — only accessible when app.company_id matches the row company_id
CREATE POLICY "tenant_isolation" ON "company_users"
  FOR ALL
  USING (company_id = current_setting('app.company_id', true)::uuid);
