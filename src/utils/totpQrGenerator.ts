/**
 * TOTP-Style Rotating QR Code Generator
 * Runs on client-side to compute rotating tokens every 3 seconds
 * Zero server load for QR generation
 */

export interface RotatingQrPayload {
  classId: string;
  code: string;
  index: number;
}

const TOTP_BLOCK_DURATION_MS = 3000;

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
 * Calculate current block index based on 3-second intervals
 * All clients and server use same calculation: Math.floor(Date.now() / 3000)
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
 * Create a string representation suitable for QR encoding
 */
export function serializeQrPayload(payload: RotatingQrPayload): string {
  return JSON.stringify(payload);
}

/**
 * Parse and validate QR payload from scanned string
 */
export function parseQrPayload(data: string): RotatingQrPayload | null {
  try {
    const parsed = JSON.parse(data);
    if (
      parsed &&
      typeof parsed.classId === "string" &&
      typeof parsed.code === "string" &&
      typeof parsed.index === "number"
    ) {
      return {
        classId: parsed.classId,
        code: parsed.code,
        index: parsed.index,
      };
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
 * Run a polling loop that generates new tokens every 3 seconds
 * Returns a cleanup function to stop polling
 */
export function startQrPolling(
  secretKey: string,
  classId: string,
  classCode: string,
  onTokenUpdate: (payload: RotatingQrPayload) => void,
  intervalMs: number = TOTP_BLOCK_DURATION_MS
): () => void {
  let cancelled = false;
  let timeoutId: number | null = null;
  let lastIndex: number | null = null;
  const blockDuration = Math.max(TOTP_BLOCK_DURATION_MS, Number(intervalMs) || TOTP_BLOCK_DURATION_MS);

  const poll = () => {
    if (cancelled) return;

    const payload = generateRotatingQrPayload(secretKey, classId, classCode);
    if (payload.index !== lastIndex) {
      lastIndex = payload.index;
      onTokenUpdate(payload);
    }

    const now = Date.now();
    const currentBlockEnd = Math.floor(now / blockDuration) * blockDuration + blockDuration;
    const delay = Math.max(50, currentBlockEnd - now + 20);
    timeoutId = window.setTimeout(poll, delay);
  };

  poll();

  return () => {
    cancelled = true;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
}
