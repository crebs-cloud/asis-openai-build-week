"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  requiresAdvancedModel,
  selectOpenAiDeployment
} = require("../src/lib/openAiModelRoutingPolicy");

const rootDir = path.join(__dirname, "..");

function testRoutingDisabledUsesGeneralDeployment() {
  const decision = selectOpenAiDeployment({
    text: "Design a zero trust architecture",
    routingEnabled: "false",
    generalDeployment: "general-placeholder",
    advancedDeployment: "advanced-placeholder"
  });

  assert.deepEqual(decision, {
    configured: true,
    route: "general",
    deployment: "general-placeholder",
    reason: "routing_disabled",
    routingEnabled: false
  });
}

function testLegacyDeploymentRemainsSafeRollback() {
  const decision = selectOpenAiDeployment({
    text: "hello",
    legacyDeployment: "legacy-placeholder"
  });

  assert.equal(decision.configured, true);
  assert.equal(decision.route, "general");
  assert.equal(decision.deployment, "legacy-placeholder");
}

function testGeneralAndAdvancedRoutesAreExplicit() {
  const settings = {
    routingEnabled: "true",
    generalDeployment: "general-placeholder",
    advancedDeployment: "advanced-placeholder"
  };
  const general = selectOpenAiDeployment({
    ...settings,
    text: "Ayúdame a redactar un correo breve"
  });
  const advanced = selectOpenAiDeployment({
    ...settings,
    text: "Diseña una arquitectura zero trust y un threat model para Azure"
  });

  assert.equal(general.route, "general");
  assert.equal(general.deployment, "general-placeholder");
  assert.equal(advanced.route, "advanced");
  assert.equal(advanced.deployment, "advanced-placeholder");
  assert.equal(requiresAdvancedModel("Analiza la causa raíz de este stack trace"), true);
}

function testMissingOrDuplicateAdvancedDeploymentFallsBackBeforeCallingProvider() {
  const missing = selectOpenAiDeployment({
    routingEnabled: "true",
    generalDeployment: "general-placeholder",
    text: "architecture review"
  });
  const duplicate = selectOpenAiDeployment({
    routingEnabled: "true",
    generalDeployment: "same-placeholder",
    advancedDeployment: "same-placeholder",
    text: "architecture review"
  });

  assert.equal(missing.route, "general");
  assert.equal(missing.reason, "advanced_deployment_unavailable");
  assert.equal(duplicate.route, "general");
  assert.equal(duplicate.reason, "advanced_deployment_unavailable");
}

function testNoConfiguredGeneralDeploymentFailsClosed() {
  const decision = selectOpenAiDeployment({
    routingEnabled: "true",
    advancedDeployment: "advanced-placeholder",
    text: "architecture review"
  });

  assert.equal(decision.configured, false);
  assert.equal(decision.deployment, null);
}

function testWebhookWiresVersionedSettingsAndSingleSelectedDeployment() {
  const source = fs.readFileSync(
    path.join(rootDir, "src", "functions", "whatsappWebhook.js"),
    "utf8"
  );

  for (const setting of [
    "AZURE_OPENAI_GENERAL_DEPLOYMENT",
    "AZURE_OPENAI_ADVANCED_DEPLOYMENT",
    "AZURE_OPENAI_ROUTING_ENABLED",
    "AZURE_OPENAI_DEPLOYMENT"
  ]) {
    assert.equal(source.includes(setting), true, `${setting} must remain wired`);
  }
  assert.equal(source.includes("selectOpenAiDeployment"), true);
  assert.equal(source.includes("model: routingDecision.deployment"), true);
  assert.equal(source.includes("maxRetries: 0"), true);
  assert.equal(source.includes('reasoningEffort: "minimal"'), true);
}

testRoutingDisabledUsesGeneralDeployment();
testLegacyDeploymentRemainsSafeRollback();
testGeneralAndAdvancedRoutesAreExplicit();
testMissingOrDuplicateAdvancedDeploymentFallsBackBeforeCallingProvider();
testNoConfiguredGeneralDeploymentFailsClosed();
testWebhookWiresVersionedSettingsAndSingleSelectedDeployment();
console.log("OpenAI dual-model routing runtime tests passed.");
