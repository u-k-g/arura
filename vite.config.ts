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
        theme_color: "#000000",
        background_color: "#000000",
        display: "standalone",
        icons: [
          {
            src: "/hermes/app-icon.png",
            sizes: "1024x1024",
            type: "image/png",
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
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
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
