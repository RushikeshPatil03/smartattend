import { createClient, SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string)?.trim() || "";
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim() || "";

let clientInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (clientInstance) return clientInstance;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      "⚠️ VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not defined. Please set them in your .env or Cloudflare Pages environment variables (Mumbai region)."
    );
    return createClient("https://placeholder-mumbai-project.supabase.co", "dummy-key");
  }

  try {
    clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 20,
        },
      },
      global: {
        headers: {
          "x-application-name": "smart-attend-frontend-mumbai",
        },
      },
    });
    return clientInstance;
  } catch (err) {
    console.error("❌ Failed to initialize Supabase frontend client:", err);
    return createClient("https://placeholder-mumbai-project.supabase.co", "dummy-key");
  }
}

export const supabase = getSupabase();

export interface AttendanceBroadcastPayload {
  sessionId: string;
  type: string;
  attendance: {
    id: string;
    _id?: string;
    sessionId: string;
    studentId: string;
    studentName: string;
    enrollmentNo: string;
    timestamp: string;
    status: string;
    method?: string;
  };
  timestamp: string;
}

/**
 * Subscribe to realtime attendance updates for a live class session
 * @param sessionId The active class session UUID
 * @param onAttendance Callback triggered whenever a student marks attendance
 * @returns Unsubscribe cleanup function
 */
export function subscribeToSessionAttendance(
  sessionId: string,
  onAttendance: (data: AttendanceBroadcastPayload) => void
): () => void {
  if (!sessionId) return () => {};

  const client = getSupabase();
  const channelName = `session:${sessionId}`;

  const channel: RealtimeChannel = client.channel(channelName, {
    config: {
      broadcast: { self: false },
    },
  });

  channel
    .on("broadcast", { event: "ATTENDANCE_MARKED" }, (response) => {
      if (response && response.payload) {
        onAttendance(response.payload as AttendanceBroadcastPayload);
      }
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Subscribed to realtime attendance updates in Mumbai region
      }
    });

  return () => {
    try {
      client.removeChannel(channel);
    } catch {
      // Ignored
    }
  };
}

export default supabase;
