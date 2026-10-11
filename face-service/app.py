import asyncio
import base64
from contextlib import asynccontextmanager
import logging
import os
from typing import Any, Dict

import cv2
from deepface import DeepFace
from fastapi import FastAPI, HTTPException, status
import numpy as np
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("face-service")

MODEL_NAME = os.getenv("FACE_MODEL_NAME", "Facenet512")
DETECTOR_BACKEND = os.getenv("FACE_DETECTOR_BACKEND", "mediapipe")

# Bounded inference concurrency to avoid GIL & CPU thrashing under rush loads
MAX_CONCURRENT_INFERENCES = int(
    os.getenv("MAX_CONCURRENT_INFERENCES", max(1, os.cpu_count() or 2))
)
inference_semaphore = asyncio.Semaphore(MAX_CONCURRENT_INFERENCES)

# Global warm-up tracking state
is_warmed_up = False


def _warmup_model_sync() -> None:
    """Preload model weights and detector backend in background thread to avoid cold starts."""
    dummy_img = np.zeros((224, 224, 3), dtype=np.uint8)
    try:
        # Build model graph and run dummy represent call
        DeepFace.build_model(MODEL_NAME)
    except Exception as build_err:
        logger.warning(f"[Warmup] DeepFace.build_model notice: {build_err}")

    try:
        DeepFace.represent(
            img_path=dummy_img,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=False,
            align=False,
        )
        logger.info(f"[Warmup] {MODEL_NAME} model and {DETECTOR_BACKEND} detector pre-loaded successfully.")
    except Exception as rep_err:
        logger.warning(f"[Warmup] Dummy represent run notice: {rep_err}")


async def warmup_model() -> None:
    global is_warmed_up
    try:
        await asyncio.to_thread(_warmup_model_sync)
        is_warmed_up = True
    except Exception as e:
        logger.error(f"[Warmup] Model warm-up encountered an error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up FaceNet512 and detector on container boot
    logger.info(
        f"[Startup] Initializing FaceNet service (Concurrency limit: {MAX_CONCURRENT_INFERENCES}, Detector: {DETECTOR_BACKEND})..."
    )
    await warmup_model()
    yield
    logger.info("[Shutdown] FaceNet service shutting down cleanly.")


app = FastAPI(
    title="Smart Attendance FaceNet512 Service",
    lifespan=lifespan,
)


class EmbedRequest(BaseModel):
    imageDataUrl: str
    model: str | None = None
    modelVersion: str | None = None
    context: Dict[str, Any] | None = None


def decode_image_data_url_to_cv2(value: str) -> np.ndarray:
    raw = (value or "").strip()
    if not raw.startswith("data:image/") or ";base64," not in raw:
        raise ValueError("A valid base64 image data URL is required")

    _, encoded = raw.split(";base64,", 1)
    image_bytes = base64.b64decode(encoded, validate=True)
    nparr = np.frombuffer(image_bytes, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img_bgr is None:
        raise ValueError("Invalid or corrupt image format")

    return img_bgr


@app.get("/health")
async def health():
    return {
        "ok": True,
        "model": MODEL_NAME,
        "detector": DETECTOR_BACKEND,
        "concurrency_limit": MAX_CONCURRENT_INFERENCES,
        "is_warmed_up": is_warmed_up,
    }


@app.post("/embed")
async def embed_face(payload: EmbedRequest):
    try:
        img_bgr = decode_image_data_url_to_cv2(payload.imageDataUrl)
    except ValueError as val_err:
        return {"ok": False, "error": str(val_err)}
    except Exception as err:
        return {"ok": False, "error": f"Failed to decode image: {err}"}

    try:
        # Bounded concurrency via Semaphore + offloaded to worker threadpool
        async with inference_semaphore:
            representations = await asyncio.to_thread(
                DeepFace.represent,
                img_path=img_bgr,
                model_name=MODEL_NAME,
                detector_backend=DETECTOR_BACKEND,
                enforce_detection=True,
                align=True,
            )

        if not representations:
            return {"ok": False, "error": "No face detected"}

        if len(representations) != 1:
            return {"ok": False, "error": "Only one face should be visible"}

        embedding = representations[0].get("embedding")
        if not embedding:
            return {"ok": False, "error": "Face embedding was not generated"}

        return {
            "ok": True,
            "embedding": embedding,
            "model": "facenet512",
            "modelVersion": payload.modelVersion or "facenet512-v1",
            "quality": {
                "detector": DETECTOR_BACKEND,
                "faceConfidence": representations[0].get("face_confidence"),
                "facialArea": representations[0].get("facial_area"),
            },
        }

    except Exception as ex:
        err_msg = str(ex)
        # DeepFace raises ValueError when face is not found or multiple faces detected
        if "Face could not be detected" in err_msg or "no face" in err_msg.lower():
            return {"ok": False, "error": "No face detected"}
        if "more than one face" in err_msg.lower():
            return {"ok": False, "error": "Only one face should be visible"}

        logger.warning(f"[Embed] DeepFace inference warning: {err_msg}")
        return {"ok": False, "error": err_msg}
