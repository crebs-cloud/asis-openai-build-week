"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createAcsWhatsAppMessagingAdapter
} = require("../src/lib/integration/acsWhatsAppMessagingAdapter");
const {
  createCommunicationEmailAdapter
} = require("../src/lib/integration/communicationEmailAdapter");
const {
  createOpenAiRuntimeClient,
  createOpenAiChatCompletionsAdapter
} = require("../src/lib/integration/openAiChatAdapter");
const {
  GOOGLE_PLACES_TEXT_SEARCH_URL,
  createGooglePlacesRuntimeAdapter
} = require("../src/lib/integration/googlePlacesAdapter");
const {
  createCosmosWebhookStoreAdapter
} = require("../src/lib/integration/cosmosWebhookStoreAdapter");

const rootDir = path.join(__dirname, "..");

async function testAcsAdapterNormalizesProviderResponse() {
  let request = null;
  const client = {
    path(value) {
      assert.equal(value, "/messages/notifications:send");
      return {
        async post(input) {
          request = input;
          return {
            status: "202",
            body: { messageId: "provider-message-placeholder", ignored: "provider-only" }
          };
        }
      };
    }
  };
  const adapter = createAcsWhatsAppMessagingAdapter({
    connectionString: "acs-setting-placeholder",
    channelRegistrationId: "channel-placeholder",
    client
  });
  const result = await adapter.sendText({ to: "recipient-placeholder", content: "hello" });

  assert.deepEqual(request.body, {
    channelRegistrationId: "channel-placeholder",
    to: ["recipient-placeholder"],
    kind: "text",
    content: "hello"
  });
  assert.equal(result.sent, true);
  assert.equal(result.messageId, "provider-message-placeholder");
  assert.equal(Object.hasOwn(result, "body"), false);
  assert.deepEqual(result.bodyKeys, ["messageId", "ignored"]);
}

async function testEmailAdapterNormalizesProviderResponse() {
  let message = null;
  const adapter = createCommunicationEmailAdapter({
    connectionString: "email-setting-placeholder",
    senderAddress: "sender@example.invalid",
    client: {
      async beginSend(input) {
        message = input;
        return {
          async pollUntilDone() {
            return { status: "Succeeded", id: "email-operation-placeholder", providerData: "private" };
          }
        };
      }
    }
  });
  const result = await adapter.send({
    senderAddress: "sender@example.invalid",
    content: { subject: "subject", plainText: "body" },
    recipients: { to: [{ address: "recipient@example.invalid" }] }
  });

  assert.equal(message.content.subject, "subject");
  assert.deepEqual(result, {
    ok: true,
    sent: true,
    status: "Succeeded",
    id: "email-operation-placeholder"
  });
}

async function testOpenAiAdapterNormalizesCompletion() {
  let request = null;
  const adapter = createOpenAiChatCompletionsAdapter({
    endpoint: "https://openai.example.invalid",
    apiKey: "api-key-placeholder",
    client: {
      chat: {
        completions: {
          async create(input) {
            request = input;
            return { choices: [{ message: { content: "adapter reply" } }] };
          }
        }
      }
    }
  });
  const result = await adapter.complete({
    model: "deployment-placeholder",
    messages: [{ role: "user", content: "hello" }],
    maxTokens: 120,
    temperature: 0.3,
    reasoningEffort: "minimal"
  });

  assert.equal(request.max_completion_tokens, 120);
  assert.equal(Object.hasOwn(request, "max_tokens"), false);
  assert.equal(request.model, "deployment-placeholder");
  assert.equal(request.temperature, 0.3);
  assert.equal(request.reasoning_effort, "minimal");
  assert.deepEqual(result, { content: "adapter reply" });
}

async function testOpenAiAdapterOmitsUnsupportedOptionalParameters() {
  let request = null;
  const adapter = createOpenAiChatCompletionsAdapter({
    endpoint: "https://openai.example.invalid",
    apiKey: "api-key-placeholder",
    client: {
      chat: {
        completions: {
          async create(input) {
            request = input;
            return { choices: [{ message: { content: "adapter reply" } }] };
          }
        }
      }
    }
  });

  await adapter.complete({
    model: "deployment-placeholder",
    messages: [{ role: "user", content: "hello" }],
    maxTokens: 120,
    reasoningEffort: "minimal"
  });

  assert.equal(request.max_completion_tokens, 120);
  assert.equal(request.reasoning_effort, "minimal");
  assert.equal(Object.hasOwn(request, "temperature"), false);
}

function testOpenAiRuntimeClientDisablesSdkRetries() {
  let clientOptions = null;
  const client = createOpenAiRuntimeClient({
    endpoint: "https://openai.example.invalid",
    apiKey: "api-key-placeholder",
    clientFactory(options) {
      clientOptions = options;
      return { client: "placeholder" };
    }
  });

  assert.deepEqual(client, { client: "placeholder" });
  assert.equal(clientOptions.maxRetries, 0);
  assert.equal(clientOptions.apiKey, "api-key-placeholder");
  assert.equal(clientOptions.baseURL, "https://openai.example.invalid/openai/v1/");
}

async function testGooglePlacesAdapterOwnsRequestShape() {
  let requestedUrl = null;
  let requestedOptions = null;
  const adapter = createGooglePlacesRuntimeAdapter({
    apiKey: "places-key-placeholder",
    async fetchImpl(url, options) {
      requestedUrl = url;
      requestedOptions = options;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return { places: [{ displayName: { text: "Place placeholder" } }] };
        }
      };
    }
  });
  const result = await adapter.searchBusiness({ query: "place", languageCode: "es" });

  assert.equal(requestedUrl, GOOGLE_PLACES_TEXT_SEARCH_URL);
  assert.equal(requestedOptions.headers["X-Goog-Api-Key"], "places-key-placeholder");
  assert.equal(JSON.parse(requestedOptions.body).regionCode, "CR");
  assert.equal(result.ok, true);
  assert.equal(result.places.length, 1);
  assert.equal(JSON.stringify(result).includes("places-key-placeholder"), false);
}

async function testCosmosAdapterOwnsContainerOperations() {
  const calls = [];
  const makeContainer = (name) => ({
    items: {
      async create(document) {
        calls.push([name, "create", document.id]);
        return { resource: document };
      },
      async upsert(document) {
        calls.push([name, "upsert", document.id]);
        return { resource: document };
      },
      query(querySpec) {
        calls.push([name, "query", querySpec.query]);
        return { async fetchAll() { return { resources: [{ id: `${name}-result` }] }; } };
      }
    },
    item(id, partitionKey) {
      return {
        async read() {
          calls.push([name, "read", id, partitionKey]);
          return { resource: { id } };
        }
      };
    }
  });
  const adapter = createCosmosWebhookStoreAdapter({
    conversations: makeContainer("conversations"),
    leads: makeContainer("leads"),
    contacts: makeContainer("contacts"),
    otp: makeContainer("otp")
  });

  await adapter.conversations.create({ id: "conversation-1" });
  await adapter.conversations.query({ query: "SELECT * FROM c" });
  await adapter.leads.read("lead-1", "sender-1");
  await adapter.leads.upsert({ id: "lead-1" });
  await adapter.contacts.read("contact-1", "sender-1");
  await adapter.contacts.upsert({ id: "contact-1" });
  await adapter.contacts.query({ query: "SELECT * FROM c" });

  assert.equal(adapter.adapterType, "cosmos_webhook_store");
  assert.equal(adapter.otp.adapterType, "cosmos_otp_challenge_store");
  assert.deepEqual(calls.map((entry) => entry.slice(0, 2)), [
    ["conversations", "create"],
    ["conversations", "query"],
    ["leads", "read"],
    ["leads", "upsert"],
    ["contacts", "read"],
    ["contacts", "upsert"],
    ["contacts", "query"]
  ]);
}

async function testProviderFailuresAreNormalized() {
  const acs = createAcsWhatsAppMessagingAdapter({
    connectionString: "acs-setting-placeholder",
    channelRegistrationId: "channel-placeholder",
    client: {
      path() {
        return { async post() { return { status: "500", body: { error: "private-provider-error" } }; } };
      }
    }
  });
  const acsResult = await acs.sendText({ to: "recipient-placeholder", content: "hello" });
  assert.equal(acsResult.sent, false);
  assert.equal(JSON.stringify(acsResult).includes("private-provider-error"), false);

  const email = createCommunicationEmailAdapter({
    connectionString: "email-setting-placeholder",
    senderAddress: "sender@example.invalid",
    client: {
      async beginSend() {
        return { async pollUntilDone() { return { status: "Failed", error: "private-provider-error" }; } };
      }
    }
  });
  const emailResult = await email.send({ content: {}, recipients: {} });
  assert.equal(emailResult.sent, false);
  assert.equal(JSON.stringify(emailResult).includes("private-provider-error"), false);

  const places = createGooglePlacesRuntimeAdapter({
    apiKey: "places-key-placeholder",
    async fetchImpl() {
      return {
        ok: false,
        status: 503,
        statusText: "Unavailable\r\nprivate-provider-error",
        async json() { return { error: { message: "private-provider-error" } }; }
      };
    }
  });
  const placesResult = await places.searchBusiness({ query: "place" });
  assert.equal(placesResult.ok, false);
  assert.equal(placesResult.hasError, true);
  assert.equal(placesResult.statusText, null);
  assert.equal(JSON.stringify(placesResult).includes("private-provider-error"), false);
}

function testInvalidSettingsFailClosed() {
  assert.throws(() => createAcsWhatsAppMessagingAdapter({}), /not configured/);
  assert.throws(() => createCommunicationEmailAdapter({}), /incomplete/);
  assert.throws(() => createOpenAiChatCompletionsAdapter({}), /incomplete/);
  assert.throws(() => createGooglePlacesRuntimeAdapter({}), /incomplete/);
}

function testWebhookUsesOnlyAdapterInterfaces() {
  const source = fs.readFileSync(
    path.join(rootDir, "src", "functions", "whatsappWebhook.js"),
    "utf8"
  );
  for (const required of [
    "createAcsWhatsAppMessagingAdapter",
    "createCommunicationEmailAdapter",
    "createOpenAiChatCompletionsAdapter",
    "createGooglePlacesRuntimeAdapter",
    "createCosmosWebhookStoreAdapter"
  ]) {
    assert.equal(source.includes(required), true, `${required} must be wired into the webhook`);
  }
  for (const providerMechanic of [
    "/messages/notifications:send",
    "places.googleapis.com/v1/places:searchText",
    ".chat.completions.create(",
    ".beginSend(",
    ".items.query(",
    ".items.upsert(",
    ".items.create("
  ]) {
    assert.equal(source.includes(providerMechanic), false, `${providerMechanic} must stay in adapters`);
  }
}

function testContractDocumentsBoundary() {
  const source = fs.readFileSync(
    path.join(rootDir, "docs", "ASIS_WEBHOOK_INTEGRATION_ADAPTERS_CONTRACT.md"),
    "utf8"
  );
  assert.equal(source.includes("Artifact type: `contract`"), true);
  assert.equal(source.includes("No deployment is performed"), true);
  assert.equal(source.includes("Provider credentials never appear in adapter results"), true);
}

async function run() {
  await testAcsAdapterNormalizesProviderResponse();
  await testEmailAdapterNormalizesProviderResponse();
  await testOpenAiAdapterNormalizesCompletion();
  await testOpenAiAdapterOmitsUnsupportedOptionalParameters();
  testOpenAiRuntimeClientDisablesSdkRetries();
  await testGooglePlacesAdapterOwnsRequestShape();
  await testCosmosAdapterOwnsContainerOperations();
  await testProviderFailuresAreNormalized();
  testInvalidSettingsFailClosed();
  testWebhookUsesOnlyAdapterInterfaces();
  testContractDocumentsBoundary();
  console.log("Asis integration adapter tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
