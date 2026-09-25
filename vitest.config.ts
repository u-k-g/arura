import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  resolve: { conditions: ["development", "browser"] },
  test: {
    environment: "jsdom",
    include: ["component-tests/**/*.test.tsx"],
    setupFiles: ["component-tests/setup.ts"],
  },
});
