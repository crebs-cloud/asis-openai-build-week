"use strict";

const EVENT_ROUTES = Object.freeze({
  "Microsoft.EventGrid.SubscriptionValidationEvent": "subscription_validation",
  "Microsoft.Communication.AdvancedMessageDeliveryStatusUpdated": "delivery_status",
  "Microsoft.Communication.AdvancedMessageReceived": "inbound_message"
});

function routeWebhookEvent(event) {
  return {
    kind: EVENT_ROUTES[event && event.eventType] || "ignored",
    event
  };
}

module.exports = { EVENT_ROUTES, routeWebhookEvent };
