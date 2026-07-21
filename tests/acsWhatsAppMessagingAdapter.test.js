"use strict";

const assert = require("node:assert/strict");
const {
  buildOtpAuthenticationTemplate,
  createAcsWhatsAppMessagingAdapter
} = require("../src/lib/integration/acsWhatsAppMessagingAdapter");

async function run() {
  const calls = [];
  const client = {
    path(route) {
      assert.equal(route, "/messages/notifications:send");
      return {
        async post(request) {
          calls.push(request);
          return {
            status: "202",
            body: { receipts: [{ messageId: "sanitized-message-id" }] }
          };
        }
      };
    }
  };

  const adapter = createAcsWhatsAppMessagingAdapter({
    connectionString: "endpoint=https://example.invalid/;accesskey=not-a-real-secret",
    channelRegistrationId: "sanitized-channel-reference",
    templateName: "asis_otp_login",
    templateLanguage: "es",
    client
  });
  const result = await adapter.sendOtp({ to: "+50688888888", code: "123456" });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, "sanitized-message-id");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].contentType, "application/json");
  assert.equal(calls[0].body.kind, "template");
  assert.deepEqual(calls[0].body.to, ["+50688888888"]);
  assert.equal(Object.hasOwn(calls[0].body, "content"), false);
  assert.deepEqual(calls[0].body.template, {
    name: "asis_otp_login",
    language: "es",
    bindings: {
      kind: "whatsApp",
      body: [{ refValue: "otp_code" }],
      buttons: [{ subType: "url", refValue: "copy_code" }]
    },
    values: [
      { kind: "text", name: "otp_code", text: "123456" },
      { kind: "quickAction", name: "copy_code", text: "123456" }
    ]
  });

  assert.throws(
    () => createAcsWhatsAppMessagingAdapter({
      connectionString: "configured",
      channelRegistrationId: "configured",
      templateLanguage: "es",
      env: {},
      client
    }),
    /not configured/
  );
  assert.throws(
    () => buildOtpAuthenticationTemplate({
      templateName: "Invalid Template Name",
      templateLanguage: "es",
      code: "123456"
    }),
    /ASIS_OTP_TEMPLATE_NAME/
  );
  await assert.rejects(
    adapter.sendOtp({ to: "+50688888888", code: "12345" }),
    /OTP code/
  );
  await assert.rejects(
    adapter.sendOtp({ to: "not-a-phone", code: "123456" }),
    /WhatsApp recipient/
  );

  console.log("ACS WhatsApp OTP template adapter tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
