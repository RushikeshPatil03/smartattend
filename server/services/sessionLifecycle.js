const { getSupabaseClient } = require("../config/supabase");

const INACTIVITY_SECONDS = Number(process.env.SESSION_INACTIVITY_SECONDS || 600);

function isExpiredByInactivity(session) {
  if (!session || !session.is_active && !session.isActive) return false;
  const lastTime =
    session.last_activity_at ||
    session.lastActivityAt ||
    session.updated_at ||
    session.updatedAt ||
    session.start_time ||
    session.startTime;
  const last = new Date(lastTime).getTime();
  const now = Date.now();
  return now - last > INACTIVITY_SECONDS * 1000;
}

async function expireIfInactive(session) {
  const isActive = Boolean(session?.is_active ?? session?.isActive);
  if (!session || !isActive) return session;
  if (!isExpiredByInactivity(session)) return session;

  const supabase = getSupabaseClient();
  if (!supabase) return session;

  const sessionId = String(session.id || session._id);
  const cutoff = new Date(Date.now() - INACTIVITY_SECONDS * 1000).toISOString();

  try {
    const { data } = await supabase
      .from("sessions")
      .update({
        is_active: false,
        end_time: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("is_active", true)
      .select("*")
      .single();

    if (data) {
      return {
        ...data,
        _id: data.id,
        isActive: false,
        endTime: data.end_time,
        lastActivityAt: data.last_activity_at,
        startTime: data.start_time,
      };
    }
  } catch {
    // Fall back to original
  }

  return session;
}

async function touchSession(sessionId) {
  if (!sessionId) return null;
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const { data } = await supabase
      .from("sessions")
      .update({
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", String(sessionId))
      .eq("is_active", true)
      .select("id")
      .single();

    return data;
  } catch {
    return null;
  }
}

module.exports = {
  INACTIVITY_SECONDS,
  isExpiredByInactivity,
  expireIfInactive,
  touchSession,
};
