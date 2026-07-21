"use strict";

const assert = require("node:assert/strict");
const {
  createCosmosInboundEventIdempotencyStore
} = require("../src/lib/integration/cosmosInboundEventIdempotencyStore");
const {
  createInboundEventIdempotencyService,
  gateInboundEvent
} = require("../src/lib/asisInboundEventIdempotencyService");
const {
  WEBHOOK_ACTIONS,
  applyInboundIdempotency,
  prepareWebhookExecution
} = require("../src/lib/asisWebhookApplicationService");

function createFakeContainer() {
  const records = new Map();
  return {
    records,
    items: {
      async create(document) {
        if (records.has(document.id)) {
          const error = new Error("Conflict");
          error.code = 409;
          throw error;
        }
        records.set(document.id, structuredClone(document));
        return { resource: structuredClone(document) };
      }
    }
  };
}

function inboundEvent(id = "event-duplicate-1") {
  return {
    id,
    eventType: "Microsoft.Communication.AdvancedMessageReceived",
    eventTime: "2026-07-16T10:00:00.000Z",
    data: {
      messageId: "acs-message-1",
      from: "whatsapp:+50680000000",
      content: "test alerta asis",
      messageType: "text",
      receivedTimestamp: "2026-07-16T10:00:00.000Z"
    }
  };
}

async function run() {
  const container = createFakeContainer();
  const store = createCosmosInboundEventIdempotencyStore({
    container,
    now: () => new Date("2026-07-16T10:00:01.000Z")
  });
  const service = createInboundEventIdempotencyService({ store, ttlSeconds: 3600 });
  const event = inboundEvent();

  const first = await service.claim({
    event,
    data: event.data,
    sender: "+50680000000",
    inboundText: event.data.content
  });
  const duplicate = await service.claim({
    event,
    data: event.data,
    sender: "+50680000000",
    inboundText: event.data.content
  });

  assert.equal(first.claimed, true);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(first.recordId, duplicate.recordId);
  assert.equal(container.records.size, 1);

  const stored = [...container.records.values()][0];
  assert.equal(stored.eventId, event.id);
  assert.equal(stored.acsMessageId, event.data.messageId);
  assert.equal(stored.sender, "+50680000000");
  assert.equal(stored.eventType, event.eventType);
  assert.equal(stored.receivedAt, event.data.receivedTimestamp);
  assert.equal(stored.processedAt, "2026-07-16T10:00:01.000Z");
  assert.equal(stored.result, "processing_claimed");
  assert.equal(stored.ttl, 3600);
  assert.equal(stored.id.includes(event.id), false);

  const duplicateGate = await gateInboundEvent({
    service,
    event,
    data: event.data,
    sender: "+50680000000",
    inboundText: event.data.content
  });
  assert.equal(duplicateGate.duplicate, true);
  assert.equal(duplicateGate.response.status, 200);
  assert.deepEqual(duplicateGate.response.jsonBody, { ok: true, duplicate: true });

  const unavailableGate = await gateInboundEvent({
    service: { claim: async () => { throw new Error("sanitized-test-failure"); } },
    event,
    data: event.data,
    sender: "+50680000000",
    inboundText: event.data.content
  });
  assert.equal(unavailableGate.response.status, 503);
  assert.equal(JSON.stringify(unavailableGate).includes("sanitized-test-failure"), false);

  const ownerContainer = createFakeContainer();
  const ownerService = createInboundEventIdempotencyService({
    store: createCosmosInboundEventIdempotencyStore({ container: ownerContainer })
  });
  let policyCalls = 0;
  const dependencies = {
    normalizePhone: (value) => value.replace("whatsapp:", ""),
    isOwnerSender: () => true,
    idempotencyService: ownerService,
    evaluateInboundPolicy() {
      policyCalls += 1;
      return { handled: true, ownerAdminBoundary: { handled: true, reply: "safe" } };
    }
  };

  const firstExecution = await prepareWebhookExecution(
    { json: async () => event },
    {},
    dependencies
  );
  const duplicateExecution = await prepareWebhookExecution(
    { json: async () => event },
    {},
    dependencies
  );
  const firstAction = await applyInboundIdempotency(firstExecution.actions[0], {
    idempotencyService: ownerService
  });
  const duplicateAction = await applyInboundIdempotency(duplicateExecution.actions[0], {
    idempotencyService: ownerService
  });
  assert.equal(firstAction.kind, WEBHOOK_ACTIONS.policyResponse);
  assert.equal(duplicateAction.kind, WEBHOOK_ACTIONS.duplicateInbound);
  assert.equal(duplicateAction.response.status, 200);
  const ownerAlertOrReplyCount = [firstAction, duplicateAction]
    .filter((action) => action.kind === WEBHOOK_ACTIONS.policyResponse)
    .length;
  assert.equal(ownerAlertOrReplyCount, 1, "duplicate owner alert or reply must be suppressed");
  assert.equal(policyCalls, 2, "pure policy evaluation may occur before the side-effect gate");

  const batchContainer = createFakeContainer();
  const batchService = createInboundEventIdempotencyService({
    store: createCosmosInboundEventIdempotencyStore({ container: batchContainer })
  });
  const batchExecution = await prepareWebhookExecution({
    json: async () => [inboundEvent("batch-event-1"), inboundEvent("batch-event-2")]
  }, {}, {
    normalizePhone: (value) => value.replace("whatsapp:", ""),
    isOwnerSender: () => false,
    evaluateInboundPolicy: () => ({ handled: false })
  });
  assert.equal(batchContainer.records.size, 0, "batch preparation must not pre-claim later events");
  await applyInboundIdempotency(batchExecution.actions[0], { idempotencyService: batchService });
  assert.equal(batchContainer.records.size, 1);
  await applyInboundIdempotency(batchExecution.actions[1], { idempotencyService: batchService });
  assert.equal(batchContainer.records.size, 2);

  console.log("Asis durable inbound event idempotency tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
