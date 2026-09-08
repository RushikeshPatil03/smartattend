function getOriginBase(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

const LOCAL_FACE_API_SCRIPT_URL = `${getOriginBase()}/models/face-api.min.js`;
const LOCAL_FACE_API_MODEL_URL = `${getOriginBase()}/models`;
const CDN_FALLBACK_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const CDN_FALLBACK_MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";

const FACE_API_SCRIPT_URL =
  import.meta.env.VITE_FACEAPI_SCRIPT_URL ||
  import.meta.env.VITE_FACE_API_SCRIPT_URL ||
  LOCAL_FACE_API_SCRIPT_URL;

const FACE_API_MODEL_URL =
  import.meta.env.VITE_FACEAPI_MODEL_URL ||
  import.meta.env.VITE_FACE_API_MODEL_URL ||
  LOCAL_FACE_API_MODEL_URL;

// Tiny models achieve high landmark precision and robust 128D embedding at 224px while executing in <15ms
export const FACE_API_INPUT_SIZE = Math.max(
  128,
  Math.min(224, Number(import.meta.env.VITE_FACEAPI_INPUT_SIZE || 224))
);
export const FACE_API_DISTANCE_THRESHOLD = Number(
  import.meta.env.VITE_FACEAPI_DISTANCE_THRESHOLD || 0.45
);

export type FacePoint = { x: number; y: number };
export type FaceLandmarks = { positions: FacePoint[] };

type FaceApiResult = {
  descriptor: Float32Array;
  landmarks: FaceLandmarks;
};

type FaceApi = {
  nets: {
    tinyFaceDetector: { loadFromUri: (uri: string) => Promise<void> };
    faceLandmark68TinyNet: { loadFromUri: (uri: string) => Promise<void> };
    faceRecognitionNet: { loadFromUri: (uri: string) => Promise<void> };
  };
  TinyFaceDetectorOptions: new (options: {
    inputSize: number;
    scoreThreshold: number;
  }) => unknown;
  detectSingleFace: (input: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement, options: unknown) => {
    withFaceLandmarks: (useTinyModel: boolean) => {
      withFaceDescriptor: () => Promise<FaceApiResult | undefined>;
      then: Promise<FaceApiResult | undefined>["then"];
    };
  };
  euclideanDistance: (left: Float32Array, right: Float32Array) => number;
};

declare global {
  interface Window {
    faceapi?: FaceApi;
  }
}

let scriptPromise: Promise<FaceApi> | null = null;
let modelsPromise: Promise<FaceApi> | null = null;
let warmupPromise: Promise<void> | null = null;
let cachedFaceApi: FaceApi | null = null;
let cachedTrackingOptions: unknown = null;
let cachedDetectorOptions: unknown = null;
const memoryDescriptorCache = new Map<string, Float32Array>();
const inFlightDescriptorPromises = new Map<string, Promise<Float32Array>>();

// ─── IndexedDB descriptor persistence ────────────────────────────────────────
// DB: "smartattend_face_v1" / store: "faceapi_descriptors"
// Value format: JSON array of 128 numbers (identical to sessionStorage format)
// Writes are fire-and-forget; reads block only on a cold sessionStorage miss.

const IDB_DB_NAME = "smartattend_face_v1";
const IDB_STORE_NAME = "faceapi_descriptors";
const IDB_VERSION = 1;

let idbPromise: Promise<IDBDatabase> | null = null;

/**
 * Opens (or reuses) the descriptor IndexedDB connection.
 * Returns null silently in environments without IDB support (SSR, private mode, etc.).
 */
function openDescriptorDB(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === "undefined") return null;
  if (idbPromise) return idbPromise;

  idbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        idbPromise = null; // allow retry
        reject(req.error);
      };
    } catch (err) {
      idbPromise = null;
      reject(err);
    }
  });

  return idbPromise;
}

/** Read a Float32Array descriptor from IDB. Returns null on any failure. */
async function idbReadDescriptor(key: string): Promise<Float32Array | null> {
  try {
    const db = await openDescriptorDB();
    if (!db) return null;
    return await new Promise<Float32Array | null>((resolve) => {
      const req = db
        .transaction(IDB_STORE_NAME, "readonly")
        .objectStore(IDB_STORE_NAME)
        .get(key);
      req.onsuccess = () => {
        const val = req.result;
        if (Array.isArray(val) && val.length === 128) {
          resolve(new Float32Array(val));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Write descriptor to IDB asynchronously — fire-and-forget, never throws. */
function idbWriteDescriptor(key: string, descriptor: Float32Array): void {
  void (async () => {
    try {
      const db = await openDescriptorDB();
      if (!db) return;
      const values = Array.from(descriptor);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(IDB_STORE_NAME).put(values, key);
      });
    } catch {
      // IDB write failures are non-blocking; sessionStorage + memory cache still work
    }
  })();
}

/** Clear IDB store — fire-and-forget, never throws. */
function idbClearStore(): void {
  void (async () => {
    try {
      const db = await openDescriptorDB();
      if (!db) return;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(IDB_STORE_NAME).clear();
      });
    } catch {
      // Non-blocking
    }
  })();
}

// ─── Descriptor cache key ─────────────────────────────────────────────────────

function descriptorCacheKey(url: string) {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `faceapi-profile-v1-${(hash >>> 0).toString(36)}`;
}

// ─── Script + model loading ───────────────────────────────────────────────────

function loadScriptFromUrl(url: string): Promise<FaceApi> {
  return new Promise<FaceApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-face-api-src="${url}"]`);
    const script = existing || document.createElement("script");
    const loaded = () => {
      if (window.faceapi) {
        resolve(window.faceapi);
      } else {
        reject(new Error("Face verification library did not initialize."));
      }
    };
    const failed = () => reject(new Error(`Unable to load face verification library from ${url}`));

    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) {
      script.src = url;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.faceApiSrc = url;
      document.head.appendChild(script);
    }
  });
}

function loadScript(): Promise<FaceApi> {
  if (window.faceapi) return Promise.resolve(window.faceapi);
  if (scriptPromise) return scriptPromise;

  scriptPromise = (async () => {
    try {
      // Primary: Load local same-origin static script (/models/face-api.min.js)
      return await loadScriptFromUrl(FACE_API_SCRIPT_URL);
    } catch (primaryErr) {
      if (FACE_API_SCRIPT_URL !== CDN_FALLBACK_SCRIPT_URL) {
        console.warn("Local face-api script failed, attempting fallback...", primaryErr);
        try {
          return await loadScriptFromUrl(CDN_FALLBACK_SCRIPT_URL);
        } catch (fallbackErr) {
          scriptPromise = null;
          throw fallbackErr;
        }
      }
      scriptPromise = null;
      throw primaryErr;
    }
  })();

  return scriptPromise;
}

async function loadModelWeights(faceapi: FaceApi, modelBaseUrl: string) {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(modelBaseUrl),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(modelBaseUrl),
    faceapi.nets.faceRecognitionNet.loadFromUri(modelBaseUrl),
  ]);
}

/**
 * Executes a lightweight dummy inference pass across all 3 neural networks (detector,
 * landmarks, descriptor) to compile WebGL shaders and allocate tensor buffers in the
 * background during idle time. Eliminates the 500-1200ms first-inference freeze.
 */
async function warmUpEngine(faceapi: FaceApi): Promise<void> {
  if (warmupPromise) return warmupPromise;
  warmupPromise = (async () => {
    try {
      const dummyCanvas = document.createElement("canvas");
      dummyCanvas.width = 160;
      dummyCanvas.height = 160;
      const ctx = dummyCanvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.fillStyle = "#808080";
        ctx.fillRect(0, 0, 160, 160);
        await Promise.allSettled([
          faceapi.detectSingleFace(dummyCanvas, trackingDetectorOptions(faceapi)),
          (faceapi as any).detectFaceLandmarksTiny?.(dummyCanvas),
          (faceapi as any).computeFaceDescriptor?.(dummyCanvas),
        ]);
      }
    } catch {
      // Warmup failures are non-blocking
    }
  })();
  return warmupPromise;
}

export function loadModelsIfNeeded(): Promise<FaceApi> {
  if (cachedFaceApi) return Promise.resolve(cachedFaceApi);
  if (modelsPromise) return modelsPromise;

  modelsPromise = (async () => {
    const faceapi = await loadScript();
    try {
      // Primary: Load from local same-origin static directory (/models/)
      await loadModelWeights(faceapi, FACE_API_MODEL_URL);
    } catch (localErr) {
      if (FACE_API_MODEL_URL !== CDN_FALLBACK_MODEL_URL) {
        console.warn("Local face models failed to load, trying fallback...", localErr);
        await loadModelWeights(faceapi, CDN_FALLBACK_MODEL_URL);
      } else {
        throw localErr;
      }
    }

    cachedFaceApi = faceapi;

    // Immediately compile WebGL shaders and allocate tensor buffers for all 3 nets
    try {
      await warmUpEngine(faceapi);
    } catch {
      // Warmup failures are non-blocking
    }

    return faceapi;
  })().catch((error) => {
    modelsPromise = null;
    cachedFaceApi = null;
    throw error;
  });

  return modelsPromise;
}

/**
 * Returns true if face-api.js models are already loaded and cached in memory.
 * Use this to skip an await in hot paths when models are guaranteed to be ready.
 */
export function isModelsLoaded(): boolean {
  return cachedFaceApi !== null;
}

/**
 * Preloads face-api.js models AND warms the reference descriptor for a student's
 * profile photo. Call this on QR-scan-screen mount — not at capture time.
 *
 * Both tasks run in parallel via Promise.allSettled so neither can fail the other.
 * The function itself never throws; all errors are swallowed to keep mount side-effect safe.
 */
export async function preloadForStudent(profilePhotoUrl: string): Promise<void> {
  await Promise.allSettled([
    loadModelsIfNeeded(),
    profilePhotoUrl ? computeDescriptorFromImageURL(profilePhotoUrl) : Promise.resolve(),
  ]);
}

/**
 * Clears all three descriptor cache layers:
 *   1. In-memory Map (instant)
 *   2. sessionStorage keys matching "faceapi-profile-v1-" prefix
 *   3. IndexedDB store (async, fire-and-forget)
 *
 * Call during student logout so the next student starts with a cold cache.
 */
export function clearDescriptorCache(): void {
  // 1. Memory
  memoryDescriptorCache.clear();

  // 2. sessionStorage — iterate and remove matching keys without mutating during iteration
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("faceapi-profile-v1-")) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // sessionStorage may be blocked in private contexts
  }

  // 3. IndexedDB — async, non-blocking
  idbClearStore();
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

let reusableVideoCanvas: HTMLCanvasElement | null = null;
let reusableVideoContext: CanvasRenderingContext2D | null = null;

function getReusableCanvas(): HTMLCanvasElement {
  if (!reusableVideoCanvas) {
    reusableVideoCanvas = document.createElement("canvas");
    reusableVideoCanvas.width = FACE_API_INPUT_SIZE;
    reusableVideoCanvas.height = FACE_API_INPUT_SIZE;
    reusableVideoContext = reusableVideoCanvas.getContext("2d", { willReadFrequently: true });
  }
  return reusableVideoCanvas;
}

function drawSmallSquare(source: CanvasImageSource, width: number, height: number, reuse = false) {
  const canvas = reuse
    ? getReusableCanvas()
    : document.createElement("canvas");
  if (!reuse) {
    canvas.width = FACE_API_INPUT_SIZE;
    canvas.height = FACE_API_INPUT_SIZE;
  }
  const context = reuse && reusableVideoContext
    ? reusableVideoContext
    : canvas.getContext("2d", { willReadFrequently: true });

  if (!context || !width || !height) {
    throw new Error("Unable to prepare the face frame.");
  }

  const side = Math.min(width, height);
  const sourceX = (width - side) / 2;
  const sourceY = Math.max(0, (height - side) / 2 - height * 0.05);
  context.drawImage(
    source,
    sourceX,
    sourceY,
    side,
    side,
    0,
    0,
    FACE_API_INPUT_SIZE,
    FACE_API_INPUT_SIZE
  );
  return canvas;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (!url.startsWith("data:")) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load the registered profile photo."));
    image.src = url;
  });
}

const LIVENESS_TRACKING_SIZE = 160;

let reusableTrackingCanvas: HTMLCanvasElement | null = null;
let reusableTrackingContext: CanvasRenderingContext2D | null = null;

function getReusableTrackingCanvas(): HTMLCanvasElement {
  if (!reusableTrackingCanvas) {
    reusableTrackingCanvas = document.createElement("canvas");
    reusableTrackingCanvas.width = LIVENESS_TRACKING_SIZE;
    reusableTrackingCanvas.height = LIVENESS_TRACKING_SIZE;
    reusableTrackingContext = reusableTrackingCanvas.getContext("2d", { willReadFrequently: true });
  }
  return reusableTrackingCanvas;
}

function drawTrackingSquare(source: CanvasImageSource, width: number, height: number) {
  const canvas = getReusableTrackingCanvas();
  const context = reusableTrackingContext;
  if (!context || !width || !height) {
    throw new Error("Unable to prepare tracking frame.");
  }

  const side = Math.min(width, height);
  const sourceX = (width - side) / 2;
  const sourceY = Math.max(0, (height - side) / 2 - height * 0.05);
  context.drawImage(
    source,
    sourceX,
    sourceY,
    side,
    side,
    0,
    0,
    LIVENESS_TRACKING_SIZE,
    LIVENESS_TRACKING_SIZE
  );
  return canvas;
}

function trackingDetectorOptions(faceapi: FaceApi) {
  if (!cachedTrackingOptions) {
    cachedTrackingOptions = new faceapi.TinyFaceDetectorOptions({
      inputSize: LIVENESS_TRACKING_SIZE,
      scoreThreshold: 0.45,
    });
  }
  return cachedTrackingOptions;
}

function detectorOptions(faceapi: FaceApi) {
  if (!cachedDetectorOptions) {
    cachedDetectorOptions = new faceapi.TinyFaceDetectorOptions({
      inputSize: FACE_API_INPUT_SIZE,
      scoreThreshold: 0.5,
    });
  }
  return cachedDetectorOptions;
}

async function detectDescriptor(faceapi: FaceApi, canvas: HTMLCanvasElement) {
  const result = await faceapi
    .detectSingleFace(canvas, detectorOptions(faceapi))
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  if (!result?.descriptor) throw new Error("No clear single face was found.");
  return result.descriptor;
}

// ─── Public descriptor API ────────────────────────────────────────────────────

export async function computeDescriptorFromImageURL(url: string): Promise<Float32Array> {
  // 1. Hot path: memory cache (sub-millisecond)
  const cached = memoryDescriptorCache.get(url);
  if (cached) return cached;

  // 2. Concurrency lock: deduplicate concurrent callers for the same URL
  const inFlight = inFlightDescriptorPromises.get(url);
  if (inFlight) return inFlight;

  const cacheKey = descriptorCacheKey(url);

  // 3. Warm path: sessionStorage (fast sync read, survives page reload)
  try {
    const stored = sessionStorage.getItem(cacheKey);
    if (stored) {
      const values = JSON.parse(stored);
      if (Array.isArray(values) && values.length === 128) {
        const descriptor = new Float32Array(values);
        memoryDescriptorCache.set(url, descriptor);
        return descriptor;
      }
    }
  } catch {
    // Storage can be unavailable in private browser contexts; memory cache still works.
  }

  // Create a single promise shared across concurrent callers — guarantees exactly
  // one IDB read + one inference per URL regardless of call parallelism.
  const descriptorPromise = (async () => {
    try {
      // 4. Cold path A: IndexedDB (survives PWA restarts; checked before re-inference)
      const idbDescriptor = await idbReadDescriptor(cacheKey);
      if (idbDescriptor) {
        memoryDescriptorCache.set(url, idbDescriptor);
        // Backfill sessionStorage for fast reads on subsequent page loads
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(Array.from(idbDescriptor)));
        } catch {
          // sessionStorage blocked in private contexts
        }
        return idbDescriptor;
      }

      // 5. Cold path B: full inference (network + GPU)
      // Run model load and image fetch concurrently to minimize latency
      const [faceapi, image] = await Promise.all([loadModelsIfNeeded(), loadImage(url)]);
      const canvas = drawSmallSquare(
        image,
        image.naturalWidth || image.width,
        image.naturalHeight || image.height,
        false
      );
      const descriptor = await detectDescriptor(faceapi, canvas);

      // Populate all cache layers:
      memoryDescriptorCache.set(url, descriptor);
      // sessionStorage: fast sync reads on next navigation within the same session
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(Array.from(descriptor)));
      } catch {
        // The descriptor remains cached in memory for this page session.
      }
      // IndexedDB: persists across PWA restarts (fire-and-forget, never blocks return)
      idbWriteDescriptor(cacheKey, descriptor);

      return descriptor;
    } finally {
      // Always release the concurrency lock whether we succeeded or threw
      inFlightDescriptorPromises.delete(url);
    }
  })();

  inFlightDescriptorPromises.set(url, descriptorPromise);
  return descriptorPromise;
}

export async function computeDescriptorFromVideoFrame(video: HTMLVideoElement) {
  if (!video || !video.videoWidth || !video.videoHeight || video.readyState < 2) {
    throw new Error("Camera feed is not ready yet.");
  }
  const faceapi = cachedFaceApi || (await loadModelsIfNeeded());
  const canvas = drawSmallSquare(video, video.videoWidth, video.videoHeight, true);
  return detectDescriptor(faceapi, canvas);
}

export async function computeLandmarksFromVideoFrame(video: HTMLVideoElement) {
  if (!video || !video.videoWidth || !video.videoHeight || video.readyState < 2) {
    return null;
  }
  const faceapi = cachedFaceApi || (await loadModelsIfNeeded());
  const canvas = drawTrackingSquare(video, video.videoWidth, video.videoHeight);
  const result = await faceapi
    .detectSingleFace(canvas, trackingDetectorOptions(faceapi))
    .withFaceLandmarks(true);
  return result?.landmarks || null;
}

export async function compareFaceDescriptors(left: Float32Array, right: Float32Array) {
  const faceapi = cachedFaceApi || (await loadModelsIfNeeded());
  const distance = faceapi.euclideanDistance(left, right);
  return {
    distance,
    threshold: FACE_API_DISTANCE_THRESHOLD,
    matched: distance <= FACE_API_DISTANCE_THRESHOLD,
  };
}
