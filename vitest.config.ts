import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.pg.test.ts"], // test đua Postgres thật: `pnpm test:pg`
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/server/**", "src/db/queries/**"],
      exclude: ["**/*.test.ts", "src/lib/auth/dal.ts", "src/lib/attendance/ui.ts", "src/test/**"],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
