export type OptimizedCaptureOptions = {
  maxWidth?: number;
  quality?: number;
};

export const DEFAULT_CAPTURE_OPTIONS: Required<OptimizedCaptureOptions> = {
  maxWidth: 400,
  quality: 0.7,
};

export function captureVideoFrame(
  video: HTMLVideoElement,
  options: OptimizedCaptureOptions = {}
) {
  const { maxWidth, quality } = { ...DEFAULT_CAPTURE_OPTIONS, ...options };

  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("Camera preview is not ready yet.");
  }

  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to prepare image capture.");
  }

  // Keep the captured frame in the same left/right orientation as the live preview.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export function isImageDataUrl(value: string) {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(String(value || ""));
}
