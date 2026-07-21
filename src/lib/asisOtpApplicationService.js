"use strict";

const crypto = require("node:crypto");
const {
  normalizeE164,
  maskPhone,
  hashIdentifier,
  generateOtp,
  generateSalt,
  hashOtp,
  verifyOtp,
  generateSessionToken,
  safeEqualHex
} = require("./asisOtpSecurity");
const { DOCUMENT_TYPE } = require("./integration/cosmosOtpChallengeStore");

const DEFAULT_POLICY = Object.freeze({
  consentVersion: "otp-whatsapp-v1",
  codeTtlSeconds: 300,
  sessionTtlSeconds: 1800,
  retentionTtlSeconds: 86400,
  maximumAttempts: 5,
  rateWindowSeconds: 900,
  perPhoneChallenges: 3,
  perIpChallenges: 10,
  minimumResendSeconds: 60
});

function iso(date) {
  return new Date(date).toISOString();
}

function addSeconds(date, seconds) {
  return new Date(new Date(date).getTime() + (seconds * 1000));
}

function isConsentValid(consent, now, requiredVersion) {
  if (!consent || consent.accepted !== true || consent.version !== requiredVersion) return false;
  const acceptedAt = Date.parse(consent.accepted_at);
  if (!Number.isFinite(acceptedAt)) return false;
  const delta = now.getTime() - acceptedAt;
  return delta >= -120000 && delta <= 600000;
}

function publicFailure(status, code, retryAfterSeconds) {
  return {
    ok: false,
    status,
    code,
    ...(retryAfterSeconds ? { retryAfterSeconds } : {})
  };
}

function createOtpApplicationService(options = {}) {
  const store = options.store;
  const messaging = options.messaging;
  const pepper = options.hashPepper;
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  const clock = options.clock || (() => new Date());
  const otpGenerator = options.otpGenerator || generateOtp;
  const saltGenerator = options.saltGenerator || generateSalt;
  const sessionTokenGenerator = options.sessionTokenGenerator || generateSessionToken;
  const idGenerator = options.idGenerator || crypto.randomUUID;

  if (!store || !messaging) throw new Error("OTP service requires storage and messaging adapters.");
  hashIdentifier("configuration-check", pepper);

  async function requestChallenge(input = {}) {
    const now = new Date(clock());
    const phone = normalizeE164(input.phone);
    const clientSessionId = String(input.clientSessionId || "");
    const sourceIp = String(input.sourceIp || "unknown");

    if (!phone || !/^[A-Za-z0-9_-]{20,128}$/.test(clientSessionId)) {
      return publicFailure(400, "invalid_request");
    }
    if (!isConsentValid(input.consent, now, policy.consentVersion)) {
      return publicFailure(400, "consent_required");
    }

    const phoneHash = hashIdentifier(phone, pepper);
    const ipHash = hashIdentifier(sourceIp, pepper);
    const clientSessionHash = hashIdentifier(clientSessionId, pepper);
    if (typeof store.consumeRateLimit === "function") {
      const rateDecision = await store.consumeRateLimit({
        phoneHash,
        ipHash,
        now: iso(now),
        policy
      });
      if (!rateDecision.allowed) {
        return publicFailure(429, rateDecision.code, rateDecision.retryAfterSeconds);
      }
    } else {
      const windowStart = iso(addSeconds(now, -policy.rateWindowSeconds));
      const resendStart = iso(addSeconds(now, -policy.minimumResendSeconds));
      const counts = await store.getRateCounts({ phoneHash, ipHash, windowStart, resendStart });
      if (counts.recentPhoneCount > 0) {
        return publicFailure(429, "resend_too_soon", policy.minimumResendSeconds);
      }
      if (counts.phoneCount >= policy.perPhoneChallenges || counts.ipCount >= policy.perIpChallenges) {
        return publicFailure(429, "rate_limited", policy.rateWindowSeconds);
      }
    }

    const code = otpGenerator();
    const salt = saltGenerator();
    const challengeId = idGenerator();
    const createdAt = iso(now);
    const expiresAt = iso(addSeconds(now, policy.codeTtlSeconds));
    const codeHash = await hashOtp(code, salt, pepper);

    let challenge = await store.createChallenge({
      id: challengeId,
      partition_key: challengeId,
      document_type: DOCUMENT_TYPE,
      status: "pending_delivery",
      created_at: createdAt,
      expires_at: expiresAt,
      phone_hash: phoneHash,
      ip_hash: ipHash,
      client_session_hash: clientSessionHash,
      masked_destination: maskPhone(phone),
      code_hash: codeHash,
      code_salt: salt,
      verification_attempts: 0,
      consent_version: policy.consentVersion,
      consent_accepted_at: iso(new Date(input.consent.accepted_at)),
      ttl: policy.retentionTtlSeconds
    });

    try {
      const delivery = await messaging.sendOtp({
        to: phone,
        code
      });
      if (!delivery || delivery.ok !== true) throw new Error("OTP_DELIVERY_REJECTED");
      challenge = await store.replaceChallenge({
        ...challenge,
        status: "delivered",
        delivered_at: iso(now),
        delivery_status: delivery.status
      });
    } catch {
      await store.replaceChallenge({
        ...challenge,
        status: "delivery_failed",
        delivery_failed_at: iso(now)
      });
      return publicFailure(503, "delivery_unavailable");
    }

    return {
      ok: true,
      status: 202,
      challengeId,
      maskedDestination: challenge.masked_destination,
      expiresInSeconds: policy.codeTtlSeconds,
      resendAfterSeconds: policy.minimumResendSeconds
    };
  }

  async function verifyChallenge(input = {}) {
    const now = new Date(clock());
    const challengeId = String(input.challengeId || "");
    const clientSessionId = String(input.clientSessionId || "");
    const code = String(input.code || "");
    if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^[A-Za-z0-9_-]{20,128}$/.test(clientSessionId) || !/^\d{6}$/.test(code)) {
      return publicFailure(400, "invalid_request");
    }

    const challenge = await store.getChallenge(challengeId);
    if (!challenge || challenge.status !== "delivered") {
      return publicFailure(401, "verification_failed");
    }
    if (Date.parse(challenge.expires_at) <= now.getTime()) {
      await store.replaceChallenge({ ...challenge, status: "expired", expired_at: iso(now) });
      return publicFailure(401, "verification_failed");
    }

    const clientHash = hashIdentifier(clientSessionId, pepper);
    if (!safeEqualHex(challenge.client_session_hash, clientHash)) {
      return publicFailure(401, "verification_failed");
    }

    const matches = await verifyOtp(code, challenge.code_salt, challenge.code_hash, pepper);
    if (!matches) {
      const attempts = Number(challenge.verification_attempts || 0) + 1;
      const locked = attempts >= policy.maximumAttempts;
      await store.replaceChallenge({
        ...challenge,
        verification_attempts: attempts,
        status: locked ? "locked" : "delivered",
        ...(locked ? { locked_at: iso(now) } : {})
      });
      return publicFailure(locked ? 429 : 401, locked ? "attempts_exhausted" : "verification_failed");
    }

    const sessionToken = sessionTokenGenerator();
    const sessionExpiresAt = iso(addSeconds(now, policy.sessionTtlSeconds));
    await store.replaceChallenge({
      ...challenge,
      status: "verified",
      verified_at: iso(now),
      session_expires_at: sessionExpiresAt,
      session_token_hash: hashIdentifier(sessionToken, pepper),
      code_hash: null,
      code_salt: null
    });

    return {
      ok: true,
      status: 200,
      verified: true,
      sessionToken,
      sessionExpiresAt
    };
  }

  async function validateSession(input = {}) {
    const now = new Date(clock());
    const challengeId = String(input.challengeId || "");
    const clientSessionId = String(input.clientSessionId || "");
    const sessionToken = String(input.sessionToken || "");
    if (
      !/^[0-9a-f-]{36}$/i.test(challengeId) ||
      !/^[A-Za-z0-9_-]{20,128}$/.test(clientSessionId) ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(sessionToken)
    ) {
      return publicFailure(400, "invalid_request");
    }

    const challenge = await store.getChallenge(challengeId);
    if (!challenge || challenge.status !== "verified") {
      return publicFailure(401, "session_invalid");
    }
    if (Date.parse(challenge.session_expires_at) <= now.getTime()) {
      return publicFailure(401, "session_invalid");
    }
    const clientHash = hashIdentifier(clientSessionId, pepper);
    const tokenHash = hashIdentifier(sessionToken, pepper);
    if (!safeEqualHex(challenge.client_session_hash, clientHash) || !safeEqualHex(challenge.session_token_hash, tokenHash)) {
      return publicFailure(401, "session_invalid");
    }
    return {
      ok: true,
      status: 200,
      valid: true,
      sessionExpiresAt: challenge.session_expires_at
    };
  }

  return { requestChallenge, verifyChallenge, validateSession, policy };
}

module.exports = {
  DEFAULT_POLICY,
  isConsentValid,
  createOtpApplicationService
};
