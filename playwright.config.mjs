import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180000,
  workers: 1,
  use: {
    baseURL: "http://localhost:1437",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
  },
  webServer: {
    command: "node tests/helpers/serve-fixtures.mjs",
    url: "http://localhost:1437/__voice-name-form",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
