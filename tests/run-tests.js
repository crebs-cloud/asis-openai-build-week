"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const tests = [
  "asisWebhookLayering.test.js",
  "asisInboundEventIdempotency.test.js",
  "asisIntegrationAdapters.test.js",
  "openAiModelRoutingRuntime.test.js",
  "asisOtpSecurityAndRateLimit.test.js",
  "acsWhatsAppMessagingAdapter.test.js",
  "asisOtpApplicationService.test.js",
  "asisOtpHttpApi.test.js"
];

for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], {
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("All public judging tests passed.");
