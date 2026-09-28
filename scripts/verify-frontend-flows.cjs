/**
 * Verification Suite for Login, Register, and AdminRegister Performance & Stability Pass
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

console.log("==================================================================");
console.log(" Running SmartAttend Auth & Registration Verification Suite       ");
console.log("==================================================================");

// 1. Verify index.html contains no global face-model prefetches
console.log("\nTest 1: Verifying index.html resource hints...");
const indexHtml = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const distIndexHtml = fs.readFileSync(path.join(__dirname, "../dist/index.html"), "utf8");

assert(!indexHtml.includes("/models/face-api.min.js"), "index.html must not prefetch face-api.min.js");
assert(!indexHtml.includes("tiny_face_detector_model-weights_manifest.json"), "index.html must not prefetch tiny detector manifest");
assert(!indexHtml.includes("face_recognition_model-weights_manifest.json"), "index.html must not prefetch face recognition manifest");
assert(!distIndexHtml.includes("/models/face-api.min.js"), "dist/index.html must not prefetch face-api.min.js");
console.log("✓ Passed: Global face model prefetching completely removed from index.html.");

// 2. Verify font loading optimization
console.log("\nTest 2: Verifying font loading configuration...");
assert(indexHtml.includes("family=Inter:wght@400;500;600;700;800&display=swap"), "index.html must request optimized font weights with display=swap");
const indexCss = fs.readFileSync(path.join(__dirname, "../src/index.css"), "utf8");
assert(indexCss.includes("font-size-adjust: 0.548"), "index.css must include font-size-adjust: 0.548 for metric fallback normalization");
assert(indexCss.includes("scrollbar-gutter: stable"), "index.css must include scrollbar-gutter: stable for horizontal layout stability");
console.log("✓ Passed: Font loading uses display:swap, 0.548 metric fallback, and stable scrollbar gutter.");

// 3. Verify chunk isolation & no face model imports in Login or AdminRegister
console.log("\nTest 3: Verifying chunk isolation for Login, Register, and AdminRegister...");
const distAssets = fs.readdirSync(path.join(__dirname, "../dist/assets"));
const loginChunk = distAssets.find((f) => f.startsWith("Login-") && f.endsWith(".js"));
const registerChunk = distAssets.find((f) => f.startsWith("Register-") && f.endsWith(".js"));
const adminRegisterChunk = distAssets.find((f) => f.startsWith("AdminRegister-") && f.endsWith(".js"));

assert(loginChunk, "Login chunk must exist");
assert(registerChunk, "Register chunk must exist");
assert(adminRegisterChunk, "AdminRegister chunk must exist");

const loginContent = fs.readFileSync(path.join(__dirname, "../dist/assets", loginChunk), "utf8");
const adminRegisterContent = fs.readFileSync(path.join(__dirname, "../dist/assets", adminRegisterChunk), "utf8");
const registerContent = fs.readFileSync(path.join(__dirname, "../dist/assets", registerChunk), "utf8");

assert(!loginContent.includes("@mediapipe/tasks-vision"), "Login chunk must not bundle mediapipe");
assert(!loginContent.includes("face-api.min.js"), "Login chunk must not bundle face-api");
assert(!adminRegisterContent.includes("@mediapipe/tasks-vision"), "AdminRegister chunk must not bundle mediapipe");
assert(!adminRegisterContent.includes("face-api.min.js"), "AdminRegister chunk must not bundle face-api");
console.log("✓ Passed: Login and AdminRegister chunks are 100% free of face-api/MediaPipe code.");

// 4. Verify Register.tsx does not prematurely trigger face-api models
console.log("\nTest 4: Verifying Register.tsx face-api loader elimination...");
const registerSrc = fs.readFileSync(path.join(__dirname, "../src/pages/Register.tsx"), "utf8");
assert(!registerSrc.includes("m.loadModelsIfNeeded()"), "Register.tsx must not contain premature loadModelsIfNeeded timer");
console.log("✓ Passed: Register.tsx does not load face-api models during initial render.");

// 5. Verify LivePhotoCapture gates preloadForStudent on reference photo
console.log("\nTest 5: Verifying LivePhotoCapture reference photo gating...");
const livePhotoSrc = fs.readFileSync(path.join(__dirname, "../src/components/LivePhotoCapture.tsx"), "utf8");
assert(livePhotoSrc.includes("faceVerificationReferenceUrl && faceVerificationReferenceUrl.trim().length > 5"), "LivePhotoCapture must gate preloadForStudent");
console.log("✓ Passed: LivePhotoCapture strictly skips neural model preloading during student registration.");

// 6. Verify in-flight submit locking
console.log("\nTest 6: Verifying in-flight submit locking across Login, Register, AdminRegister...");
const loginSrc = fs.readFileSync(path.join(__dirname, "../src/pages/Login.tsx"), "utf8");
const adminRegSrc = fs.readFileSync(path.join(__dirname, "../src/pages/AdminRegister.tsx"), "utf8");

assert(loginSrc.includes("inFlightSubmitRef.current"), "Login.tsx must protect handleLogin with inFlightSubmitRef");
assert(registerSrc.includes("inFlightSubmitRef.current"), "Register.tsx must protect handleSubmit with inFlightSubmitRef");
assert(adminRegSrc.includes("inFlightSubmitRef.current"), "AdminRegister.tsx must protect handleSubmit with inFlightSubmitRef");
console.log("✓ Passed: All three auth pages enforce synchronous inFlightSubmitRef locking.");

// 7. Verify iOS zoom prevention (text-base sm:text-sm)
console.log("\nTest 7: Verifying iOS auto-zoom prevention...");
assert(loginSrc.includes("text-base sm:text-sm"), "Login.tsx FloatingInput must use text-base sm:text-sm");
assert(registerSrc.includes("text-base sm:text-sm"), "Register.tsx FloatingInput must use text-base sm:text-sm");
assert(adminRegSrc.includes("text-base sm:text-sm"), "AdminRegister.tsx FloatingInput must use text-base sm:text-sm");
console.log("✓ Passed: Floating inputs use 16px on mobile viewports to prevent iOS Safari auto-zoom.");

// 8. Verify Workbox globIgnores
console.log("\nTest 8: Verifying PWA Workbox model exclusion...");
const viteConfig = fs.readFileSync(path.join(__dirname, "../vite.config.ts"), "utf8");
assert(viteConfig.includes('globIgnores: ["**/models/**"]'), "vite.config.ts must exclude models from service worker precache");
console.log("✓ Passed: Service worker precache excludes large neural models and manifests.");

console.log("\n==================================================================");
console.log(" ALL AUTH & REGISTRATION VERIFICATION TESTS PASSED (8/8)         ");
console.log("==================================================================");
