"use strict";

const { routeWebhookEvent } = require("./asisWebhookEventRouter");

function parseInboundMessage(event, dependencies = {}) {
  const route = dependencies.route || routeWebhookEvent(event);
  if (!route || route.kind !== "inbound_message") {
    return { ok: false, reason: "not_inbound", route };
  }

  const data = event && event.data || {};
  const from = data.from || data.fromPhoneNumber || data.fromBSUID;
  if (!from) return { ok: false, reason: "missing_sender", route };

  const normalizePhone = dependencies.normalizePhone || ((value) => String(value || ""));
  const isOwnerSender = dependencies.isOwnerSender || (() => false);
  const normalizedFrom = normalizePhone(from);

  return {
    ok: true,
    route,
    data,
    from,
    normalizedFrom,
    ownerDetected: isOwnerSender(normalizedFrom),
    inboundText: data.content || data.message || data.text || "[non-text message received]",
    messageType: data.messageType || data.type || "unknown"
  };
}

module.exports = { parseInboundMessage };
