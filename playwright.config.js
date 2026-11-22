// Playwright config (CLAUDE.md 8.11). Serves web/ on :8000 and runs the UI checks.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:8000", colorScheme: "dark" },
  webServer: {
    command: "python3 -m http.server -d web 8000",
    url: "http://localhost:8000/styleguide.html",
    reuseExistingServer: true,
  },
});
