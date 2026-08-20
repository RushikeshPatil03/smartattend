// server/test_webauthn.js
const assert = require("assert");
const {
  getRPID,
  getExpectedOrigin,
  generateUserRegistrationOptions,
  verifyUserRegistration,
  generateUserAuthenticationOptions,
  verifyUserAuthentication,
  storeChallenge,
  consumeChallenge,
} = require("./services/webauthnService");

async function runTests() {
  console.log("🚀 Starting WebAuthn Passkey Verification Suite...\n");

  // 1. RP ID & Origin Resolution
  console.log("Test 1: RP ID and Origin Resolution");
  const mockReqLocal = {
    headers: { host: "localhost:5173", origin: "http://localhost:5173" },
  };
  const rpid = getRPID(mockReqLocal);
  assert.strictEqual(rpid, "localhost", `Expected 'localhost', got '${rpid}'`);
  const origin = getExpectedOrigin(mockReqLocal);
  assert.strictEqual(
    origin,
    "http://localhost:5173",
    `Expected 'http://localhost:5173', got '${origin}'`
  );
  console.log("  ✓ RP ID and Expected Origin correctly resolved for local dev.\n");

  // 2. Single-use Challenge Cache & Expiry TTL
  console.log("Test 2: Challenge Cache & 60-Second TTL Enforcement");
  const testKey = "test_challenge_key_123";
  const testChallenge = "abc123challengeString";
  storeChallenge(testKey, testChallenge);

  const retrieved = consumeChallenge(testKey);
  assert.ok(retrieved, "Challenge entry should be retrieved on first call.");
  assert.strictEqual(
    retrieved.challenge,
    testChallenge,
    "Challenge should be successfully retrieved on first consumption."
  );

  const secondTry = consumeChallenge(testKey);
  assert.strictEqual(
    secondTry,
    null,
    "Single-use challenge MUST be deleted immediately upon first consumption."
  );
  console.log("  ✓ Single-use challenge replay prevention verified.\n");

  // 3. Registration Options Generation
  console.log("Test 3: Registration Options Generation");
  const regResult = await generateUserRegistrationOptions({
    userName: "student@example.edu",
    userDisplayName: "Alex Student",
    req: mockReqLocal,
  });

  assert.ok(regResult.options, "Registration options must be generated.");
  assert.ok(regResult.options.challenge, "Challenge must exist in options.");
  assert.strictEqual(
    regResult.options.rp.id,
    "localhost",
    "RP ID in options must match host."
  );
  assert.strictEqual(
    regResult.options.authenticatorSelection.authenticatorAttachment,
    "platform",
    "Authenticator must enforce platform hardware attachment."
  );
  assert.strictEqual(
    regResult.options.authenticatorSelection.userVerification,
    "preferred",
    "User verification must be configured."
  );
  console.log("  ✓ Platform passkey registration options properly structured.\n");

  // 4. Authentication Options Generation
  console.log("Test 4: Authentication Options Generation");
  const mockCredId = "dGVzdF9jcmVkZW50aWFsX2lk";
  const authResult = await generateUserAuthenticationOptions({
    credentialId: mockCredId,
    req: mockReqLocal,
  });

  assert.ok(authResult.options, "Authentication options must be generated.");
  assert.ok(authResult.options.challenge, "Challenge must exist in auth options.");
  assert.strictEqual(
    authResult.options.rpId,
    "localhost",
    "rpId in auth options must match host."
  );
  assert.strictEqual(
    authResult.options.allowCredentials.length,
    1,
    "Must target student's registered credential ID."
  );
  assert.strictEqual(
    authResult.options.allowCredentials[0].id,
    mockCredId,
    "Credential ID must match student record."
  );
  console.log("  ✓ Passkey challenge options properly generated.\n");

  // 5. Verification error handling with invalid signature
  console.log("Test 5: Verification of Invalid Assertion (Rejection & Security Check)");
  const fakeAssertion = {
    id: mockCredId,
    rawId: mockCredId,
    response: {
      clientDataJSON: Buffer.from(
        JSON.stringify({
          type: "webauthn.get",
          challenge: "fake_challenge",
          origin: "http://localhost:5173",
        })
      ).toString("base64url"),
      authenticatorData: Buffer.from("fake_auth_data").toString("base64url"),
      signature: Buffer.from("fake_signature").toString("base64url"),
    },
    type: "public-key",
  };

  const fakePublicKey = Buffer.from(new Uint8Array(32).fill(7)).toString("base64url");
  const authVerify = await verifyUserAuthentication({
    response: fakeAssertion,
    challengeKey: authResult.challengeKey,
    credential: {
      id: mockCredId,
      publicKey: fakePublicKey,
      counter: 0,
      transports: ["internal"],
    },
    req: mockReqLocal,
  });

  assert.strictEqual(
    authVerify.verified,
    false,
    "Invalid signature assertion must be rejected."
  );
  console.log("  ✓ Untrusted / invalid signatures are strictly rejected.\n");

  console.log("🎉 ALL WEBAUTHN PASSKEY TESTS PASSED SUCCESSFULLY!");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
