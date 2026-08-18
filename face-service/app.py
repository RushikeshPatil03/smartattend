import base64
import os
import tempfile
from typing import Any, Dict

from deepface import DeepFace
from fastapi import FastAPI
from pydantic import BaseModel


MODEL_NAME = os.getenv("FACE_MODEL_NAME", "Facenet512")
DETECTOR_BACKEND = os.getenv("FACE_DETECTOR_BACKEND", "mediapipe")

app = FastAPI(title="Smart Attendance FaceNet512 Service")


class EmbedRequest(BaseModel):
    imageDataUrl: str
    model: str | None = None
    modelVersion: str | None = None
    context: Dict[str, Any] | None = None


def decode_image_data_url(value: str) -> bytes:
    raw = (value or "").strip()
    if not raw.startswith("data:image/") or ";base64," not in raw:
        raise ValueError("A valid base64 image data URL is required")

    _, encoded = raw.split(";base64,", 1)
    return base64.b64decode(encoded, validate=True)


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_NAME,
        "detector": DETECTOR_BACKEND,
    }


@app.post("/embed")
def embed_face(payload: EmbedRequest):
    image_bytes = decode_image_data_url(payload.imageDataUrl)

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp.write(image_bytes)
        tmp_path = tmp.name

    try:
        representations = DeepFace.represent(
            img_path=tmp_path,
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
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
