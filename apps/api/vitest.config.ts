import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "test-secret-for-vitest",
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
    },
  },
});
