/**
 * Sequential QR Block Buffer
 * Collects and deduplicates consecutive QR scans
 * Triggers submission when exactly 2 consecutive blocks are captured
 */

import { RotatingQrPayload, areConsecutiveBlocks } from "../utils/totpQrGenerator";

export interface BufferedBlock {
  payload: RotatingQrPayload;
  scannedAt: number;
}

export interface SequentialBuffer {
  blocks: BufferedBlock[];
  firstBlockSeenAt: number | null;
  isDuplicate: (payload: RotatingQrPayload) => boolean;
  addBlock: (payload: RotatingQrPayload) => "duplicate" | "buffered" | "ready";
  getBlocks: () => BufferedBlock[];
  getPayloads: () => RotatingQrPayload[];
  flush: () => void;
}

/**
 * Create a new sequential buffer instance
 */
export function createSequentialBuffer(): SequentialBuffer {
  const blocks: BufferedBlock[] = [];
  let firstBlockSeenAt: number | null = null;

  /**
   * Check if payload is a duplicate of already buffered block
   */
  const isDuplicate = (payload: RotatingQrPayload): boolean => {
    return blocks.some(
      (b) =>
        b.payload.index === payload.index &&
        b.payload.classId === payload.classId
    );
  };

  /**
   * Add a scanned block to buffer
   * Returns: "duplicate" | "buffered" | "ready"
   * "ready" indicates 2 consecutive blocks are available
   */
  const addBlock = (payload: RotatingQrPayload): "duplicate" | "buffered" | "ready" => {
    // Reject duplicates
    if (isDuplicate(payload)) {
      return "duplicate";
    }

    // Purge old blocks that don't form consecutive sequence
    if (blocks.length > 0) {
      const lastBlock = blocks[blocks.length - 1];
      // If new block is not consecutive or is older, start fresh
      if (
        !areConsecutiveBlocks(lastBlock.payload, payload) &&
        payload.index !== lastBlock.payload.index
      ) {
        blocks.length = 0;
        firstBlockSeenAt = null;
      }
    }

    blocks.push({
      payload,
      scannedAt: Date.now(),
    });

    if (firstBlockSeenAt === null) {
      firstBlockSeenAt = Date.now();
    }

    // Check if we have exactly 2 consecutive blocks
    if (
      blocks.length === 2 &&
      areConsecutiveBlocks(blocks[0].payload, blocks[1].payload)
    ) {
      return "ready";
    }

    // Keep buffer size manageable (max 2 blocks)
    if (blocks.length > 2) {
      blocks.shift(); // Remove oldest if exceeding 2
    }

    return "buffered";
  };

  const getBlocks = (): BufferedBlock[] => {
    return [...blocks];
  };

  const getPayloads = (): RotatingQrPayload[] => {
    return blocks.map((b) => b.payload);
  };

  const flush = (): void => {
    blocks.length = 0;
    firstBlockSeenAt = null;
  };

  return {
    blocks,
    firstBlockSeenAt,
    isDuplicate,
    addBlock,
    getBlocks,
    getPayloads,
    flush,
  };
}

/**
 * Validate that blocks are ready for submission
 */
export function isReadyForSubmission(buffer: SequentialBuffer): boolean {
  const payloads = buffer.getPayloads();
  if (payloads.length !== 2) return false;

  return areConsecutiveBlocks(payloads[0], payloads[1]);
}
