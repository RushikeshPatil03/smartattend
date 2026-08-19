const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");
const env = require("./env");

// Polyfill global WebSocket for Node runtimes < 22
if (typeof globalThis.WebSocket === "undefined") {
  try {
    globalThis.WebSocket = WebSocket;
  } catch {
    // Ignore polyfill error
  }
}

let supabaseInstance = null;

function getSupabaseClient() {
  if (supabaseInstance) return supabaseInstance;

  const url = env.SUPABASE_URL || "https://zjgsnwjbxxkzrquclugv.supabase.co";
  const key =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqZ3Nud2pieHhrenJxdWNsdWd2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzA3NTUwMSwiZXhwIjoyMTAyNjUxNTAxfQ.NQYGQ0pZIMZDE5EpMANkWCNqOIG0MbUigA-Q2N0f3G4";

  if (!url || !key) {
    console.warn("⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured yet.");
    return null;
  }

  try {
    supabaseInstance = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      realtime: {
        transport: WebSocket,
        params: {
          eventsPerSecond: 20,
        },
      },
      db: {
        schema: "public",
      },
    });
    return supabaseInstance;
  } catch (err) {
    console.warn("⚠️ Primary Supabase client creation failed, trying fallback:", err.message);
    try {
      supabaseInstance = createClient(url, key, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        db: {
          schema: "public",
        },
      });
      return supabaseInstance;
    } catch (fallbackErr) {
      console.error("❌ Failed to initialize Supabase client:", fallbackErr.message);
      return null;
    }
  }
}

const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getSupabaseClient();
      if (!client) {
        throw new Error(
          "Supabase client not initialized. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env"
        );
      }
      const value = client[prop];
      if (typeof value === "function") {
        return value.bind(client);
      }
      return value;
    },
  }
);

function isSupabaseConfigured() {
  return Boolean(
    (env.SUPABASE_URL || "https://zjgsnwjbxxkzrquclugv.supabase.co") &&
    (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...")
  );
}

module.exports = {
  supabase,
  getSupabaseClient,
  isSupabaseConfigured,
};
