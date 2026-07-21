"use strict";

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function safeText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function extractAcsMessageId(data = {}) {
  return safeText(
    data.messageId ||
    data.messageID ||
    data.message_id ||
    data.id ||
    data.acsMessageId
  );
}

function buildInboundEventKey({ event = {}, data = {}, sender, inboundText } = {}) {
  const eventId = safeText(event.id);
  const acsMessageId = extractAcsMessageId(data);

  if (eventId) return `event:${eventId}`;
  if (acsMessageId) return `message:${acsMessageId}`;

  const senderKey = safeText(sender) || "unknown_sender";
  const timeKey = safeText(event.eventTime || data.receivedTimestamp) || "unknown_time";
  const textKey = safeText(inboundText).toLowerCase().slice(0, 180);
  return `fallback:${senderKey}:${timeKey}:${textKey}`;
}

function createInboundEventIdempotencyService({
  store,
  ttlSeconds = DEFAULT_TTL_SECONDS
} = {}) {
  if (!store || typeof store.claim !== "function") {
    throw new Error("inbound_event_idempotency_store_required");
  }

  return Object.freeze({
    async claim({ event = {}, data = {}, sender, inboundText } = {}) {
      const eventKey = buildInboundEventKey({ event, data, sender, inboundText });
      const decision = await store.claim({
        eventKey,
        eventId: safeText(event.id) || null,
        acsMessageId: extractAcsMessageId(data) || null,
        sender: safeText(sender) || null,
        eventType: safeText(event.eventType) || null,
        receivedAt: safeText(data.receivedTimestamp || event.eventTime) || null,
        ttlSeconds
      });

      return {
        ...decision,
        eventKey
      };
    }
  });
}

async function gateInboundEvent({ service, serviceFactory, event, data, sender, inboundText } = {}) {
  try {
    const resolvedService = service || (
      typeof serviceFactory === "function" ? serviceFactory() : null
    );
    if (!resolvedService || typeof resolvedService.claim !== "function") {
      throw new Error("inbound_event_idempotency_service_required");
    }

    const decision = await resolvedService.claim({ event, data, sender, inboundText });
    if (decision.duplicate) {
      return {
        ok: false,
        duplicate: true,
        eventKey: decision.eventKey,
        recordId: decision.recordId,
        response: { status: 200, jsonBody: { ok: true, duplicate: true } }
      };
    }

    return {
      ok: true,
      duplicate: false,
      eventKey: decision.eventKey,
      recordId: decision.recordId
    };
  } catch {
    return {
      ok: false,
      duplicate: false,
      response: {
        status: 503,
        headers: { "Retry-After": "30" },
        jsonBody: { ok: false, error: "Inbound idempotency unavailable" }
      }
    };
  }
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  buildInboundEventKey,
  createInboundEventIdempotencyService,
  extractAcsMessageId,
  gateInboundEvent
};
