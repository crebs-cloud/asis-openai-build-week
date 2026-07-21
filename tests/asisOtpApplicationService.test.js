"use strict";

const assert = require("node:assert/strict");
const { createOtpApplicationService } = require("../src/lib/asisOtpApplicationService");

function createMemoryStore() {
  const documents = new Map();
  let etag = 0;
  return {
    documents,
    async createChallenge(document) {
      const stored = { ...document, _etag: String(++etag) };
      documents.set(stored.id, stored);
      return { ...stored };
    },
    async getChallenge(id) {
      const value = documents.get(id);
      return value ? { ...value } : null;
    },
    async replaceChallenge(document) {
      const stored = { ...document, _etag: String(++etag) };
      documents.set(stored.id, stored);
      return { ...stored };
    },
    async getRateCounts({ phoneHash, ipHash, windowStart, resendStart }) {
      const values = [...documents.values()];
      return {
        phoneCount: values.filter((item) => item.phone_hash === phoneHash && item.created_at >= windowStart).length,
        ipCount: values.filter((item) => item.ip_hash === ipHash && item.created_at >= windowStart).length,
        recentPhoneCount: values.filter((item) => item.phone_hash === phoneHash && item.created_at >= resendStart).length
      };
    }
  };
}

async function run() {
  let invalidSessionStoreReads = 0;
  const availabilityService = createOtpApplicationService({
    store: {
      async getChallenge() {
        invalidSessionStoreReads += 1;
        throw new Error("invalid session input must not reach Cosmos");
      }
    },
    messaging: {},
    hashPepper: "a".repeat(32)
  });
  const availability = await availabilityService.validateSession({
    challengeId: "",
    clientSessionId: "",
    sessionToken: ""
  });
  assert.deepEqual(availability, {
    ok: false,
    status: 400,
    code: "invalid_request"
  });
  assert.equal(invalidSessionStoreReads, 0);

  const store = createMemoryStore();
  const deliveries = [];
  let now = new Date("2026-07-12T12:00:00Z");
  const service = createOtpApplicationService({
    store,
    messaging: {
      async sendOtp(message) {
        deliveries.push(message);
        return { ok: true, status: "202" };
      }
    },
    hashPepper: "p".repeat(32),
    clock: () => now,
    otpGenerator: () => "123456",
    saltGenerator: () => "00112233445566778899aabbccddeeff",
    sessionTokenGenerator: () => "session-token-value-never-returned-to-browser",
    idGenerator: () => "11111111-1111-4111-8111-111111111111"
  });

  const invalidConsent = await service.requestChallenge({
    phone: "+50688888888",
    clientSessionId: "client_session_1234567890",
    sourceIp: "192.0.2.10",
    consent: { accepted: false, version: "otp-whatsapp-v1", accepted_at: now.toISOString() }
  });
  assert.equal(invalidConsent.code, "consent_required");

  const created = await service.requestChallenge({
    phone: "+50688888888",
    clientSessionId: "client_session_1234567890",
    sourceIp: "192.0.2.10",
    consent: { accepted: true, version: "otp-whatsapp-v1", accepted_at: now.toISOString() }
  });
  assert.equal(created.status, 202);
  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0], { to: "+50688888888", code: "123456" });
  assert.equal(Object.hasOwn(deliveries[0], "content"), false);

  let stored = store.documents.get(created.challengeId);
  assert.equal(stored.status, "delivered");
  assert.notEqual(stored.code_hash, "123456");
  assert.equal(JSON.stringify(stored).includes("+50688888888"), false);
  assert.equal(JSON.stringify(stored).includes("192.0.2.10"), false);
  assert.equal(stored.ttl, 86400);

  const failedStore = createMemoryStore();
  const failedDeliveryService = createOtpApplicationService({
    store: failedStore,
    messaging: {
      async sendOtp() {
        return { ok: false, status: "400" };
      }
    },
    hashPepper: "q".repeat(32),
    clock: () => now,
    otpGenerator: () => "654321",
    saltGenerator: () => "ffeeddccbbaa99887766554433221100",
    idGenerator: () => "22222222-2222-4222-8222-222222222222"
  });
  const failedDelivery = await failedDeliveryService.requestChallenge({
    phone: "+50687777777",
    clientSessionId: "failed_session_1234567890",
    sourceIp: "192.0.2.11",
    consent: { accepted: true, version: "otp-whatsapp-v1", accepted_at: now.toISOString() }
  });
  assert.equal(failedDelivery.status, 503);
  assert.equal(failedDelivery.code, "delivery_unavailable");
  const failedDocument = failedStore.documents.get("22222222-2222-4222-8222-222222222222");
  assert.equal(failedDocument.status, "delivery_failed");
  assert.equal(JSON.stringify(failedDocument).includes("654321"), false);
  assert.equal(JSON.stringify(failedDocument).includes("+50687777777"), false);

  const tooSoon = await service.requestChallenge({
    phone: "+50688888888",
    clientSessionId: "client_session_1234567890",
    sourceIp: "192.0.2.10",
    consent: { accepted: true, version: "otp-whatsapp-v1", accepted_at: now.toISOString() }
  });
  assert.equal(tooSoon.code, "resend_too_soon");
  assert.equal(tooSoon.status, 429);

  const wrong = await service.verifyChallenge({
    challengeId: created.challengeId,
    clientSessionId: "client_session_1234567890",
    code: "000000"
  });
  assert.equal(wrong.code, "verification_failed");

  const verified = await service.verifyChallenge({
    challengeId: created.challengeId,
    clientSessionId: "client_session_1234567890",
    code: "123456"
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.sessionToken, "session-token-value-never-returned-to-browser");
  stored = store.documents.get(created.challengeId);
  assert.equal(stored.status, "verified");
  assert.equal(stored.code_hash, null);
  assert.notEqual(stored.session_token_hash, verified.sessionToken);

  const session = await service.validateSession({
    challengeId: created.challengeId,
    clientSessionId: "client_session_1234567890",
    sessionToken: verified.sessionToken
  });
  assert.equal(session.valid, true);

  now = new Date("2026-07-12T12:31:00Z");
  const expiredSession = await service.validateSession({
    challengeId: created.challengeId,
    clientSessionId: "client_session_1234567890",
    sessionToken: verified.sessionToken
  });
  assert.equal(expiredSession.code, "session_invalid");

  console.log("Asis OTP application service tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
