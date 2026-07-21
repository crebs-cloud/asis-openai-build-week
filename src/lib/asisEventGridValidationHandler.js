"use strict";

function handleEventGridValidation(event = {}, context = console) {
  if (context && typeof context.log === "function") {
    context.log("Event Grid validation received.");
  }

  return {
    status: 200,
    jsonBody: {
      validationResponse: event.data && event.data.validationCode
    }
  };
}

module.exports = { handleEventGridValidation };
