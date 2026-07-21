"use strict";

const {
  WEBHOOK_ACTIONS,
  prepareWebhookExecution
} = require("../lib/asisWebhookApplicationService");
const {
  createAcsDeliveryStatusEventAdapter
} = require("../lib/integration/acsDeliveryStatusEventAdapter");
const {
  createAcsWhatsAppMessagingAdapter
} = require("../lib/integration/acsWhatsAppMessagingAdapter");
const {
  createCommunicationEmailAdapter
} = require("../lib/integration/communicationEmailAdapter");
const {
  createOpenAiChatCompletionsAdapter
} = require("../lib/integration/openAiChatAdapter");
const {
  createGooglePlacesRuntimeAdapter
} = require("../lib/integration/googlePlacesAdapter");
const {
  createCosmosWebhookStoreAdapter
} = require("../lib/integration/cosmosWebhookStoreAdapter");
const {
  selectOpenAiDeployment
} = require("../lib/openAiModelRoutingPolicy");

function readRuntimeConfig(env = process.env) {
  return {
    generalDeployment: env.AZURE_OPENAI_GENERAL_DEPLOYMENT,
    advancedDeployment: env.AZURE_OPENAI_ADVANCED_DEPLOYMENT,
    routingEnabled: env.AZURE_OPENAI_ROUTING_ENABLED,
    legacyDeployment: env.AZURE_OPENAI_DEPLOYMENT
  };
}

function createRuntimeAdapters(config = {}, clients = {}) {
  return {
    messaging: createAcsWhatsAppMessagingAdapter({
      connectionString: config.communicationServicesConnectionString,
      channelRegistrationId: config.whatsAppChannelId,
      client: clients.messaging
    }),
    email: createCommunicationEmailAdapter({
      connectionString: config.emailConnectionString,
      senderAddress: config.emailSender,
      client: clients.email
    }),
    openAi: createOpenAiChatCompletionsAdapter({
      endpoint: config.openAiEndpoint,
      apiKey: config.openAiApiKey,
      client: clients.openAi
    }),
    places: createGooglePlacesRuntimeAdapter({
      apiKey: config.googlePlacesApiKey,
      fetchImpl: clients.fetch
    }),
    store: createCosmosWebhookStoreAdapter(clients.cosmosContainers || {})
  };
}

function createModelRequest(text, config = {}) {
  const routingDecision = selectOpenAiDeployment({
    text,
    routingEnabled: config.routingEnabled,
    generalDeployment: config.generalDeployment,
    advancedDeployment: config.advancedDeployment,
    legacyDeployment: config.legacyDeployment
  });
  return {
    model: routingDecision.deployment,
    reasoningEffort: "minimal",
    maxRetries: 0
  };
}

async function whatsappWebhook(request, context = console, dependencies = {}) {
  const deliveryStatusAdapter = dependencies.deliveryStatusAdapter ||
    createAcsDeliveryStatusEventAdapter();
  const execution = await prepareWebhookExecution(request, context, {
    ...dependencies,
    deliveryStatusAdapter
  });

  for (const action of execution.actions || []) {
    if (action.kind === WEBHOOK_ACTIONS.policyResponse) {
      context.log?.("Policy response prepared.");
    }
  }

  return execution.response || {
    status: 200,
    jsonBody: {
      accepted: true,
      actions: (execution.actions || []).map((action) => action.kind)
    }
  };
}

module.exports = {
  createModelRequest,
  createRuntimeAdapters,
  readRuntimeConfig,
  whatsappWebhook
};
