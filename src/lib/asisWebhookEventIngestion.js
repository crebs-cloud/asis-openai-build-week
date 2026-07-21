"use strict";

async function ingestWebhookRequest(request) {
  try {
    const body = await request.json();
    const events = Array.isArray(body) ? body : [body];
    if (!events.length || events.some((event) => !event || typeof event !== "object")) {
      return { ok: false, response: { status: 400, jsonBody: { error: "Invalid event payload" } } };
    }
    return { ok: true, events };
  } catch {
    return { ok: false, response: { status: 400, jsonBody: { error: "Invalid JSON" } } };
  }
}

module.exports = { ingestWebhookRequest };
