"use strict";

const ADVANCED_TECHNICAL_PATTERNS = [
  /\b(arquitectura|architecture|architectural|dise(?:ñ|n)o de sistemas?|system design)\b/i,
  /\b(ciberseguridad|cybersecurity|threat model|modelo de amenazas|zero trust|vulnerabil(?:idad|ity)|incident response)\b/i,
  /\b(root cause|causa ra(?:í|i)z|stack trace|debug(?:ging)?|depuraci(?:ó|o)n)\b/i,
  /\b(migraci(?:ó|o)n|migration|modernizaci(?:ó|o)n|modernization)\b.*\b(azure|cloud|nube|database|base de datos|oracle|sql|cosmos)\b/i,
  /\b(optimizaci(?:ó|o)n|optimization|performance|rendimiento)\b.*\b(database|base de datos|sql|cosmos|api|sistema|system)\b/i,
  /\b(code review|revisi(?:ó|o)n de c(?:ó|o)digo|refactor(?:ing|izaci(?:ó|o)n)?)\b/i
];

function normalizeDeployment(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function isEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function requiresAdvancedModel(text) {
  const normalized = String(text || "").trim();
  return normalized.length > 0 &&
    ADVANCED_TECHNICAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function selectOpenAiDeployment(options = {}) {
  const generalDeployment =
    normalizeDeployment(options.generalDeployment) ||
    normalizeDeployment(options.legacyDeployment);
  const advancedDeployment = normalizeDeployment(options.advancedDeployment);
  const routingEnabled = isEnabled(options.routingEnabled);

  if (!generalDeployment) {
    return {
      configured: false,
      route: "unavailable",
      deployment: null,
      reason: "general_deployment_missing",
      routingEnabled
    };
  }

  if (!routingEnabled) {
    return {
      configured: true,
      route: "general",
      deployment: generalDeployment,
      reason: "routing_disabled",
      routingEnabled
    };
  }

  if (!advancedDeployment || advancedDeployment === generalDeployment) {
    return {
      configured: true,
      route: "general",
      deployment: generalDeployment,
      reason: "advanced_deployment_unavailable",
      routingEnabled
    };
  }

  if (requiresAdvancedModel(options.text)) {
    return {
      configured: true,
      route: "advanced",
      deployment: advancedDeployment,
      reason: "explicit_advanced_technical_intent",
      routingEnabled
    };
  }

  return {
    configured: true,
    route: "general",
    deployment: generalDeployment,
    reason: "default_general_route",
    routingEnabled
  };
}

module.exports = {
  ADVANCED_TECHNICAL_PATTERNS,
  isEnabled,
  requiresAdvancedModel,
  selectOpenAiDeployment
};
