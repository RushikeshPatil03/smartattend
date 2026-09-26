import { createClient, SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import logger from "../utils/logger";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string)?.trim() || "";
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim() || "";

let clientInstance: SupabaseClient | null = null;
const activeChannelsMap = new Map<string, RealtimeChannel>();

/**
 * Returns a strict singleton SupabaseClient instance.
 * Guaranteed to never re-instantiate across component render cycles.
 */
export function getSupabase(): SupabaseClient {
  if (clientInstance) return clientInstance;

  if (!supabaseUrl || !supabaseAnonKey) {
    logger.warn(
      "⚠️ VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not defined. Using singleton placeholder client."
    );
    clientInstance = createClient("https://placeholder-mumbai-project.supabase.co", "dummy-key");
    return clientInstance;
  }

  try {
    clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
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
    logger.error("❌ Failed to initialize Supabase frontend client:", err);
    clientInstance = createClient("https://placeholder-mumbai-project.supabase.co", "dummy-key");
    return clientInstance;
  }
}

export const supabase = getSupabase();

// Global unload teardown: clean up all active Realtime subscriptions on window close/reload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    try {
      const client = getSupabase();
      for (const [name, channel] of activeChannelsMap.entries()) {
        try {
          channel.unsubscribe();
          client.removeChannel(channel);
        } catch {
          // Ignore teardown errors
        }
      }
      activeChannelsMap.clear();
    } catch {
      // Ignore unload cleanup errors
    }
  });
}

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
  st?: "present" | "absent";
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
  onSessionEnded?: () => void;
}

/**
 * Subscribe to realtime attendance updates for a live class session
 * Supports both high-throughput micro-batched payloads (BATCH_MARKED), single payloads (ATTENDANCE_MARKED),
 * and session lifecycle terminations (SESSION_ENDED)
 * @param sessionId The active class session UUID
 * @param onAttendance Callback triggered whenever batch or single attendance updates arrive
 * @param options Optional subscription configuration (e.g. onSessionEnded callback)
 * @returns Unsubscribe cleanup function
 */
export function subscribeToSessionAttendance(
  sessionId: string,
  onAttendance: (data: AttendanceBroadcastPayload | BatchAttendanceBroadcastPayload | any) => void,
  options?: SubscribeAttendanceOptions
): () => void {
  if (!sessionId) return () => {};

  const client = getSupabase();
  const channelName = `session:${sessionId}`;
  let isCleanedUp = false;

  // Clean up any stale or pre-existing channel for this session to prevent duplicate listeners
  if (activeChannelsMap.has(channelName)) {
    const prev = activeChannelsMap.get(channelName)!;
    try {
      prev.unsubscribe();
      client.removeChannel(prev);
    } catch {
      // Ignored
    }
    activeChannelsMap.delete(channelName);
  }

  const existingChannels = client.getChannels();
  const existing = existingChannels.find(
    (ch) => ch.topic === `realtime:${channelName}` || (ch as any).name === channelName
  );
  if (existing) {
    try {
      client.removeChannel(existing);
    } catch {
      // Ignored
    }
  }

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
          const itemStatus = item.st === "absent" || item.status === "absent" ? "absent" : "present";

          records.push({
            id: String(item.id || ""),
            _id: String(item.id || ""),
            sessionId: String(payload.s || sessionId),
            studentId: String(item.sId || ""),
            studentName: String(item.name || ""),
            enrollmentNo: String(item.roll || "").trim().toUpperCase(),
            timestamp: isoTime,
            status: itemStatus,
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
    .on("broadcast", { event: "SESSION_ENDED" }, () => {
      if (isCleanedUp) return;
      logger.info("Realtime session end broadcast received for session:", sessionId);
      options?.onSessionEnded?.();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        logger.info(`Subscribed to realtime attendance updates for session: ${sessionId}`);
      }
    });

  activeChannelsMap.set(channelName, channel);

  return () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    activeChannelsMap.delete(channelName);
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

/**
 * Type-safe helper for subscribing to Postgres table changes.
 * Enforces targeted events (INSERT | UPDATE | DELETE) and row-level filters.
 * Wildcard event: '*' is explicitly forbidden to reduce payload noise.
 */
export function subscribeToRecordChanges<T = any>(config: {
  channelName: string;
  table: string;
  event: "INSERT" | "UPDATE" | "DELETE";
  filter: string;
  onRecord: (payload: { eventType: string; new: T; old: Partial<T> }) => void;
}): () => void {
  const { channelName, table, event, filter, onRecord } = config;
  if (!table || !event || !filter) {
    logger.warn("subscribeToRecordChanges requires explicit table, event, and filter.");
    return () => {};
  }

  const client = getSupabase();
  let isCleanedUp = false;

  if (activeChannelsMap.has(channelName)) {
    const prev = activeChannelsMap.get(channelName)!;
    try {
      prev.unsubscribe();
      client.removeChannel(prev);
    } catch {}
    activeChannelsMap.delete(channelName);
  }

  const channel = client.channel(channelName);

  channel
    .on(
      "postgres_changes" as any,
      {
        event,
        schema: "public",
        table,
        filter,
      },
      (payload: any) => {
        if (isCleanedUp) return;
        onRecord(payload);
      }
    )
    .subscribe();

  activeChannelsMap.set(channelName, channel);

  return () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    activeChannelsMap.delete(channelName);
    try {
      channel.unsubscribe();
      client.removeChannel(channel);
    } catch {}
  };
}

export default supabase;
