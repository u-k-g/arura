import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    solid(),
    VitePWA({
      registerType: "prompt",
      manifest: {
        name: "Arura",
        short_name: "Arura",
        description: "Your Hermes conversations",
        theme_color: "#f3f3f3",
        background_color: "#f3f3f3",
        display: "standalone",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/auth\//,
          /^\/\.well-known\//,
        ],
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4100",
      "/auth": "http://127.0.0.1:4100",
      "/.well-known": "http://127.0.0.1:4100",
    },
  },
  build: { target: "es2022", sourcemap: true },
});
