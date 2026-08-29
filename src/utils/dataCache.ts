// src/utils/dataCache.ts
//
// High-performance client-side storage cache with TTL & Stale-While-Revalidate support
//

export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const CACHE_KEYS = {
  DEPARTMENTS: "smartattend_cache_departments",
  SUBJECTS: "smartattend_cache_subjects",
} as const;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  version: number;
}

const CACHE_VERSION = 1;

/**
 * Reads data from localStorage cache with TTL validation
 */
export function getCache<T>(
  key: string,
  ttlMs: number = DEFAULT_CACHE_TTL_MS
): { data: T | null; isStale: boolean; exists: boolean } {
  if (typeof localStorage === "undefined") {
    return { data: null, isStale: true, exists: false };
  }

  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return { data: null, isStale: true, exists: false };
    }

    const entry: CacheEntry<T> = JSON.parse(raw);
    if (!entry || typeof entry.timestamp !== "number" || entry.version !== CACHE_VERSION) {
      return { data: null, isStale: true, exists: false };
    }

    const now = Date.now();
    const age = now - entry.timestamp;
    const isStale = age > ttlMs;

    return {
      data: entry.data,
      isStale,
      exists: true,
    };
  } catch {
    return { data: null, isStale: true, exists: false };
  }
}

/**
 * Saves data into localStorage cache with timestamp
 */
export function setCache<T>(key: string, data: T): void {
  if (typeof localStorage === "undefined") return;

  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch (error) {
    // Graceful degradation when localStorage quota is exceeded or in private browsing
    console.warn(`[DataCache] Unable to cache key "${key}":`, error);
  }
}

/**
 * Removes a specific cache entry
 */
export function clearCache(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore error
  }
}

/**
 * Clears all application data caches
 */
export function clearAllDataCaches(): void {
  if (typeof localStorage === "undefined") return;
  try {
    Object.values(CACHE_KEYS).forEach((key) => {
      localStorage.removeItem(key);
    });
  } catch {
    // Ignore error
  }
}
