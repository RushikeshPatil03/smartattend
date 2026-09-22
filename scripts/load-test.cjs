#!/usr/bin/env node
/**
 * Safe Local Load Testing Suite for SmartAttend
 * 
 * Simulates high-concurrency classroom attendance bursts against local backend.
 * Measures throughput, latency percentiles (p50, p90, p95, p99), error rates,
 * and verifies database idempotency under rapid duplicate submissions.
 * 
 * Safety:
 *   - Prohibits targeting remote production environments by default.
 *   - Supports isolated --dry-run mode with ephemeral mock server.
 * 
 * Usage:
 *   node scripts/load-test.cjs --profile=smoke
 *   node scripts/load-test.cjs --profile=standard
 *   node scripts/load-test.cjs --profile=burst
 *   node scripts/load-test.cjs --profile=concurrency
 *   node scripts/load-test.cjs --dry-run
 */

const http = require("node:http");
const https = require("node:https");
const { performance } = require("node:perf_hooks");
const urlModule = require("node:url");

// ============================================================================
// 1. CONFIGURATION & CLI ARGUMENT PARSING
// ============================================================================
const args = process.argv.slice(2);
const options = {
  profile: "smoke",
  target: process.env.TARGET_URL || "http://localhost:4000",
  endpoint: process.env.TEST_ENDPOINT || "/api/attendance/totp",
  token: process.env.TEST_STUDENT_TOKEN || process.env.TEST_TOKEN || "",
  sessionId: process.env.SESSION_ID || "00000000-0000-0000-0000-000000000101",
  dryRun: false,
  forceProd: false,
  requests: null,
  concurrency: null,
  durationSec: null,
  timeoutMs: 5000,
};

for (const arg of args) {
  if (arg.startsWith("--profile=")) options.profile = arg.split("=")[1].toLowerCase();
  if (arg.startsWith("--target=")) options.target = arg.split("=")[1];
  if (arg.startsWith("--endpoint=")) options.endpoint = arg.split("=")[1];
  if (arg.startsWith("--token=")) options.token = arg.split("=")[1];
  if (arg.startsWith("--session=")) options.sessionId = arg.split("=")[1];
  if (arg.startsWith("--requests=")) options.requests = parseInt(arg.split("=")[1], 10);
  if (arg.startsWith("--concurrency=")) options.concurrency = parseInt(arg.split("=")[1], 10);
  if (arg.startsWith("--duration=")) options.durationSec = parseInt(arg.split("=")[1], 10);
  if (arg.startsWith("--timeout=")) options.timeoutMs = parseInt(arg.split("=")[1], 10);
  if (arg === "--dry-run" || arg === "--mock") options.dryRun = true;
  if (arg === "--force-prod") options.forceProd = true;
}

// Profile presets
const PROFILES = {
  smoke: {
    name: "Smoke Test (Sanity & Warmup)",
    requests: 100,
    concurrency: 10,
    durationSec: 10,
    description: "100 requests with 10 concurrent clients to verify endpoint availability.",
  },
  standard: {
    name: "Standard Classroom Check-in",
    requests: 500,
    concurrency: 25,
    durationSec: 15,
    description: "500 requests simulating an active lecture hall check-in rush.",
  },
  burst: {
    name: "Auditorium / Multi-Class Burst",
    requests: 1000,
    concurrency: 50,
    durationSec: 30,
    description: "1000 requests over ~30 seconds testing high burst concurrency handling.",
  },
  concurrency: {
    name: "Duplicate & Race Condition Safety",
    requests: 300,
    concurrency: 30,
    durationSec: 10,
    description: "Sends rapid duplicate bursts for identical students mixed with unique students.",
  },
};

const activeProfile = PROFILES[options.profile] || PROFILES.smoke;
const TOTAL_REQUESTS = options.requests || activeProfile.requests;
const CONCURRENCY = options.concurrency || activeProfile.concurrency;

// ============================================================================
// 2. PRODUCTION SAFETY INTERCEPTOR
// ============================================================================
function isProductionUrl(urlString) {
  try {
    const parsed = new urlModule.URL(urlString);
    const host = parsed.hostname.toLowerCase();
    const isLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      host.endsWith(".internal");

    if (isLocal) return false;

    const prodPatterns = ["onrender.com", "supabase.co", "smartattend", "railway.app", "vercel.app", "fly.dev"];
    return prodPatterns.some((pattern) => host.includes(pattern));
  } catch {
    return false;
  }
}

if (!options.dryRun && isProductionUrl(options.target) && !options.forceProd) {
  console.error("==================================================================");
  console.error(" [SAFETY ERROR] TARGET APPEARS TO BE A REMOTE / PRODUCTION HOST   ");
  console.error(` Target: ${options.target}`);
  console.error(" Running load tests against production is blocked to prevent accidental");
  console.error(" downtime or database quota exhaustion on free-tier infrastructure.");
  console.error(" To run against local development, use: http://localhost:4000");
  console.error(" If you explicitly intend to test a staging server, pass: --force-prod");
  console.error("==================================================================");
  process.exit(1);
}

// ============================================================================
// 3. EPHEMERAL MOCK SERVER (FOR SAFE STANDALONE DRY-RUN)
// ============================================================================
function startMockServer() {
  return new Promise((resolve) => {
    const markedStudents = new Set();
    const server = http.createServer((req, res) => {
      // Simulate typical processing latency (10ms - 30ms)
      const simDelay = Math.floor(10 + Math.random() * 20);

      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });

      req.on("end", () => {
        setTimeout(() => {
          if (req.url === "/api/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: true, status: "healthy", timestamp: Date.now() }));
          }

          let parsed = {};
          try {
            parsed = JSON.parse(body);
          } catch {}

          const studentId = parsed.studentId || req.headers["x-test-student"] || "student-default";
          const dedupeKey = `${parsed.sessionId || "default-session"}:${studentId}`;

          if (markedStudents.has(dedupeKey)) {
            // Clean idempotent response
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(
              JSON.stringify({
                ok: true,
                already: true,
                alreadyMarked: true,
                status: "present",
                message: "Attendance already marked for this session",
              })
            );
          }

          markedStudents.add(dedupeKey);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              attendanceId: `mock-att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              status: "present",
              markedAt: new Date().toISOString(),
              message: "Attendance verified and recorded successfully",
            })
          );
        }, simDelay);
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

// ============================================================================
// 4. LOAD GENERATOR & METRIC ENGINE
// ============================================================================
async function runLoadTest(targetBaseUrl) {
  const targetUrl = new urlModule.URL(options.endpoint, targetBaseUrl).toString();
  const parsedTarget = new urlModule.URL(targetUrl);
  const isHttps = parsedTarget.protocol === "https:";

  // Pooled agent with keepAlive for realistic burst simulation
  const agent = isHttps
    ? new https.Agent({ keepAlive: true, maxSockets: CONCURRENCY })
    : new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY });

  console.log("==================================================================");
  console.log(` SmartAttend Load Test: ${activeProfile.name}`);
  console.log("==================================================================");
  console.log(`Target:      ${targetUrl}`);
  console.log(`Profile:     ${options.profile}`);
  console.log(`Requests:    ${TOTAL_REQUESTS}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Auth Mode:   ${options.token ? "Bearer Token Provided" : "Test Header / Mock Payload"}`);
  if (options.dryRun) {
    console.log("Execution:   DRY-RUN (Local Ephemeral Mock Server)");
  }
  console.log("------------------------------------------------------------------");
  console.log("Sending burst traffic...");

  const latencies = [];
  const statusCodes = {};
  let completed = 0;
  let success2xx = 0;
  let clientErrors4xx = 0;
  let serverErrors5xx = 0;
  let timeouts = 0;
  let networkErrors = 0;
  let duplicatesCleanlyHandled = 0;

  let requestIndex = 0;

  function makeRequest(index) {
    return new Promise((resolve) => {
      // Setup payload: in concurrency profile, intentionally repeat student IDs to test duplicates
      let studentId;
      if (options.profile === "concurrency") {
        // Group students into sets of 5 duplicates
        studentId = `student-group-${Math.floor(index / 5)}`;
      } else {
        studentId = `student-${index % 80}`; // simulates 80 unique students
      }

      const postData = JSON.stringify({
        sessionId: options.sessionId,
        studentId,
        totpCode: "123456",
        timestamp: Date.now(),
        location: { lat: 18.5204, lng: 73.8567, accuracy: 12 },
        fingerprint: `fp-${studentId}`,
      });

      const headers = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        "X-Test-Student": studentId,
      };

      if (options.token) {
        headers["Authorization"] = `Bearer ${options.token}`;
      }

      const reqOptions = {
        protocol: parsedTarget.protocol,
        hostname: parsedTarget.hostname,
        port: parsedTarget.port || (isHttps ? 443 : 80),
        path: parsedTarget.pathname + parsedTarget.search,
        method: "POST",
        headers,
        agent,
        timeout: options.timeoutMs,
      };

      const start = performance.now();
      const transport = isHttps ? https : http;

      const req = transport.request(reqOptions, (res) => {
        let resBody = "";
        res.on("data", (chunk) => {
          resBody += chunk;
        });

        res.on("end", () => {
          const duration = performance.now() - start;
          latencies.push(duration);
          completed += 1;

          const code = res.statusCode || 0;
          statusCodes[code] = (statusCodes[code] || 0) + 1;

          if (code >= 200 && code < 300) {
            success2xx += 1;
            try {
              const json = JSON.parse(resBody);
              if (json.already || json.alreadyMarked) {
                duplicatesCleanlyHandled += 1;
              }
            } catch {}
          } else if (code >= 400 && code < 500) {
            clientErrors4xx += 1;
          } else if (code >= 500) {
            serverErrors5xx += 1;
          }

          resolve();
        });
      });

      req.on("timeout", () => {
        timeouts += 1;
        req.destroy(new Error("Request timeout"));
      });

      req.on("error", (err) => {
        const duration = performance.now() - start;
        latencies.push(duration);
        completed += 1;
        networkErrors += 1;
        resolve();
      });

      req.write(postData);
      req.end();
    });
  }

  async function worker() {
    while (requestIndex < TOTAL_REQUESTS) {
      const current = requestIndex++;
      await makeRequest(current);
    }
  }

  const startTime = performance.now();
  const workers = Array.from({ length: Math.min(CONCURRENCY, TOTAL_REQUESTS) }, worker);
  await Promise.all(workers);
  const totalDurationMs = performance.now() - startTime;
  const totalDurationSec = totalDurationMs / 1000;

  // Destroy pooled sockets
  agent.destroy();

  // ============================================================================
  // 5. METRICS AGGREGATION & REPORTING
  // ============================================================================
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (p) => {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[index];
  };

  const minLatency = sorted[0] || 0;
  const maxLatency = sorted[sorted.length - 1] || 0;
  const meanLatency = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
  const p50 = percentile(50);
  const p90 = percentile(90);
  const p95 = percentile(95);
  const p99 = percentile(99);
  const rps = (completed / totalDurationSec).toFixed(1);

  console.log("\n==================================================================");
  console.log(" LOAD TEST RESULTS & METRICS SUMMARY                              ");
  console.log("==================================================================");
  console.log(`Total Requests:      ${completed} / ${TOTAL_REQUESTS}`);
  console.log(`Test Duration:       ${totalDurationSec.toFixed(2)} seconds`);
  console.log(`Throughput:          ${rps} req/sec`);
  console.log("------------------------------------------------------------------");
  console.log("Latency Distribution:");
  console.log(`  Min:               ${minLatency.toFixed(1)} ms`);
  console.log(`  Mean (Avg):        ${meanLatency.toFixed(1)} ms`);
  console.log(`  p50 (Median):      ${p50.toFixed(1)} ms`);
  console.log(`  p90:               ${p90.toFixed(1)} ms`);
  console.log(`  p95:               ${p95.toFixed(1)} ms`);
  console.log(`  p99:               ${p99.toFixed(1)} ms`);
  console.log(`  Max:               ${maxLatency.toFixed(1)} ms`);
  console.log("------------------------------------------------------------------");
  console.log("HTTP Status Code Breakdown:");
  for (const [code, count] of Object.entries(statusCodes)) {
    const pct = ((count / completed) * 100).toFixed(1);
    console.log(`  HTTP ${code}:         ${count} (${pct}%)`);
  }
  if (Object.keys(statusCodes).length === 0) {
    console.log("  No successful HTTP responses received (Target unreachable)");
  }
  console.log("------------------------------------------------------------------");
  console.log("Error Summary:");
  console.log(`  2xx Success:       ${success2xx}`);
  console.log(`  4xx Client/Auth:   ${clientErrors4xx}`);
  console.log(`  5xx Server Errors: ${serverErrors5xx}`);
  console.log(`  Timeouts:          ${timeouts}`);
  console.log(`  Network Failures:  ${networkErrors}`);
  if (options.profile === "concurrency" || duplicatesCleanlyHandled > 0) {
    console.log(`  Clean Duplicates:  ${duplicatesCleanlyHandled} (idempotent 200 acknowledged)`);
  }

  console.log("==================================================================");
  console.log(" ACCEPTANCE CRITERIA SCORECARD                                    ");
  console.log("==================================================================");

  const pass5xx = serverErrors5xx === 0 && networkErrors === 0;
  const passP95 = p95 < 500;
  const passP99 = p99 < 1000;
  const passDuplicates = options.profile !== "concurrency" || duplicatesCleanlyHandled > 0;

  console.log(`[${pass5xx ? "PASS" : "FAIL"}] 0% 5xx Server Errors:       ${serverErrors5xx} internal errors`);
  console.log(`[${passP95 ? "PASS" : "FAIL"}] p95 Latency below 500ms:    ${p95.toFixed(1)} ms`);
  console.log(`[${passP99 ? "PASS" : "FAIL"}] p99 Latency below 1000ms:   ${p99.toFixed(1)} ms`);
  if (options.profile === "concurrency") {
    console.log(`[${passDuplicates ? "PASS" : "FAIL"}] Duplicate Concurrency Safety: ${duplicatesCleanlyHandled} duplicates cleanly recognized`);
  }

  const allPassed = pass5xx && passP95 && passP99 && passDuplicates;
  console.log("------------------------------------------------------------------");
  console.log(`OVERALL STATUS: ${allPassed ? "ALL TARGETS MET ✓" : "TARGETS EXCEEDED / FAILED ✗"}`);
  console.log("==================================================================\n");

  return { allPassed, completed, rps, p50, p95, p99, serverErrors5xx };
}

// ============================================================================
// 6. MAIN EXECUTION DISPATCHER
// ============================================================================
async function main() {
  if (options.dryRun) {
    const { server, url } = await startMockServer();
    try {
      await runLoadTest(url);
    } finally {
      server.close();
    }
  } else {
    try {
      await runLoadTest(options.target);
    } catch (err) {
      if (err.code === "ECONNREFUSED" || err.message.includes("fetch failed")) {
        console.error("\n[ERROR] Unable to connect to target backend at:", options.target);
        console.error("Please make sure your local server is running:");
        console.error("  npm run server:dev  (or npm start in server/)");
        console.error("\nAlternatively, you can test this load testing harness in dry-run mode:");
        console.error("  node scripts/load-test.cjs --dry-run\n");
        process.exit(1);
      }
      throw err;
    }
  }
}

main().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
