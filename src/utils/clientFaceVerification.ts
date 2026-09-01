import {
  loadModelsIfNeeded,
  computeDescriptorFromImageURL,
  compareFaceDescriptors,
  FACE_API_DISTANCE_THRESHOLD,
} from "./faceApiLoader";

export const preloadClientFaceVerification = loadModelsIfNeeded;

export async function verifyClientFace(referenceImageUrl: string, liveImageUrl: string) {
  if (!referenceImageUrl) {
    throw new Error("Registered profile photo is unavailable.");
  }
  if (!liveImageUrl) {
    throw new Error("Live photo is unavailable.");
  }

  const [referenceDescriptor, liveDescriptor] = await Promise.all([
    computeDescriptorFromImageURL(referenceImageUrl),
    computeDescriptorFromImageURL(liveImageUrl),
  ]);

  const match = await compareFaceDescriptors(referenceDescriptor, liveDescriptor);

  return {
    matched: match.matched,
    distance: match.distance,
    threshold: match.threshold || FACE_API_DISTANCE_THRESHOLD,
  };
}

