import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./src/client.js";
import { companies, companyUsers } from "./src/schema.js";
import { user } from "./src/auth-schema.js";
import { eq } from "drizzle-orm";

const email = process.env.SEED_EMAIL ?? "admin@acme.com";
const password = process.env.SEED_PASSWORD ?? "password123";
const companyName = "Acme Corp";

async function seed() {
  console.log("Seeding database...\n");

  // 1. Upsert company
  let [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.name, companyName));

  if (company) {
    console.log(`Company "${companyName}" already exists (${company.id})`);
  } else {
    [company] = await db
      .insert(companies)
      .values({ name: companyName })
      .returning();
    console.log(`Created company "${companyName}" (${company.id})`);
  }

  // 2. Upsert Better Auth user
  const [existingUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, email));

  let userId: string;

  if (existingUser) {
    userId = existingUser.id;
    console.log(`User "${email}" already exists (${userId})`);
  } else {
    const auth = betterAuth({
      database: drizzleAdapter(db, { provider: "pg" }),
      emailAndPassword: { enabled: true },
    });

    const result = await auth.api.signUpEmail({
      body: { name: "Admin", email, password },
    });

    if (!result.user) {
      throw new Error(`Failed to create user: ${JSON.stringify(result)}`);
    }

    userId = result.user.id;
    console.log(`Created user "${email}" (${userId})`);
  }

  // 3. Upsert company_users link
  const [existingLink] = await db
    .select()
    .from(companyUsers)
    .where(eq(companyUsers.userId, userId));

  if (existingLink) {
    console.log(`Company-user link already exists (${existingLink.id})`);
  } else {
    const [link] = await db
      .insert(companyUsers)
      .values({
        userId,
        companyId: company.id,
        email,
        role: "super_admin",
        status: "active",
      })
      .returning();
    console.log(`Created company-user link (${link.id}), role=super_admin`);
  }

  console.log("\nSeed complete!");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
