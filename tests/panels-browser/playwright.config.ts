import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "panels.spec.ts",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: "./test-results",
  use: {
    browserName: "chromium",
    headless: true,
    serviceWorkers: "block",
    viewport: { width: 1440, height: 900 },
    baseURL: "http://127.0.0.1:6138",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm --filter @paperclipai/ui exec vite --config ../tests/panels-browser/vite.config.ts",
    url: "http://127.0.0.1:6138",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
