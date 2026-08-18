const FACE_API_SCRIPT_URL =
  import.meta.env.VITE_FACE_API_SCRIPT_URL ||
  "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";

const FACE_API_MODEL_URL =
  import.meta.env.VITE_FACE_API_MODEL_URL ||
  "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights";

const configuredThreshold = Number(import.meta.env.VITE_FACE_API_DISTANCE_THRESHOLD || 0.5);
const FACE_MATCH_DISTANCE_THRESHOLD = Number.isFinite(configuredThreshold)
  ? configuredThreshold
  : 0.5;

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
  fetchImage: (uri: string) => Promise<HTMLImageElement>;
  detectSingleFace: (input: HTMLImageElement, options: unknown) => {
    withFaceLandmarks: (useTinyModel: boolean) => {
      withFaceDescriptor: () => Promise<{ descriptor: Float32Array } | undefined>;
    };
  };
  euclideanDistance: (left: Float32Array, right: Float32Array) => number;
};

declare global {
  interface Window {
    faceapi?: FaceApi;
  }
}

let faceApiPromise: Promise<FaceApi> | null = null;
let modelPromise: Promise<FaceApi> | null = null;
let referenceDescriptorCache: {
  imageUrl: string;
  descriptor: Promise<Float32Array>;
} | null = null;

function loadFaceApiScript(): Promise<FaceApi> {
  if (window.faceapi) return Promise.resolve(window.faceapi);
  if (faceApiPromise) return faceApiPromise;

  faceApiPromise = new Promise<FaceApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-face-api-url="${FACE_API_SCRIPT_URL}"]`
    );
    const script = existing || document.createElement("script");

    const handleLoad = () => {
      if (window.faceapi) {
        resolve(window.faceapi);
      } else {
        reject(new Error("Face verification library did not initialize."));
      }
    };
    const handleError = () => reject(new Error("Unable to load face verification library."));

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });

    if (!existing) {
      script.src = FACE_API_SCRIPT_URL;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.faceApiUrl = FACE_API_SCRIPT_URL;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    faceApiPromise = null;
    throw error;
  });

  return faceApiPromise;
}

export function preloadClientFaceVerification() {
  if (modelPromise) return modelPromise;

  modelPromise = loadFaceApiScript()
    .then(async (faceapi) => {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACE_API_MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(FACE_API_MODEL_URL),
      ]);
      return faceapi;
    })
    .catch((error) => {
      modelPromise = null;
      throw error;
    });

  return modelPromise;
}

async function createDescriptor(faceapi: FaceApi, imageUrl: string, label: string) {
  const image = await faceapi.fetchImage(imageUrl);
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 224,
    scoreThreshold: 0.5,
  });
  const detection = await faceapi
    .detectSingleFace(image, options)
    .withFaceLandmarks(true)
    .withFaceDescriptor();

  if (!detection?.descriptor) {
    throw new Error(`No clear face found in the ${label}.`);
  }

  return detection.descriptor;
}

export async function verifyClientFace(referenceImageUrl: string, liveImageUrl: string) {
  if (!referenceImageUrl) {
    throw new Error("Registered profile photo is unavailable.");
  }

  const faceapi = await preloadClientFaceVerification();
  if (!referenceDescriptorCache || referenceDescriptorCache.imageUrl !== referenceImageUrl) {
    referenceDescriptorCache = {
      imageUrl: referenceImageUrl,
      descriptor: createDescriptor(faceapi, referenceImageUrl, "registered profile photo"),
    };
    referenceDescriptorCache.descriptor.catch(() => {
      if (referenceDescriptorCache?.imageUrl === referenceImageUrl) {
        referenceDescriptorCache = null;
      }
    });
  }

  const [referenceDescriptor, liveDescriptor] = await Promise.all([
    referenceDescriptorCache.descriptor,
    createDescriptor(faceapi, liveImageUrl, "live photo"),
  ]);
  const distance = faceapi.euclideanDistance(referenceDescriptor, liveDescriptor);

  return {
    matched: distance <= FACE_MATCH_DISTANCE_THRESHOLD,
    distance,
    threshold: FACE_MATCH_DISTANCE_THRESHOLD,
  };
}
