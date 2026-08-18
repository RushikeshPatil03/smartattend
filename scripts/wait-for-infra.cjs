const net = require("net");

const checks = [
  { name: "MongoDB", host: "127.0.0.1", port: 27017 },
  { name: "Redis", host: "127.0.0.1", port: 6379 },
];

const timeoutMs = Number(process.env.INFRA_WAIT_TIMEOUT_MS || 30000);
const intervalMs = Number(process.env.INFRA_WAIT_INTERVAL_MS || 500);
const startedAt = Date.now();

function canConnect({ host, port }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitFor(check) {
  while (Date.now() - startedAt < timeoutMs) {
    if (await canConnect(check)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${check.name} did not become reachable on ${check.host}:${check.port}`);
}

(async () => {
  await Promise.all(checks.map(waitFor));
  console.log("Infrastructure ready: MongoDB and Redis are reachable.");
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
