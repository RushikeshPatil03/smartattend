import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const https =
    env.SSL_KEY_PATH && env.SSL_CERT_PATH
      ? {
          key: fs.readFileSync(env.SSL_KEY_PATH),
          cert: fs.readFileSync(env.SSL_CERT_PATH),
        }
      : undefined;

  return {
    plugins: [
      tailwindcss(),
      react(),
      VitePWA({
        registerType: "autoUpdate",
        manifest: false,
        workbox: {
          clientsClaim: true,
          skipWaiting: true,
          cleanupOutdatedCaches: true,
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//, /^\/assets\//, /\.[a-zA-Z0-9]+$/],
          globPatterns: ["**/*.{js,css,ico,png,svg,json}"],
          maximumFileSizeToCacheInBytes: 20 * 1024 * 1024, // 20 MB for face models & wasm
        },
      }),
    ],
    build: {
      target: "es2020",
      chunkSizeWarningLimit: 1200,
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      https,
      allowedHosts: [".loca.lt", ".localtunnel.me", ".trycloudflare.com", ".ts.net", ".tailscale.net"],
      proxy: {
        "/api": {
          target: env.VITE_API_PROXY_TARGET || "http://127.0.0.1:4000",
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
