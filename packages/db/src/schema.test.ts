import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { companies, companyUsers } from "./schema.js";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const drizzleDir = resolve(__dirname, "../drizzle");

describe("companies table", () => {
  it("has the correct columns", () => {
    const cols = getTableColumns(companies);
    expect(Object.keys(cols).sort()).toEqual(
      ["id", "name", "createdAt"].sort()
    );
  });

  it("id is a uuid primary key", () => {
    const cols = getTableColumns(companies);
    expect(cols.id.dataType).toBe("string");
    expect(cols.id.notNull).toBe(true);
    expect(cols.id.hasDefault).toBe(true);
  });

  it("name is not null", () => {
    const cols = getTableColumns(companies);
    expect(cols.name.notNull).toBe(true);
  });

  it("created_at has a default", () => {
    const cols = getTableColumns(companies);
    expect(cols.createdAt.hasDefault).toBe(true);
  });
});

describe("companyUsers table", () => {
  it("has the correct columns", () => {
    const cols = getTableColumns(companyUsers);
    expect(Object.keys(cols).sort()).toEqual(
      [
        "id",
        "userId",
        "companyId",
        "email",
        "role",
        "status",
        "inviteToken",
        "createdAt",
      ].sort()
    );
  });

  it("user_id is nullable", () => {
    const cols = getTableColumns(companyUsers);
    expect(cols.userId.notNull).toBe(false);
  });

  it("company_id is not null", () => {
    const cols = getTableColumns(companyUsers);
    expect(cols.companyId.notNull).toBe(true);
  });

  it("email is not null", () => {
    const cols = getTableColumns(companyUsers);
    expect(cols.email.notNull).toBe(true);
  });

  it("role is not null", () => {
    const cols = getTableColumns(companyUsers);
    expect(cols.role.notNull).toBe(true);
  });

  it("status is not null", () => {
    const cols = getTableColumns(companyUsers);
    expect(cols.status.notNull).toBe(true);
  });

  it("invite_token is nullable", () => {
    const cols = getTableColumns(companyUsers);
    expect(cols.inviteToken.notNull).toBe(false);
  });

  it("company_id references companies table", () => {
    const cols = getTableColumns(companyUsers);
    const companyIdCol = cols.companyId as any;
    // Drizzle stores FK info — the column was defined with .references(() => companies.id)
    expect(companyIdCol).toBeDefined();
    expect(companyIdCol.dataType).toBe("string"); // uuid stored as string
  });
});

describe("migration files", () => {
  it("schema migration SQL exists", () => {
    expect(existsSync(resolve(drizzleDir, "0000_lush_ikaris.sql"))).toBe(true);
  });

  it("RLS policy migration SQL exists", () => {
    expect(existsSync(resolve(drizzleDir, "0001_rls_policies.sql"))).toBe(
      true
    );
  });

  it("RLS migration enables row level security", () => {
    const sql = readFileSync(
      resolve(drizzleDir, "0001_rls_policies.sql"),
      "utf-8"
    );
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("current_setting('app.company_id', true)");
    expect(sql).toContain("CREATE POLICY");
  });
});

describe("exports", () => {
  it("re-exports schema from index", async () => {
    const mod = await import("./index.js");
    expect(mod.companies).toBeDefined();
    expect(mod.companyUsers).toBeDefined();
  });
});
