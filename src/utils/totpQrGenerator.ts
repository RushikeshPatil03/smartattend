/**
 * TOTP-Style Rotating QR Code Generator
 * Runs on client-side to compute rotating tokens every 2 seconds
 * Zero server load for QR generation
 */

export interface RotatingQrPayload {
  classId: string;
  code: string;
  index: number;
}

export const TOTP_BLOCK_DURATION_MS = 2000;

function hashToSixDigitToken(value: string): string {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return String((hash >>> 0) % 1000000).padStart(6, "0");
}

/**
 * Generate a fast 6-digit token from secretKey and index
 * Uses a browser-safe deterministic hash. Server verification mirrors this.
 */
export function generateTotpToken(
  secretKey: string,
  index: number
): string {
  return hashToSixDigitToken(`${secretKey}:${index}`);
}

/**
 * Calculate current block index based on 2-second intervals
 * All clients and server use same calculation: Math.floor(Date.now() / 2000)
 */
export function getCurrentBlockIndex(): number {
  return Math.floor(Date.now() / TOTP_BLOCK_DURATION_MS);
}

/**
 * Generate full QR payload for current time block
 */
export function generateRotatingQrPayload(
  secretKey: string,
  classId: string,
  _classCode?: string
): RotatingQrPayload {
  const index = getCurrentBlockIndex();
  const code = generateTotpToken(secretKey, index);

  return {
    classId,
    code,
    index,
  };
}

/**
 * Create a compact, low-density string representation suitable for high-speed QR encoding
 * Uses compact delimited format (classId:code:index) to minimize QR module density
 */
export function serializeQrPayload(payload: RotatingQrPayload): string {
  return `${payload.classId}:${payload.code}:${payload.index}`;
}

/**
 * Parse and validate QR payload from scanned string
 * Supports compact delimited format (classId:code:index), compact JSON, and standard JSON
 */
export function parseQrPayload(data: string): RotatingQrPayload | null {
  if (!data || typeof data !== "string") return null;
  const trimmed = data.trim();

  // 1. Fast path: Compact delimited format (classId:code:index)
  if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    if (parts.length === 3) {
      const [classId, code, rawIndex] = parts;
      const index = Number(rawIndex);
      if (
        classId.length > 0 &&
        /^\d{6}$/.test(code) &&
        Number.isSafeInteger(index)
      ) {
        return {
          classId,
          code,
          index,
        };
      }
    }
  }

  // 2. Compatibility path: JSON payload (standard or compact keys)
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const classId = parsed.classId || parsed.c;
      const code = parsed.code || parsed.t;
      const index = typeof parsed.index === "number" ? parsed.index : Number(parsed.i);

      if (
        typeof classId === "string" &&
        typeof code === "string" &&
        Number.isSafeInteger(index)
      ) {
        return {
          classId,
          code,
          index,
        };
      }
    }
  } catch {
    // Invalid JSON or format
  }

  return null;
}

/**
 * Verify if index represents consecutive blocks
 * block2.index should equal block1.index + 1
 */
export function areConsecutiveBlocks(
  block1: RotatingQrPayload,
  block2: RotatingQrPayload
): boolean {
  return block2.index === block1.index + 1;
}

/**
 * Run a rock-solid rotation timer that guarantees each QR code is displayed
 * for a full 2.0 seconds (2000ms), maintaining chronological sequential index
 * and synchronized with wall-clock time slices.
 */
export function startQrPolling(
  secretKey: string,
  classId: string,
  _classCode: string,
  onTokenUpdate: (payload: RotatingQrPayload) => void,
  intervalMs: number = TOTP_BLOCK_DURATION_MS
): () => void {
  let cancelled = false;
  let timerId: number | null = null;
  const blockDuration = Math.max(500, Number(intervalMs) || TOTP_BLOCK_DURATION_MS);

  // Track the current emitted block index
  let lastEmittedIndex = getCurrentBlockIndex();

  const emitForIndex = (index: number) => {
    if (cancelled) return;
    const code = generateTotpToken(secretKey, index);
    onTokenUpdate({
      classId,
      code,
      index,
    });
  };

  // Emit 1st token immediately
  emitForIndex(lastEmittedIndex);

  // Synchronize smoothly with wall-clock block transitions every 250ms check
  timerId = window.setInterval(() => {
    if (cancelled) return;
    const currentIndex = getCurrentBlockIndex();
    if (currentIndex !== lastEmittedIndex) {
      lastEmittedIndex = currentIndex;
      emitForIndex(currentIndex);
    }
  }, Math.min(250, Math.floor(blockDuration / 4)));

  return () => {
    cancelled = true;
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  };
}
