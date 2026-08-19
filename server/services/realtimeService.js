/**
 * Realtime Service using Supabase Realtime Broadcast & Channels
 * Replaces Socket.io with lightweight, serverless Supabase Realtime
 */

const { getSupabaseClient } = require("../config/supabase");

const channelCache = new Map();

function getSessionChannel(sessionId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const channelName = `session:${String(sessionId)}`;
  if (channelCache.has(channelName)) {
    return channelCache.get(channelName);
  }

  const channel = supabase.channel(channelName, {
    config: {
      broadcast: {
        self: true,
        ack: false,
      },
    },
  });

  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      // Ready for broadcasting
    }
  });

  channelCache.set(channelName, channel);
  return channel;
}

/**
 * Broadcast attendance event to all subscribers of a session channel
 * @param {string} sessionId 
 * @param {object} attendanceData 
 */
async function broadcastAttendance(sessionId, attendanceData) {
  if (!sessionId) return;

  try {
    const channel = getSessionChannel(sessionId);
    if (!channel) {
      console.warn("⚠️ Supabase Realtime channel unavailable for session:", sessionId);
      return;
    }

    await channel.send({
      type: "broadcast",
      event: "ATTENDANCE_MARKED",
      payload: {
        sessionId: String(sessionId),
        type: "ATTENDANCE_MARKED",
        attendance: attendanceData,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("❌ Failed to broadcast attendance via Supabase Realtime:", err.message);
  }
}

/**
 * Cleanup channels when session ends
 * @param {string} sessionId 
 */
async function removeSessionChannel(sessionId) {
  if (!sessionId) return;
  const channelName = `session:${String(sessionId)}`;
  const channel = channelCache.get(channelName);
  if (channel) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.removeChannel(channel);
      } catch {
        // Ignore channel removal errors
      }
    }
    channelCache.delete(channelName);
  }
}

module.exports = {
  broadcastAttendance,
  removeSessionChannel,
  getSessionChannel,
};
