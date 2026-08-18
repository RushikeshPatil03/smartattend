const { performance } = require("node:perf_hooks");

const url = process.env.LOAD_TEST_URL || "http://localhost:5000/api/health";
const total = Math.max(1, Number(process.env.LOAD_TEST_REQUESTS || 100));
const concurrency = Math.max(1, Number(process.env.LOAD_TEST_CONCURRENCY || 10));

let nextRequest = 0;
let completed = 0;
let failed = 0;
const latencies = [];

async function runOne() {
  const startedAt = performance.now();
  try {
    const response = await fetch(url);
    if (!response.ok) failed += 1;
    await response.arrayBuffer();
  } catch {
    failed += 1;
  } finally {
    latencies.push(performance.now() - startedAt);
    completed += 1;
  }
}

async function worker() {
  while (nextRequest < total) {
    nextRequest += 1;
    await runOne();
  }
}

async function main() {
  const startedAt = performance.now();
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  const durationMs = performance.now() - startedAt;
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (value) =>
    sorted[Math.min(sorted.length - 1, Math.floor((value / 100) * sorted.length))] || 0;

  console.log(`URL: ${url}`);
  console.log(`Requests: ${completed}, failed: ${failed}, concurrency: ${concurrency}`);
  console.log(`Throughput: ${((completed / durationMs) * 1000).toFixed(2)} req/s`);
  console.log(`Latency p50: ${percentile(50).toFixed(1)} ms`);
  console.log(`Latency p95: ${percentile(95).toFixed(1)} ms`);
  console.log(`Latency max: ${(sorted[sorted.length - 1] || 0).toFixed(1)} ms`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
