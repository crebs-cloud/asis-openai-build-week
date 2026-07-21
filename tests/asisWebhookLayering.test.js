"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ingestWebhookRequest } = require("../src/lib/asisWebhookEventIngestion");
const { routeWebhookEvent } = require("../src/lib/asisWebhookEventRouter");
const { evaluateInboundPolicy } = require("../src/lib/asisWebhookPolicyService");
const {
  WEBHOOK_ACTIONS,
  prepareInboundEnvelope,
  prepareWebhookExecution
} = require("../src/lib/asisWebhookApplicationService");

const rootDir = path.join(__dirname, "..");

async function run() {
  const invalid = await ingestWebhookRequest({ json: async () => { throw new Error("bad json"); } });
  assert.equal(invalid.response.status, 400);

  const event = {
    id: "event-1",
    eventType: "Microsoft.Communication.AdvancedMessageReceived",
    data: { from: "whatsapp:+50688888888", content: "hola", messageType: "text" }
  };
  const ingested = await ingestWebhookRequest({ json: async () => event });
  assert.equal(ingested.events.length, 1);
  assert.equal(routeWebhookEvent(event).kind, "inbound_message");
  assert.equal(routeWebhookEvent({ eventType: "unknown" }).kind, "ignored");

  const envelope = prepareInboundEnvelope(event, {
    normalizePhone: (value) => value.replace("whatsapp:", ""),
    isOwnerSender: () => false
  });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.normalizedFrom, "+50688888888");
  assert.equal(envelope.inboundText, "hola");

  const policy = evaluateInboundPolicy({ text: "listar contactos", ownerDetected: false });
  assert.equal(policy.handled, true);
  assert.equal(policy.ownerAdminBoundary.dataAccessAllowed, false);
  assert.equal(policy.ownerAdminBoundary.cosmosReadAllowed, false);

  const contextEvents = [];
  const invalidExecution = await prepareWebhookExecution(
    { json: async () => { throw new Error("sensitive-invalid-body"); } },
    { error: (message) => contextEvents.push(message) }
  );
  assert.equal(invalidExecution.response.status, 400);
  assert.deepEqual(contextEvents, ["Invalid webhook request body."]);
  assert.equal(JSON.stringify(contextEvents).includes("sensitive-invalid-body"), false);

  const validationExecution = await prepareWebhookExecution({
    json: async () => ({
      eventType: "Microsoft.EventGrid.SubscriptionValidationEvent",
      data: { validationCode: "validation-code" }
    })
  }, { log() {} });
  assert.deepEqual(validationExecution.response, {
    status: 200,
    jsonBody: { validationResponse: "validation-code" }
  });

  const deliveryEvents = [];
  const deliveryExecution = await prepareWebhookExecution({
    json: async () => ({
      id: "delivery-event",
      eventType: "Microsoft.Communication.AdvancedMessageDeliveryStatusUpdated",
      data: { status: "delivered" }
    })
  }, {}, {
    deliveryStatusAdapter: {
      async handle(deliveryEvent) {
        deliveryEvents.push(deliveryEvent.id);
        return { status: 200, body: "Delivery status event logged" };
      }
    }
  });
  assert.deepEqual(deliveryEvents, ["delivery-event"]);
  assert.deepEqual(deliveryExecution.actions, []);

  const actionExecution = await prepareWebhookExecution({
    json: async () => [
      { id: "ignored", eventType: "unknown", data: {} },
      {
        id: "missing-sender",
        eventType: "Microsoft.Communication.AdvancedMessageReceived",
        data: { content: "hola" }
      },
      {
        id: "blocked-admin",
        eventType: "Microsoft.Communication.AdvancedMessageReceived",
        data: { from: "whatsapp:+50688888888", content: "listar contactos" }
      },
      event
    ]
  }, {}, {
    normalizePhone: (value) => value.replace("whatsapp:", ""),
    isOwnerSender: () => false,
    idempotencyService: {
      async claim() {
        return { claimed: true, duplicate: false, recordId: "test-record" };
      }
    }
  });
  assert.deepEqual(
    actionExecution.actions.map((action) => action.kind),
    [
      WEBHOOK_ACTIONS.ignored,
      WEBHOOK_ACTIONS.invalidInbound,
      WEBHOOK_ACTIONS.policyResponse,
      WEBHOOK_ACTIONS.inboundMessage
    ]
  );
  assert.equal(actionExecution.actions[2].policy.ownerAdminBoundary.cosmosReadAllowed, false);
  assert.equal(actionExecution.actions[3].envelope.inboundText, "hola");

  const webhookSource = fs.readFileSync(
    path.join(rootDir, "src", "functions", "whatsappWebhook.js"),
    "utf8"
  );
  const applicationSource = fs.readFileSync(
    path.join(rootDir, "src", "lib", "asisWebhookApplicationService.js"),
    "utf8"
  );
  const layeringContract = fs.readFileSync(
    path.join(rootDir, "docs", "ASIS_WEBHOOK_LAYERING_CONTRACT.md"),
    "utf8"
  );
  assert.equal(webhookSource.includes("prepareWebhookExecution(request, context"), true);
  assert.equal(webhookSource.includes("createAcsDeliveryStatusEventAdapter()"), true);
  assert.equal(webhookSource.includes("action.kind === WEBHOOK_ACTIONS.policyResponse"), true);
  assert.equal(webhookSource.includes("rawData: deliveryData"), false);
  assert.equal(applicationSource.includes('require("./asisWebhookEventIngestion")'), true);
  assert.equal(applicationSource.includes('require("./asisWebhookEventRouter")'), true);
  assert.equal(applicationSource.includes('require("./asisWebhookPolicyService")'), true);
  assert.equal(layeringContract.includes("Artifact type: `contract`"), true);
  for (const action of Object.values(WEBHOOK_ACTIONS)) {
    assert.equal(layeringContract.includes(`\`${action}\``), true);
  }

  console.log("Asis webhook layering tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
