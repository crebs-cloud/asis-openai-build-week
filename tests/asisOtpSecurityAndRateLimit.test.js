"use strict";

const assert = require("node:assert/strict");
const { hashOtp, verifyOtp } = require("../src/lib/asisOtpSecurity");
const { createCosmosOtpChallengeStore } = require("../src/lib/integration/cosmosOtpChallengeStore");

function createFakeContainer() {
  const documents = new Map();
  let etag = 0;
  const copy = (value) => value ? { ...value } : value;
  return {
    documents,
    items: {
      async create(document) {
        if (documents.has(document.id)) {
          const error = new Error("conflict");
          error.code = 409;
          throw error;
        }
        const stored = { ...document, _etag: String(++etag) };
        documents.set(stored.id, stored);
        return { resource: copy(stored) };
      },
      query() {
        throw new Error("query fallback is not expected when atomic counters are available");
      }
    },
    item(id) {
      return {
        async read() {
          const stored = documents.get(id);
          if (!stored) {
            const error = new Error("not found");
            error.code = 404;
            throw error;
          }
          return { resource: copy(stored) };
        },
        async replace(document, options) {
          const stored = documents.get(id);
          if (!stored || options.accessCondition.condition !== stored._etag) {
            const error = new Error("precondition failed");
            error.code = 412;
            throw error;
          }
          const updated = { ...document, _etag: String(++etag) };
          documents.set(id, updated);
          return { resource: copy(updated) };
        }
      };
    }
  };
}

async function run() {
  const salt = "00112233445566778899aabbccddeeff";
  const pepperA = "a".repeat(32);
  const pepperB = "b".repeat(32);
  const hashA = await hashOtp("123456", salt, pepperA);
  const hashB = await hashOtp("123456", salt, pepperB);
  assert.notEqual(hashA, "123456");
  assert.notEqual(hashA, hashB);
  assert.equal(await verifyOtp("123456", salt, hashA, pepperA), true);
  assert.equal(await verifyOtp("123456", salt, hashA, pepperB), false);

  const container = createFakeContainer();
  const store = createCosmosOtpChallengeStore({ container });
  const policy = {
    perPhoneChallenges: 3,
    perIpChallenges: 10,
    rateWindowSeconds: 900,
    minimumResendSeconds: 60
  };

  const first = await store.consumeRateLimit({
    phoneHash: "phone-hash",
    ipHash: "ip-hash",
    now: "2026-07-12T12:00:00.000Z",
    policy
  });
  assert.equal(first.allowed, true);

  const tooSoon = await store.consumeRateLimit({
    phoneHash: "phone-hash",
    ipHash: "ip-hash",
    now: "2026-07-12T12:00:30.000Z",
    policy
  });
  assert.equal(tooSoon.allowed, false);
  assert.equal(tooSoon.code, "resend_too_soon");
  assert.equal(tooSoon.retryAfterSeconds, 30);

  await store.consumeRateLimit({
    phoneHash: "phone-hash",
    ipHash: "ip-hash",
    now: "2026-07-12T12:01:00.000Z",
    policy
  });
  await store.consumeRateLimit({
    phoneHash: "phone-hash",
    ipHash: "ip-hash",
    now: "2026-07-12T12:02:00.000Z",
    policy
  });
  const limited = await store.consumeRateLimit({
    phoneHash: "phone-hash",
    ipHash: "ip-hash",
    now: "2026-07-12T12:03:00.000Z",
    policy
  });
  assert.equal(limited.allowed, false);
  assert.equal(limited.code, "rate_limited");
  assert.equal(limited.retryAfterSeconds, 720);

  const phoneCounter = container.documents.get("asis-otp-rate-phone-phone-hash");
  assert.equal(phoneCounter.count, 3);
  assert.equal(phoneCounter.ttl, 960);
  assert.equal(JSON.stringify(phoneCounter).includes("+506"), false);

  console.log("Asis OTP pepper and atomic rate-limit tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
