"use strict";

const { createCosmosOtpChallengeStore } = require("./cosmosOtpChallengeStore");
const {
  createCosmosInboundEventIdempotencyStore
} = require("./cosmosInboundEventIdempotencyStore");

function createCosmosWebhookStoreAdapter(options = {}) {
  const conversations = options.conversations || null;
  const leads = options.leads || null;
  const contacts = options.contacts || null;
  const otp = options.otp || null;
  const inboundEvents = options.inboundEvents || null;

  return {
    adapterType: "cosmos_webhook_store",
    conversations: conversations ? {
      create(document) {
        return conversations.items.create(document);
      },
      query(querySpec) {
        return conversations.items.query(querySpec).fetchAll();
      }
    } : null,
    leads: leads ? {
      read(id, partitionKey) {
        return leads.item(id, partitionKey).read();
      },
      upsert(document) {
        return leads.items.upsert(document);
      }
    } : null,
    contacts: contacts ? {
      read(id, partitionKey) {
        return contacts.item(id, partitionKey).read();
      },
      upsert(document) {
        return contacts.items.upsert(document);
      },
      query(querySpec) {
        return contacts.items.query(querySpec).fetchAll();
      }
    } : null,
    otp: otp ? createCosmosOtpChallengeStore({ container: otp }) : null,
    inboundEvents: inboundEvents
      ? createCosmosInboundEventIdempotencyStore({ container: inboundEvents })
      : null
  };
}

module.exports = { createCosmosWebhookStoreAdapter };
