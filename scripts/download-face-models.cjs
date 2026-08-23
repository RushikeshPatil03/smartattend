const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const ROOT_DIR = path.resolve(__dirname, "..");
const MODELS_DIR = path.join(ROOT_DIR, "public", "models");
const MEDIAPIPE_DIR = path.join(MODELS_DIR, "mediapipe");
const MEDIAPIPE_WASM_DIR = path.join(MEDIAPIPE_DIR, "wasm");

const DOWNLOAD_TARGETS = [
  {
    name: "face-api.min.js",
    url: "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js",
    dest: path.join(MODELS_DIR, "face-api.min.js"),
  },
  {
    name: "tiny_face_detector_model-weights_manifest.json",
    url: "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/tiny_face_detector_model-weights_manifest.json",
    dest: path.join(MODELS_DIR, "tiny_face_detector_model-weights_manifest.json"),
  },
  {
    name: "tiny_face_detector_model-shard1",
    url: "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/tiny_face_detector_model-shard1",
    dest: path.join(MODELS_DIR, "tiny_face_detector_model-shard1"),
  },
  {
    name: "face_landmark_68_tiny_model-weights_manifest.json",
    url: "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_landmark_68_tiny_model-weights_manifest.json",
    dest: path.join(MODELS_DIR, "face_landmark_68_tiny_model-weights_manifest.json"),
  },
  {
    name: "face_landmark_68_tiny_model-shard1",
    url: "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_landmark_68_tiny_model-shard1",
    dest: path.join(MODELS_DIR, "face_landmark_68_tiny_model-shard1"),
  },
  {
    name: "face_recognition_model-weights_manifest.json",
    url: "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_recognition_model-weights_manifest.json",
    dest: path.join(MODELS_DIR, "face_recognition_model-weights_manifest.json"),
  },
  {
    name: "face_recognition_model-shard1",
    url: "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_recognition_model-shard1",
    dest: path.join(MODELS_DIR, "face_recognition_model-shard1"),
  },
  {
    name: "face_recognition_model-shard2",
    url: "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/face_recognition_model-shard2",
    dest: path.join(MODELS_DIR, "face_recognition_model-shard2"),
  },
  {
    name: "blaze_face_short_range.tflite",
    url: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
    dest: path.join(MEDIAPIPE_DIR, "blaze_face_short_range.tflite"),
  },
];

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const parentDir = path.dirname(destPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadFile(response.headers.location, destPath)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url} - Status ${response.statusCode}`));
      }

      const fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);

      fileStream.on("finish", () => {
        fileStream.close(() => resolve());
      });

      fileStream.on("error", (err) => {
        fs.unlink(destPath, () => reject(err));
      });
    });

    request.on("error", (err) => {
      fs.unlink(destPath, () => reject(err));
    });
  });
}

function copyMediaPipeWasmFiles() {
  const nodeWasmDir = path.join(ROOT_DIR, "node_modules", "@mediapipe", "tasks-vision", "wasm");
  if (!fs.existsSync(nodeWasmDir)) {
    console.warn("MediaPipe wasm directory not found in node_modules.");
    return;
  }

  if (!fs.existsSync(MEDIAPIPE_WASM_DIR)) {
    fs.mkdirSync(MEDIAPIPE_WASM_DIR, { recursive: true });
  }

  const wasmFiles = fs.readdirSync(nodeWasmDir);
  for (const file of wasmFiles) {
    const srcFile = path.join(nodeWasmDir, file);
    if (fs.statSync(srcFile).isFile()) {
      // Copy to both /models/mediapipe/wasm/ and /models/mediapipe/ for compatibility
      fs.copyFileSync(srcFile, path.join(MEDIAPIPE_WASM_DIR, file));
      fs.copyFileSync(srcFile, path.join(MEDIAPIPE_DIR, file));
      console.log(`✓ Copied WASM asset: ${file}`);
    }
  }
}

async function main() {
  console.log("=== Localizing Face Models to public/models/ ===");

  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }
  if (!fs.existsSync(MEDIAPIPE_DIR)) {
    fs.mkdirSync(MEDIAPIPE_DIR, { recursive: true });
  }

  for (const item of DOWNLOAD_TARGETS) {
    if (fs.existsSync(item.dest) && fs.statSync(item.dest).size > 0) {
      console.log(`✓ Already exists: ${item.name} (${(fs.statSync(item.dest).size / 1024).toFixed(1)} KB)`);
      continue;
    }

    try {
      console.log(`↓ Downloading: ${item.name}...`);
      await downloadFile(item.url, item.dest);
      const sizeKb = (fs.statSync(item.dest).size / 1024).toFixed(1);
      console.log(`✓ Downloaded ${item.name} (${sizeKb} KB)`);
    } catch (err) {
      console.error(`✗ Error downloading ${item.name}:`, err.message);
      process.exitCode = 1;
    }
  }

  console.log("Copying MediaPipe WASM binaries...");
  copyMediaPipeWasmFiles();

  console.log("=== Face Model Localization Complete ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
