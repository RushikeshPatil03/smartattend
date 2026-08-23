const FACE_API_SCRIPT_URL =
  import.meta.env.VITE_FACEAPI_SCRIPT_URL ||
  import.meta.env.VITE_FACE_API_SCRIPT_URL ||
  "/models/face-api.min.js";
const FACE_API_MODEL_URL =
  import.meta.env.VITE_FACEAPI_MODEL_URL ||
  import.meta.env.VITE_FACE_API_MODEL_URL ||
  "/models";

// Tiny models remain reliable at this size while avoiding full camera-frame inference.
export const FACE_API_INPUT_SIZE = Math.max(
  128,
  Math.min(224, Number(import.meta.env.VITE_FACEAPI_INPUT_SIZE || 160))
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
  detectSingleFace: (input: HTMLCanvasElement, options: unknown) => {
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
const memoryDescriptorCache = new Map<string, Float32Array>();

function descriptorCacheKey(url: string) {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `faceapi-profile-v1-${(hash >>> 0).toString(36)}`;
}

function loadScript() {
  if (window.faceapi) return Promise.resolve(window.faceapi);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<FaceApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-face-api]");
    const script = existing || document.createElement("script");
    const loaded = () =>
      window.faceapi
        ? resolve(window.faceapi)
        : reject(new Error("Face verification library did not initialize."));
    const failed = () => reject(new Error("Unable to load face verification library."));

    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) {
      script.src = FACE_API_SCRIPT_URL;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.faceApi = "true";
      document.head.appendChild(script);
    }
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

export function loadModelsIfNeeded() {
  if (modelsPromise) return modelsPromise;
  modelsPromise = loadScript()
    .then(async (faceapi) => {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACE_API_MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(FACE_API_MODEL_URL),
      ]);
      return faceapi;
    })
    .catch((error) => {
      modelsPromise = null;
      throw error;
    });
  return modelsPromise;
}

function drawSmallSquare(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = FACE_API_INPUT_SIZE;
  canvas.height = FACE_API_INPUT_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
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

function detectorOptions(faceapi: FaceApi) {
  return new faceapi.TinyFaceDetectorOptions({
    inputSize: FACE_API_INPUT_SIZE >= 224 ? 224 : 160,
    scoreThreshold: 0.5,
  });
}

async function detectDescriptor(faceapi: FaceApi, canvas: HTMLCanvasElement) {
  const result = await faceapi
    .detectSingleFace(canvas, detectorOptions(faceapi))
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  if (!result?.descriptor) throw new Error("No clear single face was found.");
  return result.descriptor;
}

export async function computeDescriptorFromImageURL(url: string) {
  const cached = memoryDescriptorCache.get(url);
  if (cached) return cached;

  const cacheKey = descriptorCacheKey(url);
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

  const [faceapi, image] = await Promise.all([loadModelsIfNeeded(), loadImage(url)]);
  const canvas = drawSmallSquare(
    image,
    image.naturalWidth || image.width,
    image.naturalHeight || image.height
  );
  const descriptor = await detectDescriptor(faceapi, canvas);
  memoryDescriptorCache.set(url, descriptor);
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(Array.from(descriptor)));
  } catch {
    // The descriptor remains cached in memory for this page session.
  }
  return descriptor;
}

export async function computeDescriptorFromVideoFrame(video: HTMLVideoElement) {
  const faceapi = await loadModelsIfNeeded();
  const canvas = drawSmallSquare(video, video.videoWidth, video.videoHeight);
  return detectDescriptor(faceapi, canvas);
}

export async function computeLandmarksFromVideoFrame(video: HTMLVideoElement) {
  const faceapi = await loadModelsIfNeeded();
  const canvas = drawSmallSquare(video, video.videoWidth, video.videoHeight);
  const result = await faceapi
    .detectSingleFace(canvas, detectorOptions(faceapi))
    .withFaceLandmarks(true);
  return result?.landmarks || null;
}

export async function compareFaceDescriptors(left: Float32Array, right: Float32Array) {
  const faceapi = await loadModelsIfNeeded();
  const distance = faceapi.euclideanDistance(left, right);
  return {
    distance,
    threshold: FACE_API_DISTANCE_THRESHOLD,
    matched: distance <= FACE_API_DISTANCE_THRESHOLD,
  };
}
