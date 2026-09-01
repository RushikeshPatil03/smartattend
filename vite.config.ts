import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
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
    plugins: [tailwindcss(), react()],
    build: {
      target: "es2020",
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (id.includes("react/") || id.includes("react-dom/") || id.includes("react-router-dom/")) {
                return "vendor-react";
              }
              if (id.includes("lucide-react") || id.includes("framer-motion")) {
                return "vendor-ui";
              }
              if (id.includes("@supabase/")) {
                return "vendor-supabase";
              }
              if (id.includes("@simplewebauthn/")) {
                return "vendor-auth";
              }
              if (id.includes("@mediapipe/")) {
                return "vendor-vision";
              }
              if (id.includes("html5-qrcode") || id.includes("react-qr-code")) {
                return "vendor-qr";
              }
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
