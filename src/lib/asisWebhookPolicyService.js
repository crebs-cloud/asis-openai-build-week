"use strict";

const { evaluateOwnerAdminCommandBoundary } = require("./asisOwnerAdminCommandBoundary");

function evaluateInboundPolicy({ text, ownerDetected } = {}) {
  const ownerAdminBoundary = evaluateOwnerAdminCommandBoundary({ text, ownerDetected });
  return {
    handled: ownerAdminBoundary && ownerAdminBoundary.handled === true,
    ownerAdminBoundary
  };
}

module.exports = { evaluateInboundPolicy };
