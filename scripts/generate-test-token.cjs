#!/usr/bin/env node
/**
 * Safe Test Token Generator for Local SmartAttend Testing
 * 
 * Generates an HMAC-SHA256 signed JWT for a mock student or faculty without
 * interacting with real student records or leaking production secrets.
 * 
 * Usage:
 *   node scripts/generate-test-token.cjs
 *   node scripts/generate-test-token.cjs --role=FACULTY
 *   node scripts/generate-test-token.cjs --id=custom-student-uuid
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// 1. Resolve local secret from server/.env if available
function getLocalSecret() {
  const envPath = path.resolve(__dirname, "../server/.env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    const match = content.match(/^JWT_SECRET\s*=\s*(.+)$/m);
    if (match && match[1]) {
      return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return process.env.JWT_SECRET || "smartattend-dev-jwt-insecure-secret-key-32chars";
}

// 2. Parse CLI flags
const args = process.argv.slice(2);
let role = "STUDENT";
let userId = "00000000-0000-0000-0000-000000000001";
let email = "test.student@smartattend.local";

for (const arg of args) {
  if (arg.startsWith("--role=")) role = arg.split("=")[1].toUpperCase();
  if (arg.startsWith("--id=")) userId = arg.split("=")[1];
  if (arg.startsWith("--email=")) email = arg.split("=")[1];
}

// 3. Simple standalone JWT signer (zero external dependencies)
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signatureInput)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signatureInput}.${signature}`;
}

const secret = getLocalSecret();
const now = Math.floor(Date.now() / 1000);
const payload = {
  id: userId,
  _id: userId,
  role,
  email,
  type: "access",
  iat: now,
  exp: now + 3600 * 24 * 7, // 7 days valid for testing
};

const token = signJwt(payload, secret);

console.log("==================================================================");
console.log(" SmartAttend Local Test Token Generator                          ");
console.log("==================================================================");
console.log(`Role:      ${role}`);
console.log(`User ID:   ${userId}`);
console.log(`Email:     ${email}`);
console.log(`Expires:   7 days from now`);
console.log("------------------------------------------------------------------");
console.log("Bearer Token:");
console.log(token);
console.log("------------------------------------------------------------------");
console.log("To use in load tests, run:");
console.log(`export TEST_STUDENT_TOKEN="${token}"`);
console.log(`or in Windows PowerShell:`);
console.log(`$env:TEST_STUDENT_TOKEN="${token}"`);
console.log("==================================================================");
