#!/usr/bin/env tsx
/**
 * Encrypt an API key for storage in the llm_configs table.
 *
 * Usage:
 *   pnpm encrypt-key <your-api-key>
 *
 * Requires TOKEN_ENCRYPTION_KEY in .env (64-char hex string).
 * Copy the output ciphertext → encrypted_api_key, iv → api_key_iv in the DB.
 */
import { encrypt } from "../lib/crypto.js";

const apiKey = process.argv[2];

if (!apiKey) {
  console.error("Usage: pnpm encrypt-key <api-key>");
  console.error("Example: pnpm encrypt-key sk-abc123...");
  process.exit(1);
}

if (!process.env.TOKEN_ENCRYPTION_KEY) {
  console.error("Error: TOKEN_ENCRYPTION_KEY not set in environment.");
  console.error("It must be a 64-character hex string (32 bytes).");
  process.exit(1);
}

const { ciphertext, iv } = encrypt(apiKey);

console.log("\nEncrypted API Key");
console.log("─────────────────────────────────────────────────");
console.log(`encrypted_api_key: ${ciphertext}`);
console.log(`api_key_iv:        ${iv}`);
console.log("─────────────────────────────────────────────────");
console.log("\nCopy these values into the llm_configs table in Drizzle Studio.");
