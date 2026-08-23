# Face Verification Upgrade

The attendance flow now supports:

- MediaPipe face detection in the browser for fast face quality gating.
- FaceNet512 verification through an optional backend face service.
- Legacy grid signatures as a fallback for existing users if the FaceNet512 service is not configured.

## Frontend MediaPipe

The browser loads MediaPipe Tasks Vision and BlazeFace detector from local static storage in `public/models/mediapipe/`. Default environment values:

```env
VITE_MEDIAPIPE_WASM_BASE_URL=/models/mediapipe/wasm
VITE_MEDIAPIPE_FACE_DETECTOR_MODEL_URL=/models/mediapipe/blaze_face_short_range.tflite
```

## Client-Side Attendance Verification & Randomized Challenge Liveness

Student attendance uses the front-camera capture after MediaPipe reports one centered,
stable face. The browser loads `face-api.js` and its tiny models locally from `/models/`,
randomly assigns one of three micro-challenges:
1. `BLINK`: Eye Aspect Ratio (EAR) drops below 0.20 and recovers to >= 0.23.
2. `TURN_LEFT`: Nose landmark horizontal shift towards the left boundary.
3. `TURN_RIGHT`: Nose landmark horizontal shift towards the right boundary.

Once the challenge passes within 3.0 seconds, it compares a 160 px live-frame descriptor with the registered
profile-photo descriptor. The profile descriptor is cached in memory and `sessionStorage`; live
frames and descriptors are never sent to the server. A successful face and liveness result unlocks
attendance for 60 seconds.

Model files can be re-downloaded or verified anytime with:
```bash
npm run models:download
```

Default tuning values:

```env
VITE_FACEAPI_SCRIPT_URL=/models/face-api.min.js
VITE_FACEAPI_MODEL_URL=/models
VITE_FACEAPI_INPUT_SIZE=160
VITE_FACEAPI_DISTANCE_THRESHOLD=0.45
VITE_FACEAPI_MOVEMENT_MAX_TIME_MS=3200
VITE_FACEAPI_MOVEMENT_SAMPLE_FPS=8
VITE_FACEAPI_MOVEMENT_TRANSLATE_THRESHOLD=0.045
VITE_FACEAPI_MOVEMENT_ROTATION_THRESHOLD=0.045
VITE_FACEAPI_LEGACY_SCORE_THRESHOLD=0.78
```

Lower face-distance thresholds are stricter but can increase false rejections. Camera angle,
lighting, image quality, glasses, and device performance affect biometric results, so thresholds
must be validated on representative devices rather than treated as a 100% accuracy guarantee.
If descriptor extraction fails after liveness has passed, same-origin or CORS-enabled profile
photos can use the existing local grid-signature comparison. Failure to run liveness remains
fail-closed.

## FaceNet512 Service

Run the optional Python service:

```bash
cd face-service
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Then configure the Node server:

```env
FACENET512_SERVICE_URL=http://localhost:8000
FACENET512_DISTANCE_THRESHOLD=0.38
REQUIRE_FACE_VERIFICATION=true
```

When `FACENET512_SERVICE_URL` is set, new student registrations store a FaceNet512 embedding. Attendance verification compares the live selfie against that embedding. Existing students without embeddings continue through the legacy fallback unless `FACE_VERIFICATION_STRICT_SERVICE=true` is set.
