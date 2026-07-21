"use strict";

const DOCUMENT_TYPE = "asis_otp_challenge_v1";
const SYSTEM_FIELDS = new Set(["_rid", "_self", "_etag", "_attachments", "_ts"]);

function writableDocument(document) {
  return Object.fromEntries(
    Object.entries(document || {}).filter(([key]) => !SYSTEM_FIELDS.has(key))
  );
}

function createCosmosOtpChallengeStore(options = {}) {
  let container = options.container || null;

  function getContainer() {
    if (container) return container;

    if (!options.client) throw new Error("A Cosmos client or container is required for OTP storage.");
    const databaseName = options.databaseName || "whatsapp_orchestrator";
    const containerName = options.containerName || "otpChallenges";
    container = options.client.database(databaseName).container(containerName);
    return container;
  }

  async function queryCount(field, value, since) {
    if (!new Set(["phone_hash", "ip_hash"]).has(field)) {
      throw new Error("Unsupported OTP rate-limit field.");
    }

    const querySpec = {
      query: `SELECT VALUE COUNT(1) FROM c WHERE c.document_type = @documentType AND c.created_at >= @since AND c.${field} = @value`,
      parameters: [
        { name: "@documentType", value: DOCUMENT_TYPE },
        { name: "@since", value: since },
        { name: "@value", value }
      ]
    };
    const { resources } = await getContainer().items.query(querySpec).fetchAll();
    return Number(resources[0] || 0);
  }

  async function consumeCounter({ kind, hash, now, limit, windowSeconds, minimumIntervalSeconds = 0 }) {
    const id = `asis-otp-rate-${kind}-${hash}`;
    const nowMs = new Date(now).getTime();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let current = null;
      try {
        const { resource } = await getContainer().item(id, id).read();
        current = resource || null;
      } catch (error) {
        if (Number(error && error.code) !== 404) throw error;
      }

      const windowExpired = !current || Date.parse(current.window_expires_at) <= nowMs;
      const count = windowExpired ? 0 : Number(current.count || 0);
      const lastConsumedAt = windowExpired ? 0 : Date.parse(current.last_consumed_at || 0);
      const windowExpiresAt = windowExpired
        ? new Date(nowMs + (windowSeconds * 1000)).toISOString()
        : current.window_expires_at;
      const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(windowExpiresAt) - nowMs) / 1000));

      if (minimumIntervalSeconds && lastConsumedAt && nowMs - lastConsumedAt < minimumIntervalSeconds * 1000) {
        return {
          allowed: false,
          code: "resend_too_soon",
          retryAfterSeconds: Math.ceil(((minimumIntervalSeconds * 1000) - (nowMs - lastConsumedAt)) / 1000)
        };
      }
      if (count >= limit) {
        return { allowed: false, code: "rate_limited", retryAfterSeconds };
      }

      const next = {
        id,
        partition_key: id,
        document_type: "asis_otp_rate_limit_v1",
        kind,
        subject_hash: hash,
        count: count + 1,
        window_started_at: windowExpired ? new Date(nowMs).toISOString() : current.window_started_at,
        window_expires_at: windowExpiresAt,
        last_consumed_at: new Date(nowMs).toISOString(),
        ttl: windowSeconds + 60
      };

      try {
        if (!current) {
          await getContainer().items.create(next);
        } else {
          await getContainer().item(id, id).replace(next, {
            accessCondition: { type: "IfMatch", condition: current._etag }
          });
        }
        return { allowed: true };
      } catch (error) {
        if (![409, 412].includes(Number(error && error.code))) throw error;
      }
    }
    throw new Error("OTP_RATE_LIMIT_CONCURRENCY_RETRY_EXHAUSTED");
  }

  return {
    adapterType: "cosmos_otp_challenge_store",
    async createChallenge(document) {
      const { resource } = await getContainer().items.create(writableDocument(document));
      return resource;
    },
    async getChallenge(id) {
      try {
        const { resource } = await getContainer().item(id, id).read();
        return resource || null;
      } catch (error) {
        if (Number(error && error.code) === 404) return null;
        throw error;
      }
    },
    async replaceChallenge(document) {
      const options = document && document._etag
        ? { accessCondition: { type: "IfMatch", condition: document._etag } }
        : undefined;
      const { resource } = await getContainer()
        .item(document.id, document.id)
        .replace(writableDocument(document), options);
      return resource;
    },
    async getRateCounts({ phoneHash, ipHash, windowStart, resendStart }) {
      const [phoneCount, ipCount, recentPhoneCount] = await Promise.all([
        queryCount("phone_hash", phoneHash, windowStart),
        queryCount("ip_hash", ipHash, windowStart),
        queryCount("phone_hash", phoneHash, resendStart)
      ]);
      return { phoneCount, ipCount, recentPhoneCount };
    },
    async consumeRateLimit({ phoneHash, ipHash, now, policy }) {
      const phone = await consumeCounter({
        kind: "phone",
        hash: phoneHash,
        now,
        limit: policy.perPhoneChallenges,
        windowSeconds: policy.rateWindowSeconds,
        minimumIntervalSeconds: policy.minimumResendSeconds
      });
      if (!phone.allowed) return phone;
      return consumeCounter({
        kind: "ip",
        hash: ipHash,
        now,
        limit: policy.perIpChallenges,
        windowSeconds: policy.rateWindowSeconds
      });
    }
  };
}

module.exports = {
  DOCUMENT_TYPE,
  createCosmosOtpChallengeStore
};
