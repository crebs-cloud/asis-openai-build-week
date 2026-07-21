"use strict";

const assert = require("node:assert/strict");
const { createOtpHttpHandlers, SESSION_COOKIE_NAME } = require("../src/lib/asisOtpHttpApi");

function request(method, origin, body, cookie = "") {
  const values = new Map([
    ["origin", origin],
    ["x-forwarded-for", "192.0.2.20"],
    ["x-azure-clientip", "198.51.100.40"],
    ["cookie", cookie]
  ]);
  return {
    method,
    headers: { get: (name) => values.get(String(name).toLowerCase()) || "" },
    async json() { return body; }
  };
}

async function run() {
  const calls = [];
  const service = {
    policy: { sessionTtlSeconds: 1800 },
    async requestChallenge(input) {
      calls.push(["create", input]);
      return {
        ok: true,
        status: 202,
        challengeId: "11111111-1111-4111-8111-111111111111",
        maskedDestination: "+506••••8888",
        expiresInSeconds: 300,
        resendAfterSeconds: 60
      };
    },
    async verifyChallenge(input) {
      calls.push(["verify", input]);
      return {
        ok: true,
        status: 200,
        verified: true,
        sessionToken: "secret-cookie-token",
        sessionExpiresAt: "2026-07-12T12:30:00.000Z"
      };
    },
    async validateSession(input) {
      calls.push(["validate", input]);
      return {
        ok: true,
        status: 200,
        valid: true,
        sessionExpiresAt: "2026-07-12T12:30:00.000Z"
      };
    }
  };
  const handlers = createOtpHttpHandlers({
    allowedOrigins: ["https://costaricaebs.com"],
    serviceFactory: () => service
  });

  const rejected = await handlers.createChallenge(request("POST", "https://evil.invalid", {}));
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers["Access-Control-Allow-Origin"], "null");

  const preflight = await handlers.createChallenge(request("OPTIONS", "https://costaricaebs.com", null));
  assert.equal(preflight.status, 204);

  const created = await handlers.createChallenge(request("POST", "https://costaricaebs.com", {
    phone: "+50688888888",
    client_session_id: "client_session_1234567890",
    consent: { accepted: true, version: "otp-whatsapp-v1", accepted_at: "2026-07-12T12:00:00Z" }
  }));
  assert.equal(created.status, 202);
  assert.equal(created.jsonBody.challenge_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[0][1].sourceIp, "198.51.100.40");

  const verified = await handlers.verifyChallenge(request("POST", "https://costaricaebs.com", {
    challenge_id: created.jsonBody.challenge_id,
    client_session_id: "client_session_1234567890",
    code: "123456"
  }));
  assert.equal(verified.status, 200);
  assert.equal(JSON.stringify(verified.jsonBody).includes("secret-cookie-token"), false);
  assert.match(verified.headers["Set-Cookie"], new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(verified.headers["Set-Cookie"], /HttpOnly; Secure; SameSite=Strict/);

  const validated = await handlers.validateSession(request(
    "POST",
    "https://costaricaebs.com",
    {
      challenge_id: created.jsonBody.challenge_id,
      client_session_id: "client_session_1234567890"
    },
    `${SESSION_COOKIE_NAME}=secret-cookie-token`
  ));
  assert.equal(validated.jsonBody.valid, true);
  assert.equal(calls.at(-1)[1].sessionToken, "secret-cookie-token");

  const logCalls = [];
  const failureHandlers = createOtpHttpHandlers({
    allowedOrigins: ["https://costaricaebs.com"],
    serviceFactory: () => { throw new Error("sensitive-payload-123456"); }
  });
  const failed = await failureHandlers.createChallenge(
    request("POST", "https://costaricaebs.com", {}),
    { error: (...args) => logCalls.push(args) }
  );
  assert.equal(failed.status, 500);
  assert.equal(JSON.stringify(logCalls).includes("sensitive-payload-123456"), false);

  console.log("Asis OTP HTTP API tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
