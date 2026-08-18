const FACE_SIGNATURE_GRID_SIZE = 16;
export const FACE_SIGNATURE_VERSION = `grid${FACE_SIGNATURE_GRID_SIZE}-v1`;

type FaceSignatureOptions = {
  mirror?: boolean;
};

export type FaceSignaturePayload = {
  version: string;
  signature: string;
  gridSize: number;
};

function createImageElement(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (!dataUrl.startsWith("data:")) {
      image.crossOrigin = "anonymous";
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to process face image."));
    image.src = dataUrl;
  });
}

function cropFaceSquare(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  mirror: boolean
) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const squareSize = Math.min(width, height);
  const sourceX = (width - squareSize) / 2;
  const sourceY = Math.max(0, (height - squareSize) / 2 - height * 0.08);

  ctx.save();
  if (mirror) {
    ctx.translate(FACE_SIGNATURE_GRID_SIZE, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    squareSize,
    squareSize,
    0,
    0,
    FACE_SIGNATURE_GRID_SIZE,
    FACE_SIGNATURE_GRID_SIZE
  );
  ctx.restore();
}

function quantizeImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  options: FaceSignatureOptions = {}
) {
  ctx.clearRect(0, 0, FACE_SIGNATURE_GRID_SIZE, FACE_SIGNATURE_GRID_SIZE);
  cropFaceSquare(ctx, image, Boolean(options.mirror));

  const { data } = ctx.getImageData(
    0,
    0,
    FACE_SIGNATURE_GRID_SIZE,
    FACE_SIGNATURE_GRID_SIZE
  );

  const grayscale: number[] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < data.length; index += 4) {
    const gray =
      data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    grayscale.push(gray);
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }

  const span = Math.max(max - min, 1);
  return grayscale
    .map((gray) => {
      const normalized = (gray - min) / span;
      return Math.max(0, Math.min(15, Math.round(normalized * 15)))
        .toString(16);
    })
    .join("");
}

async function buildSignature(
  dataUrl: string,
  options: FaceSignatureOptions = {}
): Promise<FaceSignaturePayload> {
  const raw = String(dataUrl || "").trim();
  if (!raw.startsWith("data:image/") && !raw.startsWith("/") && !/^https?:\/\//i.test(raw)) {
    throw new Error("A valid face image is required.");
  }

  const image = await createImageElement(raw);
  const canvas = document.createElement("canvas");
  canvas.width = FACE_SIGNATURE_GRID_SIZE;
  canvas.height = FACE_SIGNATURE_GRID_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("Face verification is not supported in this browser.");
  }

  return {
    version: FACE_SIGNATURE_VERSION,
    signature: quantizeImage(ctx, image, options),
    gridSize: FACE_SIGNATURE_GRID_SIZE,
  };
}

export async function buildFaceSignatures(dataUrl: string) {
  const [primary, mirror] = await Promise.all([
    buildSignature(dataUrl),
    buildSignature(dataUrl, { mirror: true }),
  ]);

  return {
    version: primary.version,
    signature: primary.signature,
    mirrorSignature: mirror.signature,
    gridSize: primary.gridSize,
  };
}
