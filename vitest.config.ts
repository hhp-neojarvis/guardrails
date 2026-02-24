import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/web", "apps/api", "packages/shared", "packages/db"],
  },
});
