"use strict";

const { OpenAI } = require("openai");

function createOpenAiRuntimeClient(options = {}) {
  const endpoint = String(options.endpoint || "").replace(/\/$/, "");
  if (!endpoint || !options.apiKey) throw new Error("OpenAI adapter settings are incomplete.");
  const clientOptions = {
    apiKey: options.apiKey,
    baseURL: `${endpoint}/openai/v1/`,
    maxRetries: options.maxRetries === undefined ? 0 : options.maxRetries
  };
  return options.client ||
    (typeof options.clientFactory === "function"
      ? options.clientFactory(clientOptions)
      : new OpenAI(clientOptions));
}

function createOpenAiChatCompletionsAdapter(options = {}) {
  const endpoint = String(options.endpoint || "").replace(/\/$/, "");
  const apiKey = options.apiKey;
  if (!endpoint || !apiKey) throw new Error("OpenAI adapter settings are incomplete.");
  const client = createOpenAiRuntimeClient({ ...options, endpoint, apiKey });

  return {
    adapterType: "azure_openai_chat_completions",
    async complete({ model, messages, maxTokens, temperature, reasoningEffort }) {
      if (!model || !Array.isArray(messages)) {
        throw new Error("OpenAI chat completion input is incomplete.");
      }
      const request = {
        model,
        messages,
        max_completion_tokens: maxTokens
      };
      if (temperature !== undefined && temperature !== null) {
        request.temperature = temperature;
      }
      if (reasoningEffort) {
        request.reasoning_effort = reasoningEffort;
      }
      const result = await client.chat.completions.create(request);
      return {
        content: result && result.choices && result.choices[0] && result.choices[0].message
          ? result.choices[0].message.content || null
          : null
      };
    }
  };
}

function createOpenAiChatAdapter(options = {}) {
  const endpoint = String(options.endpoint || "").replace(/\/$/, "");
  const apiKey = options.apiKey;
  const deployment = options.deployment;
  if (!endpoint || !apiKey || !deployment) throw new Error("OpenAI adapter settings are incomplete.");
  const client = createOpenAiRuntimeClient({ ...options, endpoint, apiKey });

  return {
    adapterType: "azure_openai",
    async probe() {
      const response = await client.responses.create({
        model: deployment,
        input: "Reply with exactly ASIS_E2E_OK",
        max_output_tokens: 20
      });
      const text = String(response.output_text || "").trim();
      return { ok: text === "ASIS_E2E_OK", responseMatched: text === "ASIS_E2E_OK" };
    }
  };
}

module.exports = {
  createOpenAiRuntimeClient,
  createOpenAiChatCompletionsAdapter,
  createOpenAiChatAdapter
};
