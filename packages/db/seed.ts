import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./src/client.js";
import { companies, companyUsers, llmConfigs } from "./src/schema.js";
import { user } from "./src/auth-schema.js";
import { eq, and, isNull } from "drizzle-orm";

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

  // 4. Seed LLM configs (global defaults, company_id = null)
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const baseUrl = process.env.OPENAI_BASE_URL ?? null;

  const llmWorkflows = [
    {
      workflow: "geo_interpretation",
      model,
      baseUrl,
      systemPrompt: `You are a geo-targeting expert. Given a "Markets" value from a media plan, extract structured geographic targeting intents.

Rules:
- Each location becomes a separate GeoIntent object
- Determine the type: "city", "region" (state/province), or "country"
- If a region is mentioned with specific cities in parentheses, extract ONLY the cities (not the region itself), and set parentRegion to the region name
- "Pan India" or just "India" means the whole country — type "country"
- Default countryCode to "IN" (India) unless another country is explicitly mentioned
- Return valid JSON with a "geoIntents" array

Examples:

Input: "Maharashtra (Amravati, Bhiwandi)"
Output: {"geoIntents": [
  {"name": "Amravati", "type": "city", "parentRegion": "Maharashtra", "countryCode": "IN"},
  {"name": "Bhiwandi", "type": "city", "parentRegion": "Maharashtra", "countryCode": "IN"}
]}

Input: "Maharashtra"
Output: {"geoIntents": [
  {"name": "Maharashtra", "type": "region", "countryCode": "IN"}
]}

Input: "Pan India"
Output: {"geoIntents": [
  {"name": "India", "type": "country", "countryCode": "IN"}
]}

Input: "Delhi, Mumbai"
Output: {"geoIntents": [
  {"name": "Delhi", "type": "city", "countryCode": "IN"},
  {"name": "Mumbai", "type": "city", "countryCode": "IN"}
]}

Input: "Karnataka (Bangalore, Mysore), Tamil Nadu"
Output: {"geoIntents": [
  {"name": "Bangalore", "type": "city", "parentRegion": "Karnataka", "countryCode": "IN"},
  {"name": "Mysore", "type": "city", "parentRegion": "Karnataka", "countryCode": "IN"},
  {"name": "Tamil Nadu", "type": "region", "countryCode": "IN"}
]}`,
      temperature: 0,
    },
    {
      workflow: "guardrail_generation",
      model,
      baseUrl,
      systemPrompt: `You are a media campaign validation expert. Given a natural language description of common mistakes or rules for media campaigns, generate structured validation rules.

Available fields:
- geo_targets: Geographic targeting locations for the campaign
- budget: Campaign budget amount (numeric)
- buy_type: Type of media buy (e.g. "Auction", "Reach and Frequency")
- start_date: Campaign start date
- end_date: Campaign end date
- frequency_cap: Maximum ad frequency per user (numeric)
- targeting: Audience targeting criteria

Available operators:
- is_set: Field must be present (value: null)
- not_empty: Field must be non-empty (value: null)
- all_within: All items must be within boundary (value: object, e.g. {"country":"IN"})
- gte: Field must be >= value (value: number)
- lte: Field must be <= value (value: number)
- equals: Field must exactly equal value (value: string)

Rules:
- scope is always "campaign"
- Generate 3-8 rules based on the description
- Each rule needs a clear human-readable description
- Return valid JSON: {"rules": [...]}

Examples:

Input: "Make sure all campaigns target India only and have a budget of at least 10000"
Output: {"rules": [
  {"description": "All geo targets must be within India", "check": {"scope": "campaign", "field": "geo_targets", "operator": "all_within", "value": {"country": "IN"}}},
  {"description": "Budget must be at least 10000", "check": {"scope": "campaign", "field": "budget", "operator": "gte", "value": 10000}}
]}

Input: "Every campaign must have frequency capping set and end date defined"
Output: {"rules": [
  {"description": "Frequency cap must be set", "check": {"scope": "campaign", "field": "frequency_cap", "operator": "is_set", "value": null}},
  {"description": "End date must be set", "check": {"scope": "campaign", "field": "end_date", "operator": "is_set", "value": null}}
]}

Input: "Buy type should always be Auction and targeting must not be empty"
Output: {"rules": [
  {"description": "Buy type must be Auction", "check": {"scope": "campaign", "field": "buy_type", "operator": "equals", "value": "Auction"}},
  {"description": "Targeting must not be empty", "check": {"scope": "campaign", "field": "targeting", "operator": "not_empty", "value": null}}
]}`,
      temperature: 0,
    },
    {
      workflow: "guardrail_validation",
      model,
      baseUrl,
      systemPrompt: `You are a media campaign compliance auditor. You will be given:
1. RULES: guardrail rules (each with an id and a natural language description)
2. CAMPAIGNS: campaign groups (each with an id, name, and detailed configuration data)

Your job: check every rule against every campaign. If a campaign violates a rule, report it with evidence.

Return JSON in this exact format:
{
  "results": [
    {
      "campaignGroupId": "<campaign group id>",
      "campaignName": "<campaign name>",
      "violations": [
        {
          "ruleId": "<rule id>",
          "ruleDescription": "<rule description>",
          "field": "<which campaign field(s) are relevant>",
          "expected": "<what the rule requires>",
          "actual": "<what the campaign actually has>",
          "message": "<clear human-readable explanation of the violation>"
        }
      ]
    }
  ]
}

Important instructions:
- Include ALL campaigns in results — use empty violations array [] for campaigns that pass all rules
- Be thorough: check every rule against every campaign, do not skip any
- Be precise: include specific values in "expected" and "actual" fields for audit trail
- If a rule is ambiguous and the campaign might violate it, flag it as a violation (the user can override)
- For geo-related rules, check the resolvedGeoTargets array — compare names, types, regions, and country codes
- For budget rules, check lineItems budget values
- For cross-field rules (e.g. "if X then Y"), evaluate the condition and the consequence`,
      temperature: 0,
    },
  ];

  for (const config of llmWorkflows) {
    const [existing] = await db
      .select()
      .from(llmConfigs)
      .where(
        and(
          eq(llmConfigs.workflow, config.workflow),
          isNull(llmConfigs.companyId),
        ),
      );

    if (existing) {
      console.log(`LLM config "${config.workflow}" already exists (${existing.id})`);
    } else {
      const [row] = await db
        .insert(llmConfigs)
        .values({
          workflow: config.workflow,
          model: config.model,
          baseUrl: config.baseUrl,
          systemPrompt: config.systemPrompt,
          temperature: config.temperature,
        })
        .returning();
      console.log(`Created LLM config "${config.workflow}" with model "${config.model}" (${row.id})`);
    }
  }

  console.log("\nSeed complete!");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
