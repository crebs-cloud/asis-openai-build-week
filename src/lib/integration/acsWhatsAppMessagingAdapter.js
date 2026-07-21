"use strict";

const NotificationClient = require("@azure-rest/communication-messages").default;

const OTP_BODY_VALUE_NAME = "otp_code";
const OTP_COPY_VALUE_NAME = "copy_code";

function requireSetting(value, name, pattern) {
  const normalized = String(value || "").trim();
  if (!normalized || (pattern && !pattern.test(normalized))) {
    throw new Error(`${name} is not configured correctly.`);
  }
  return normalized;
}

function buildOtpAuthenticationTemplate(options = {}) {
  const templateName = requireSetting(
    options.templateName,
    "ASIS_OTP_TEMPLATE_NAME",
    /^[a-z0-9_]{1,512}$/
  );
  const templateLanguage = requireSetting(
    options.templateLanguage,
    "ASIS_OTP_TEMPLATE_LANGUAGE",
    /^[a-z]{2,3}(?:_[A-Z]{2})?$/
  );
  const code = requireSetting(options.code, "OTP code", /^\d{6}$/);

  return {
    name: templateName,
    language: templateLanguage,
    bindings: {
      kind: "whatsApp",
      body: [{ refValue: OTP_BODY_VALUE_NAME }],
      buttons: [{ subType: "url", refValue: OTP_COPY_VALUE_NAME }]
    },
    values: [
      { kind: "text", name: OTP_BODY_VALUE_NAME, text: code },
      { kind: "quickAction", name: OTP_COPY_VALUE_NAME, text: code }
    ]
  };
}

function objectKeys(value) {
  if (!value || typeof value !== "object") return [];
  return Object.keys(value)
    .filter((key) => /^[A-Za-z0-9_.:-]{1,80}$/.test(key))
    .slice(0, 20);
}

function extractMessageId(value) {
  if (!value || typeof value !== "object") return null;
  const receipts = Array.isArray(value.receipts) ? value.receipts : [];
  const firstReceipt = receipts[0] || null;
  const candidates = [
    value.messageId,
    value.messageID,
    value.message_id,
    value.id,
    value.operationId,
    firstReceipt && firstReceipt.messageId,
    firstReceipt && firstReceipt.messageID,
    firstReceipt && firstReceipt.message_id,
    firstReceipt && firstReceipt.id,
    value.body && value.body.messageId,
    value.body && value.body.messageID,
    value.body && value.body.message_id,
    value.body && value.body.id,
    value._response && value._response.parsedBody && value._response.parsedBody.messageId,
    value._response && value._response.parsedBody && value._response.parsedBody.messageID,
    value._response && value._response.parsedBody && value._response.parsedBody.message_id
  ];
  const candidate = candidates.find(Boolean);
  return candidate ? String(candidate) : null;
}

function normalizeSendResult(result) {
  const parsedBody = result && result._response && result._response.parsedBody
    ? result._response.parsedBody
    : null;
  const body = result && result.body ? result.body : parsedBody;
  const status = String(result && result.status ? result.status : "");
  const messageId = extractMessageId(result) || extractMessageId(body);

  return {
    ok: status === "202",
    sent: status === "202",
    status,
    messageId,
    acsMessageId: messageId,
    resultKeys: objectKeys(result),
    bodyKeys: objectKeys(body)
  };
}

function createAcsMessagesClient(options = {}) {
  if (!options.connectionString) {
    throw new Error("ACS messaging settings are not configured.");
  }
  const clientFactory = options.clientFactory || NotificationClient;
  return clientFactory(options.connectionString);
}

function createAcsWhatsAppMessagingAdapter(options = {}) {
  const env = options.env || process.env;
  const connectionString = options.connectionString || env.COMMUNICATION_SERVICES_CONNECTION_STRING;
  const channelRegistrationId = options.channelRegistrationId || env.WHATSAPP_CHANNEL_ID;
  const templateName = options.templateName || env.ASIS_OTP_TEMPLATE_NAME;
  const templateLanguage = options.templateLanguage || env.ASIS_OTP_TEMPLATE_LANGUAGE;
  if (!connectionString || !channelRegistrationId) {
    throw new Error("ACS WhatsApp messaging settings are not configured.");
  }
  if (Boolean(templateName) !== Boolean(templateLanguage)) {
    throw new Error("ACS WhatsApp messaging settings are not configured.");
  }

  const client = options.client || createAcsMessagesClient({ ...options, connectionString });

  return {
    adapterType: "acs_whatsapp",
    async sendText({ to, content }) {
      const result = await client.path("/messages/notifications:send").post({
        contentType: "application/json",
        body: {
          channelRegistrationId,
          to: [to],
          kind: "text",
          content
        }
      });

      return normalizeSendResult(result);
    },
    async sendOtp({ to, code }) {
      const recipient = requireSetting(to, "WhatsApp recipient", /^\+[1-9]\d{7,14}$/);
      const template = buildOtpAuthenticationTemplate({ templateName, templateLanguage, code });
      const result = await client.path("/messages/notifications:send").post({
        contentType: "application/json",
        body: {
          channelRegistrationId,
          to: [recipient],
          kind: "template",
          template
        }
      });

      return normalizeSendResult(result);
    }
  };
}

function createAcsWhatsAppMessagingAdapterFromEnvironment(env = process.env) {
  return createAcsWhatsAppMessagingAdapter({
    connectionString: env.COMMUNICATION_SERVICES_CONNECTION_STRING,
    channelRegistrationId: env.WHATSAPP_CHANNEL_ID,
    templateName: env.ASIS_OTP_TEMPLATE_NAME,
    templateLanguage: env.ASIS_OTP_TEMPLATE_LANGUAGE,
    env
  });
}

module.exports = {
  buildOtpAuthenticationTemplate,
  extractMessageId,
  createAcsMessagesClient,
  createAcsWhatsAppMessagingAdapter,
  createAcsWhatsAppMessagingAdapterFromEnvironment
};
