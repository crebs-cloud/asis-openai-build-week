"use strict";

const { EmailClient } = require("@azure/communication-email");

function createCommunicationEmailClient(options = {}) {
  if (!options.connectionString) {
    throw new Error("Communication Email settings are incomplete.");
  }
  return options.client || new EmailClient(options.connectionString);
}

function createCommunicationEmailAdapter(options = {}) {
  if (!options.connectionString || !options.senderAddress) {
    throw new Error("Communication Email adapter settings are incomplete.");
  }
  const client = createCommunicationEmailClient(options);

  async function send(message) {
    if (!message || typeof message !== "object") {
      throw new Error("Communication Email message is required.");
    }
    const poller = await client.beginSend(message);
    const result = await poller.pollUntilDone();
    const status = result && result.status ? String(result.status) : "";
    return {
      ok: status === "Succeeded",
      sent: status === "Succeeded",
      status,
      id: result && result.id ? String(result.id) : null
    };
  }

  return {
    adapterType: "azure_communication_email",
    send,
    async sendProbe({ to, correlationId }) {
      return send({
        senderAddress: options.senderAddress,
        content: {
          subject: `[NONPROD] Asis integration probe ${correlationId}`,
          plainText: `Non-production integration probe ${correlationId}. No customer data is included.`
        },
        recipients: { to: [{ address: to }] }
      });
    }
  };
}

module.exports = { createCommunicationEmailClient, createCommunicationEmailAdapter };
