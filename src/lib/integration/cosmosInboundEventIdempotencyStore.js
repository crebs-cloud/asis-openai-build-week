"use strict";

const crypto = require("node:crypto");

const SCHEMA_VERSION = "asis-inbound-event-processing-v1";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

function requiredText(value, fieldName) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${fieldName}_required`);
  return text;
}

function optionalText(value, maxLength = 512) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeTtlSeconds(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_TTL_SECONDS;
  return Math.min(parsed, MAX_TTL_SECONDS);
}

function buildRecordId(eventKey) {
  return `inbound_${crypto.createHash("sha256").update(eventKey, "utf8").digest("hex")}`;
}

function isConflict(error) {
  return Number(error && (error.code || error.statusCode)) === 409;
}

function createCosmosInboundEventIdempotencyStore({ container, now = () => new Date() } = {}) {
  if (!container || !container.items || typeof container.items.create !== "function") {
    throw new Error("inbound_event_cosmos_container_required");
  }

  return Object.freeze({
    async claim(input = {}) {
      const eventKey = requiredText(input.eventKey, "event_key");
      const processedAt = now().toISOString();
      const record = {
        id: buildRecordId(eventKey),
        schemaVersion: SCHEMA_VERSION,
        recordType: "inbound_event_processing",
        eventKeyHash: crypto.createHash("sha256").update(eventKey, "utf8").digest("hex"),
        eventId: optionalText(input.eventId),
        acsMessageId: optionalText(input.acsMessageId),
        sender: optionalText(input.sender, 128),
        eventType: optionalText(input.eventType, 256),
        receivedAt: optionalText(input.receivedAt, 128) || processedAt,
        processedAt,
        result: "processing_claimed",
        ttl: normalizeTtlSeconds(input.ttlSeconds)
      };

      try {
        const { resource } = await container.items.create(record);
        return {
          claimed: true,
          duplicate: false,
          recordId: record.id,
          record: resource || record
        };
      } catch (error) {
        if (isConflict(error)) {
          return {
            claimed: false,
            duplicate: true,
            recordId: record.id
          };
        }
        throw error;
      }
    }
  });
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  SCHEMA_VERSION,
  buildRecordId,
  createCosmosInboundEventIdempotencyStore,
  normalizeTtlSeconds
};
