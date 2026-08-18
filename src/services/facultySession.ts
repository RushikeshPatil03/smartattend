// src/services/facultySession.ts
import apiClient from "./apiClient";

/**
 * Start a faculty session.
 * NOTE:
 * - facultyId is NO LONGER trusted from frontend for FACULTY users
 * - Backend derives facultyId from JWT
 * - This preserves security and prevents spoofing
 */
export async function startSession(payload: {
  subjectId: string;
  departmentId: string;
  location: {
    lat: number;
    lng: number;
    radiusMeters?: number;
  };
  year: number;
  semester: number;
  section: string;
  // facultyId is OPTIONAL (only used if ADMIN starts session for faculty)
  facultyId?: string;
}) {
  try {
    return await apiClient.post("/api/faculty/session/start", payload);
  } catch (err: any) {
    console.error("startSession error", err);
    return { ok: false, error: err?.message || "Network error" };
  }
}

/**
 * Stop an active faculty session
 */
export async function stopSession(sessionId: string) {
  try {
    return await apiClient.post(
      `/api/faculty/session/${sessionId}/stop`,
      {}
    );
  } catch (err: any) {
    console.error("stopSession error", err);
    return { ok: false, error: err?.message || "Network error" };
  }
}

/**
 * Fetch latest dynamic QR for an active session.
 * Faculty screen should call this EVERY 4 SECONDS.
 */
export async function fetchLiveQR(sessionId: string) {
  try {
    return await apiClient.get(
      `/api/faculty/session/${sessionId}/qr`
    );
  } catch (err: any) {
    console.error("fetchLiveQR error", err);
    return { ok: false, error: err?.message || "Network error" };
  }
}

export default {
  startSession,
  stopSession,
  fetchLiveQR,
};
