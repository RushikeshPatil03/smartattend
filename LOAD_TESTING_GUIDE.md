# SmartAttend: Safe Local Load Testing Guide

This guide explains how to safely simulate classroom attendance bursts, measure throughput and latency percentiles, and verify database-level idempotency and concurrency before deploying to production.

---

## 1. Safety Principles & Architecture

> [!CAUTION]
> **Production Protection Guard:**
> The load test runner (`scripts/load-test.cjs`) is hardcoded to **block remote production domains** (`*.onrender.com`, `*.supabase.co`, `smartattend.*`) by default. Running high-burst load tests against Supabase Free Tier can exhaust connection limits, trigger API rate limits, or fill the 500 MB database quota.

- **Default Target:** `http://localhost:4000` (or `http://localhost:5000` via `TARGET_URL`).
- **Zero-Dependency Native Node.js Runner:** Uses `http.Agent` with `keepAlive: true` and socket pooling to simulate high-concurrency client check-ins without requiring global CLI installs.
- **Standalone Dry-Run Engine:** Allows testing the load runner and observing metrics immediately with `--dry-run` via an ephemeral mock server.

---

## 2. Test Profiles

| Profile | Requests | Concurrency | Target Duration | Purpose |
| :--- | :---: | :---: | :---: | :--- |
| **`smoke`** | 100 | 10 | ~5s | Quick sanity check to ensure the backend is responsive. |
| **`standard`** | 500 | 25 | ~15s | Simulates a typical classroom attendance rush (40–80 students per class). |
| **`burst`** | 1,000 | 50 | ~30s | Simulates peak auditorium or simultaneous multi-classroom check-in. |
| **`concurrency`** | 300 | 30 | ~10s | Rapid concurrent duplicate submissions for identical students to verify database unique constraint safety. |

---

## 3. How to Run the Tests

### Step 1: Start the Local Backend
Make sure your local SmartAttend backend is running:
```bash
npm run server:dev
# or from server/ directory:
npm run dev
```

### Step 2: (Optional) Generate a Safe Local Test Token
For authenticated endpoints (`/api/attendance/totp`, `/api/attendance/mark`), generate a mock student token:

```bash
# Generate a test student JWT
npm run test:generate-token

# In Bash / macOS / Linux:
export TEST_STUDENT_TOKEN="<token_output>"

# In Windows PowerShell:
$env:TEST_STUDENT_TOKEN="<token_output>"
```

### Step 3: Run the Load Test

#### Option A: Quick Dry-Run (No Database or Backend Required)
Test the load runner and verify scorecard metrics using the built-in mock server:
```bash
npm run test:load:dry
```

#### Option B: Smoke Test (100 Users)
```bash
npm run test:load:smoke
# or directly:
node scripts/load-test.cjs --profile=smoke
```

#### Option C: Standard Classroom Test (500 Users)
```bash
npm run test:load:standard
# or directly:
node scripts/load-test.cjs --profile=standard
```

#### Option D: High-Burst Test (1,000 Users over ~30s)
```bash
npm run test:load:burst
# or directly:
node scripts/load-test.cjs --profile=burst
```

#### Option E: Concurrency & Duplicate Safety Test
```bash
npm run test:load:concurrency
# or directly:
node scripts/load-test.cjs --profile=concurrency
```

---

## 4. Alternative: Running with Autocannon (Optional)

If you have `autocannon` installed or wish to use `npx`:

```bash
# Smoke test health check
npx autocannon -c 10 -d 10 http://localhost:4000/api/health

# Classroom burst simulation
npx autocannon -c 25 -a 500 -m POST \
  -H "Content-Type: application/json" \
  -b '{"sessionId":"00000000-0000-0000-0000-000000000101","studentId":"test-student-1"}' \
  http://localhost:4000/api/attendance/totp
```

---

## 5. Configuration Options & Environment Variables

| Variable / Flag | Default Value | Description |
| :--- | :--- | :--- |
| `TARGET_URL` or `--target=` | `http://localhost:4000` | Target backend URL (must be local). |
| `TEST_ENDPOINT` or `--endpoint=` | `/api/attendance/totp` | Attendance marking or health check endpoint. |
| `TEST_STUDENT_TOKEN` or `--token=` | `""` (empty) | Bearer token for authenticated requests. |
| `SESSION_ID` or `--session=` | `00000000-...-0101` | Mock session ID for attendance payload. |
| `--concurrency=` | Profile default | Max simultaneous socket connections. |
| `--requests=` | Profile default | Total request count. |
| `--dry-run` or `--mock` | `false` | Runs internal mock server for local verification. |
| `--force-prod` | `false` | Explicit override required to test non-local hosts. |

---

## 6. How to Interpret Results

When the test completes, a structured scorecard is printed:

```text
==================================================================
 LOAD TEST RESULTS & METRICS SUMMARY                              
==================================================================
Total Requests:      500 / 500
Test Duration:       1.85 seconds
Throughput:          270.3 req/sec
------------------------------------------------------------------
Latency Distribution:
  Min:               15.2 ms
  Mean (Avg):        32.4 ms
  p50 (Median):      30.1 ms
  p90:               55.8 ms
  p95:               68.2 ms
  p99:               94.5 ms
  Max:               112.0 ms
------------------------------------------------------------------
HTTP Status Code Breakdown:
  HTTP 200:         500 (100.0%)
------------------------------------------------------------------
Error Summary:
  2xx Success:       500
  4xx Client/Auth:   0
  5xx Server Errors: 0
  Timeouts:          0
  Network Failures:  0
  Clean Duplicates:  120 (idempotent 200 acknowledged)
==================================================================
 ACCEPTANCE CRITERIA SCORECARD                                    
==================================================================
[PASS] 0% 5xx Server Errors:       0 internal errors
[PASS] p95 Latency below 500ms:    68.2 ms
[PASS] p99 Latency below 1000ms:   94.5 ms
[PASS] Duplicate Concurrency Safety: 120 duplicates cleanly recognized
------------------------------------------------------------------
OVERALL STATUS: ALL TARGETS MET ✓
==================================================================
```

### Metrics Breakdown:
1. **Throughput (req/sec):** The number of check-in requests processed per second. Standard targets for local Node are >200 req/sec.
2. **p50 (Median):** 50% of students experienced response times lower than this figure.
3. **p95 / p99 Latency:** The tail latency for the slowest 5% and 1% of students. Must remain under 500ms (p95) and 1000ms (p99).
4. **5xx Server Errors:** Any non-zero count indicates unhandled promise rejections, database connection drops, or uncaught server exceptions. Must be **0%**.
5. **Clean Duplicates:** In concurrency testing, duplicate requests for the same student must return clean HTTP 200 responses with `alreadyMarked: true` rather than SQL errors or duplicates in the database.

---

## 7. Free-Tier Deployment Considerations

When moving from local testing to staging/production on Render and Supabase free tier:
- **Connection Pooling:** Ensure production connects via the Supavisor Transaction Pooler on port `6543` (`DATABASE_URL`).
- **Batch Processing:** SmartAttend's backend uses a 60ms batch window (`AttendanceBatchWriter`) to coalesce multiple student check-ins into single database upserts, protecting free-tier connection limits.
- **Do not run 1,000-user load tests on the live Supabase free tier**, as Supabase enforces rate limits on direct database connections and may throttle your project. Always verify high bursts locally or in `--dry-run` mode.
