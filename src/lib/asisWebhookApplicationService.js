"use strict";

const { routeWebhookEvent } = require("./asisWebhookEventRouter");
const { ingestWebhookRequest } = require("./asisWebhookEventIngestion");
const { evaluateInboundPolicy } = require("./asisWebhookPolicyService");
const { gateInboundEvent } = require("./asisInboundEventIdempotencyService");
const { handleEventGridValidation } = require("./asisEventGridValidationHandler");
const { parseInboundMessage } = require("./asisInboundMessageParser");

const WEBHOOK_ACTIONS = Object.freeze({
  ignored: "ignored",
  invalidInbound: "invalid_inbound",
  duplicateInbound: "duplicate_inbound",
  idempotencyUnavailable: "idempotency_unavailable",
  policyResponse: "policy_response",
  inboundMessage: "inbound_message"
});

function safeContextCall(context, method, message) {
  if (context && typeof context[method] === "function") {
    context[method](message);
  }
}

async function prepareWebhookExecution(request, context = console, dependencies = {}) {
  const ingest = dependencies.ingestWebhookRequest || ingestWebhookRequest;
  const route = dependencies.routeWebhookEvent || routeWebhookEvent;
  const evaluatePolicy = dependencies.evaluateInboundPolicy || evaluateInboundPolicy;
  const ingestion = await ingest(request);

  if (!ingestion.ok) {
    safeContextCall(context, "error", "Invalid webhook request body.");
    return { response: ingestion.response, actions: [] };
  }

  const routedEvents = ingestion.events.map((event) => route(event));

  for (const eventRoute of routedEvents) {
    if (eventRoute.kind === "delivery_status") {
      const adapter = dependencies.deliveryStatusAdapter;
      if (!adapter || typeof adapter.handle !== "function") {
        safeContextCall(context, "error", "[ASIS_DELIVERY_STATUS_ADAPTER_MISSING]");
        return {
          response: { status: 200, body: "Delivery status event received with logging error" },
          actions: []
        };
      }
      try {
        return {
          response: await adapter.handle(eventRoute.event, context),
          actions: []
        };
      } catch {
        safeContextCall(context, "error", "[ASIS_DELIVERY_STATUS_ADAPTER_FAILED]");
        return {
          response: { status: 200, body: "Delivery status event received with logging error" },
          actions: []
        };
      }
    }

    if (eventRoute.kind === "subscription_validation") {
      const handleValidation = dependencies.handleEventGridValidation || handleEventGridValidation;
      return {
        response: handleValidation(eventRoute.event, context),
        actions: []
      };
    }
  }

  const actions = [];

  for (const eventRoute of routedEvents) {
    const event = eventRoute.event;
    if (eventRoute.kind !== "inbound_message") {
      actions.push({ kind: WEBHOOK_ACTIONS.ignored, event, route: eventRoute });
      continue;
    }

    const parseInbound = dependencies.parseInboundMessage || parseInboundMessage;
    const envelope = parseInbound(event, {
      route: eventRoute,
      normalizePhone: dependencies.normalizePhone,
      isOwnerSender: dependencies.isOwnerSender
    });
    if (!envelope.ok) {
      actions.push({
        kind: WEBHOOK_ACTIONS.invalidInbound,
        event,
        route: eventRoute,
        reason: envelope.reason
      });
      continue;
    }

    const policy = evaluatePolicy({
      text: envelope.inboundText,
      ownerDetected: envelope.ownerDetected
    });

    actions.push({
      kind: policy && policy.handled === true
        ? WEBHOOK_ACTIONS.policyResponse
        : WEBHOOK_ACTIONS.inboundMessage,
      event,
      route: eventRoute,
      envelope,
      policy
    });
  }

  return { response: null, actions };
}

async function applyInboundIdempotency(action, dependencies = {}) {
  if (!action || ![WEBHOOK_ACTIONS.policyResponse, WEBHOOK_ACTIONS.inboundMessage].includes(action.kind)) {
    return action;
  }

  const envelope = action.envelope;
  const idempotency = await (dependencies.gateInboundEvent || gateInboundEvent)({
    service: dependencies.idempotencyService,
    serviceFactory: dependencies.idempotencyServiceFactory,
    event: action.event,
    data: envelope.data,
    sender: envelope.normalizedFrom,
    inboundText: envelope.inboundText
  });

  if (!idempotency.ok) {
    return {
      ...action,
      kind: idempotency.duplicate
        ? WEBHOOK_ACTIONS.duplicateInbound
        : WEBHOOK_ACTIONS.idempotencyUnavailable,
      idempotency,
      response: idempotency.response
    };
  }

  return { ...action, idempotency };
}

module.exports = {
  WEBHOOK_ACTIONS,
  applyInboundIdempotency,
  prepareInboundEnvelope: parseInboundMessage,
  prepareWebhookExecution
};
