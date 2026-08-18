const { createClient } = require("@supabase/supabase-js");
const env = require("./env");

let supabaseInstance = null;

function getSupabaseClient() {
  if (supabaseInstance) return supabaseInstance;

  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;

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
    console.error("❌ Failed to initialize Supabase client:", err.message);
    return null;
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
  return Boolean(env.SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY));
}

module.exports = {
  supabase,
  getSupabaseClient,
  isSupabaseConfigured,
};
