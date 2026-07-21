"use strict";

const crypto = require("node:crypto");

function firstValue(source, names) {
  for (const name of names) {
    if (source && source[name] !== undefined && source[name] !== null) return source[name];
  }
  return null;
}

function sanitizeLabel(value, maximumLength = 80) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function sanitizeStatusLabel(value, maximumLength = 80) {
  const normalized = sanitizeLabel(value, maximumLength);
  return normalized && /^[A-Za-z0-9_.:-]+$/.test(normalized) ? normalized : null;
}

function fingerprint(value) {
  const normalized = sanitizeLabel(value, 512);
  if (!normalized) return null;
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}

function normalizedTimestamp(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function buildSanitizedDeliveryStatusEvidence(event = {}) {
  const data = event.data || {};
  return {
    eventFingerprint: fingerprint(event.id),
    messageFingerprint: fingerprint(firstValue(data, ["messageId", "messageID", "message_id"])),
    eventType: sanitizeStatusLabel(event.eventType, 120),
    status: sanitizeStatusLabel(firstValue(data, ["status", "deliveryStatus", "messageStatus"])),
    subStatus: sanitizeStatusLabel(firstValue(data, ["subStatus", "errorCode", "channelStatus"])),
    channelType: sanitizeStatusLabel(data.channelType),
    receivedTimestamp: normalizedTimestamp(
      firstValue(data, ["receivedTimestamp", "timestamp"]) || event.eventTime
    ),
    errorReported: Boolean(firstValue(data, ["errorMessage", "statusMessage", "channelStatusMessage"]))
  };
}

function createAcsDeliveryStatusEventAdapter() {
  return {
    adapterType: "acs_delivery_status_event",
    async handle(event, context = console) {
      try {
        const evidence = buildSanitizedDeliveryStatusEvidence(event);
        if (context && typeof context.log === "function") {
          context.log("[PHASE8B7B2_DELIVERY_STATUS_EVENT] " + JSON.stringify(evidence));
        }
        return { status: 200, body: "Delivery status event logged" };
      } catch {
        if (context && typeof context.error === "function") {
          context.error("[PHASE8B7B2_DELIVERY_STATUS_EVENT_ERROR]");
        }
        return { status: 200, body: "Delivery status event received with logging error" };
      }
    }
  };
}

module.exports = {
  buildSanitizedDeliveryStatusEvidence,
  createAcsDeliveryStatusEventAdapter
};
