import { writeFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import { VitePWA } from "vite-plugin-pwa";

const buildId = process.env.ARURA_BUILD_ID ?? "dev";

function aruraBuildId(): Plugin {
  return {
    name: "arura-build-id",
    closeBundle() {
      writeFileSync("dist/build-id.json", JSON.stringify({ id: buildId }));
    },
  };
}

export default defineConfig({
  define: { __ARURA_BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    solid(),
    aruraBuildId(),
    VitePWA({
      injectRegister: false,
      registerType: "autoUpdate",
      includeAssets: [
        "hermes/favicon.png",
        "hermes/app-icon.png",
        "hermes/app-icon-192.png",
        "hermes/app-icon-512.png",
      ],
      manifest: {
        id: "/",
        name: "Arura",
        short_name: "Arura",
        description: "Your Hermes conversations",
        theme_color: "#000000",
        background_color: "#000000",
        display: "standalone",
        display_override: ["standalone", "browser"],
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/hermes/app-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/hermes/app-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/hermes/app-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/hermes/app-icon.png",
            sizes: "1024x1024",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/auth\//,
          /^\/\.well-known\//,
        ],
        globPatterns: ["**/*.{html,js,css,svg,png,woff2,webmanifest}"],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "arura-pages",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 1 },
            },
          },
        ],
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
