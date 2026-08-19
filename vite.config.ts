import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
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
    plugins: [react()],
    build: {
      target: "es2020",
      cssCodeSplit: true,
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (
                id.includes("react/") ||
                id.includes("react-dom/") ||
                id.includes("react-router-dom/") ||
                id.includes("scheduler/")
              ) {
                return "vendor-react";
              }
              if (id.includes("framer-motion")) {
                return "vendor-motion";
              }
              if (id.includes("lucide-react")) {
                return "vendor-icons";
              }
              if (id.includes("@mediapipe")) {
                return "vendor-mediapipe";
              }
              if (id.includes("html5-qrcode") || id.includes("react-qr-code")) {
                return "vendor-qrcode";
              }
              return "vendor-core";
            }
          },
        },
      },
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
