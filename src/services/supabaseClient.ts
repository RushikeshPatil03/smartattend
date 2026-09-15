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
          eventsPerSecond: 2,
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

export interface CompactAttendanceItem {
  id: string;
  sId: string;
  roll: string;
  name: string;
  t: number;
}

export interface BatchAttendanceBroadcastPayload {
  e: "BATCH_MARKED";
  s: string;
  sessionId: string;
  type: "BATCH_MARKED";
  items: CompactAttendanceItem[];
  records: AttendanceBroadcastPayload["attendance"][];
  attendance?: AttendanceBroadcastPayload["attendance"];
  timestamp: string;
}

export interface SubscribeAttendanceOptions {
  batchWindowMs?: number;
}

/**
 * Subscribe to realtime attendance updates for a live class session
 * Supports both high-throughput micro-batched payloads (BATCH_MARKED) and single payloads (ATTENDANCE_MARKED)
 * @param sessionId The active class session UUID
 * @param onAttendance Callback triggered whenever batch or single attendance updates arrive
 * @param options Optional subscription configuration
 * @returns Unsubscribe cleanup function
 */
export function subscribeToSessionAttendance(
  sessionId: string,
  onAttendance: (data: AttendanceBroadcastPayload | BatchAttendanceBroadcastPayload | any) => void,
  _options?: SubscribeAttendanceOptions
): () => void {
  if (!sessionId) return () => {};

  const client = getSupabase();
  const channelName = `session:${sessionId}`;
  let isCleanedUp = false;

  const channel: RealtimeChannel = client.channel(channelName, {
    config: {
      broadcast: { self: false },
    },
  });

  channel
    .on("broadcast", { event: "BATCH_MARKED" }, (response) => {
      // Concurrency barrier: immediately drop events if cleanup has been triggered
      if (isCleanedUp) return;
      const payload = response?.payload;
      if (!payload) return;

      // Unpack ultra-compact micro-batched payload
      if (Array.isArray(payload.items) && payload.items.length > 0) {
        const records: AttendanceBroadcastPayload["attendance"][] = [];
        payload.items.forEach((item: any) => {
          if (!item) return;
          const isoTime = item.t
            ? new Date(item.t * 1000).toISOString()
            : new Date().toISOString();

          records.push({
            id: String(item.id || ""),
            _id: String(item.id || ""),
            sessionId: String(payload.s || sessionId),
            studentId: String(item.sId || ""),
            studentName: String(item.name || ""),
            enrollmentNo: String(item.roll || "").trim().toUpperCase(),
            timestamp: isoTime,
            status: "present",
          });
        });

        const batchBroadcastPayload: BatchAttendanceBroadcastPayload = {
          e: "BATCH_MARKED",
          s: String(payload.s || sessionId),
          sessionId: String(payload.s || sessionId),
          type: "BATCH_MARKED",
          items: payload.items,
          records,
          attendance: records[0],
          timestamp: new Date().toISOString(),
        };

        onAttendance(batchBroadcastPayload);
      }
    })
    .on("broadcast", { event: "ATTENDANCE_MARKED" }, (response) => {
      // Concurrency barrier: immediately drop events if cleanup has been triggered
      if (isCleanedUp) return;
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
    if (isCleanedUp) return;
    isCleanedUp = true;
    try {
      channel.unsubscribe();
    } catch {
      // Ignored
    }
    try {
      client.removeChannel(channel);
    } catch {
      // Ignored
    }
  };
}

export default supabase;
