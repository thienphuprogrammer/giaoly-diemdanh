import { defineConfig } from "vitest/config";
import path from "node:path";

/** Test đua trên Postgres thật (`pnpm test:pg`); tự bỏ qua khi thiếu E2E_DATABASE_URL. */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.pg.test.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
