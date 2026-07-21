"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  prepareWebhookExecution
} = require("../src/lib/asisWebhookApplicationService");
const {
  createOtpApplicationService
} = require("../src/lib/asisOtpApplicationService");

function memoryStore() {
  const documents = new Map();
  return {
    documents,
    async createChallenge(document) {
      documents.set(document.id, { ...document });
      return { ...document };
    },
    async getChallenge(id) {
      const document = documents.get(id);
      return document ? { ...document } : null;
    },
    async replaceChallenge(document) {
      documents.set(document.id, { ...document });
      return { ...document };
    },
    async getRateCounts() {
      return { phoneCount: 0, ipCount: 0, recentPhoneCount: 0 };
    }
  };
}

async function run() {
  const event = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "samples", "judge", "inbound-message.json"),
    "utf8"
  ));
  const webhook = await prepareWebhookExecution({
    async json() { return event; }
  }, console, {
    normalizePhone: (value) => String(value).replace("whatsapp:", ""),
    isOwnerSender: () => false
  });

  const store = memoryStore();
  const now = new Date("2026-07-20T18:00:00.000Z");
  const clientSessionId = "judge_browser_session_1234567890";
  const service = createOtpApplicationService({
    store,
    messaging: { async sendOtp() { return { ok: true, status: "accepted" }; } },
    hashPepper: "public-demo-pepper-with-at-least-32-characters",
    clock: () => now,
    otpGenerator: () => "123456",
    saltGenerator: () => "00112233445566778899aabbccddeeff",
    sessionTokenGenerator: () => "public_demo_session_token_1234567890abcdef",
    idGenerator: () => "11111111-1111-4111-8111-111111111111"
  });
  const challenge = await service.requestChallenge({
    phone: "+50680000000",
    clientSessionId,
    sourceIp: "192.0.2.10",
    consent: {
      accepted: true,
      version: "otp-whatsapp-v1",
      accepted_at: now.toISOString()
    }
  });
  const verification = await service.verifyChallenge({
    challengeId: challenge.challengeId,
    clientSessionId,
    code: "123456"
  });
  const persisted = JSON.stringify([...store.documents.values()]);

  console.log(`Webhook action: ${webhook.actions[0].kind}`);
  console.log(`OTP challenge: ${challenge.ok ? "accepted" : "rejected"}`);
  console.log(`OTP verification: ${verification.verified ? "verified" : "failed"}`);
  console.log(`Plaintext OTP persisted: ${persisted.includes("123456") ? "yes" : "no"}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
