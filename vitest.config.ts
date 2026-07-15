import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000,
    include: ["src/**/*.test.ts"],
    // The two remote suites (integration.test.ts, cli-process.test.ts) mutate
    // the same seed documents on the example server; running test files in
    // parallel workers makes them race. The suite is small — serialize it.
    fileParallelism: false,
  },
});
