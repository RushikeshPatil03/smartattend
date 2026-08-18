import { createClient, SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string) ||
  "https://zjgsnwjbxxkzrquclugv.supabase.co";
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqZ3Nud2pieHhrenJxdWNsdWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNzU1MDEsImV4cCI6MjEwMjY1MTUwMX0.RKmyLaQb3Tvvgk6VRq6UsvlqVByg24d8nyB7zZRRvfI";

let clientInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (clientInstance) return clientInstance;

  try {
    clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 20,
        },
      },
    });
    return clientInstance;
  } catch (err) {
    console.warn("Failed to initialize Supabase frontend client:", err);
    // Fallback dummy client
    return createClient("https://placeholder-project.supabase.co", "dummy-key");
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
        // Subscribed to realtime attendance updates
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
