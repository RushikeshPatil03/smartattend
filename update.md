# MASTER PROMPT: Finalize High Concurrency Stack (Frontend Lockdown & Automated Docker Initialization)

## 🎯 Goal
Implement the final two structural changes required to complete the high-concurrency architecture:
1. Locate and lock down the **React Frontend Socket.IO client** initialization to use pure, immediate WebSockets.
2. Automate the **Docker backend database lifecycle** so running the backend startup script automatically launches the Docker Redis/MongoDB containers first.

---

## 🚦 Strict Operational Guidelines
1. **No Logic Changes:** Do not alter the core business workflows (Face verification -> QR verification -> Geofence radius check -> Attendance logging).
2. **Fail Closed on Databases:** The backend must never execute its boot sequence if the Docker Redis or MongoDB instances fail to launch or accept connections.
3. **No Legacy Fallbacks:** Ensure the frontend bypasses standard HTTP long-polling handshakes completely to avoid multi-worker `400 Bad Request` socket errors.

---

## 💻 Code Modification Requirements (VS Code / Codex Task)

### 1. Part 1: Frontend Client Socket Lockdown
Scan the frontend directories (`src/`, `src/context/`, `src/hooks/`, or `src/utils/`) to find where the `socket.io-client` instance is initialized. Rewrite the initialization instance to match this configuration exactly:

```javascript
import { io } from "socket.io-client";

const socket = io(import.meta.env.VITE_API_URL || "http://localhost:5000", {
  transports: ["websocket"],  // Force pure WebSockets immediately
  upgrade: false,             // Completely disable HTTP long-polling upgrades
  rememberUpgrade: true,      // Cache the websocket protocol status
  reconnectionAttempts: 5,    // Bound reconnect loops on student drops
  timeout: 10000              // 10 seconds connectivity allowance
});

export default socket;
```

### 2. Part 2: Automated Docker Orchestration on Startup
Modify the primary root `package.json` and your startup script setups (such as `server/index.js` or separate start scripts) to automatically orchestrate the Docker layer:
- Update the main `"start"` or dev script in `package.json` to safely run `docker compose up -d` before booting the application via PM2 or node.
- Ensure the orchestration uses detached mode (`-d`) so the terminal is not blocked by database stream output.

```json
// Example execution script structure to implement:
"scripts": {
  "infra:up": "docker compose up -d",
  "prod:start": "npm run infra:up && pm2-runtime start ecosystem.config.cjs"
}
```

---

## 🤖 Instructions for AI Engine
1. Search across the entire `src/` folder for references to `socket.io-client` or `io(`. Apply the pure websocket options parameters precisely without stripping any custom headers or query tokens currently passed during authorization handshakes.
2. Read `package.json` in the root and server directory. Inject a cohesive orchestration lifecycle step that spins up `docker compose` immediately prior to the execution of your PM2 cluster files or main server index paths.
3. Verify that all modifications do not alter existing environment variables or MongoDB URI references.
4. Output the updated frontend file containing the socket connection definition and the modified `package.json` script section.
