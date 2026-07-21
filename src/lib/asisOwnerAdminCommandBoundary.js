"use strict";

const GATE_NAME = "asis_owner_admin_command_boundary";

const CONTACT_LIST_PHRASES = Object.freeze([
  "dame la lista de contactos",
  "lista de contactos",
  "listar contactos",
  "ver contactos",
  "dame los contactos",
  "muestrame contactos",
  "contactos db",
  "contactos base de datos",
  "contactos de la base de datos",
  "admin contactos"
]);

const CONTACT_EXPORT_PHRASES = Object.freeze([
  "exporta contactos",
  "exportar contactos",
  "dame telefonos",
  "dame emails",
  "dame correos",
  "descarga contactos"
]);

const ADMIN_DATA_PHRASES = Object.freeze([
  "dame datos de contactos",
  "dame registros de contactos",
  "dame clientes de la base",
  "dame usuarios de la base",
  "dame la base de contactos"
]);

const MAILBOX_PHRASES = Object.freeze([
  "dame mis ultimos correos",
  "leer correos",
  "ultimos emails",
  "inbox",
  "bandeja de entrada"
]);

function normalizeOwnerAdminCommandText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?¡!.,;:()[\]{}"'`´]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesPhrase(normalizedText, phrases) {
  return phrases.some((phrase) => normalizedText.includes(phrase));
}

function classifyOwnerAdminCommand(text) {
  const value = normalizeOwnerAdminCommandText(text);

  if (!value) {
    return {
      handled: false,
      gateName: GATE_NAME,
      commandType: "unknown"
    };
  }

  if (
    includesPhrase(value, MAILBOX_PHRASES) ||
    /\b(leeme|leer)\s+(mis\s+)?(ultimos\s+)?(correos|emails|inbox)\b/.test(value) ||
    /\b(dame|mostrar|muestrame)\s+mis\s+(ultimos\s+)?(correos|emails)\b/.test(value) ||
    /\b(ultimos\s+emails|ultimos\s+correos|outlook|graph|inbox|bandeja de entrada)\b/.test(value)
  ) {
    return {
      handled: true,
      gateName: GATE_NAME,
      commandType: "mailbox_read"
    };
  }

  if (
    /\b(elimina|eliminar|borra|borrar|delete|remove)\s+(contacto|contactos|contact|contacts)\b/.test(value) ||
    /\b(actualiza|actualizar|modifica|modificar|cambia|cambiar|update|modify|change)\s+(contacto|contactos|contact|contacts)\b/.test(value)
  ) {
    return {
      handled: true,
      gateName: GATE_NAME,
      commandType: "contact_mutation"
    };
  }

  if (
    includesPhrase(value, ADMIN_DATA_PHRASES) ||
    /\b(datos|registros|clientes|usuarios)\s+de\s+(la\s+)?base\b/.test(value) ||
    /\bbase\s+de\s+contactos\b/.test(value)
  ) {
    return {
      handled: true,
      gateName: GATE_NAME,
      commandType: "admin_data"
    };
  }

  if (
    includesPhrase(value, CONTACT_EXPORT_PHRASES) ||
    /\b(exporta|exportar|descarga|descargar)\s+contactos\b/.test(value) ||
    /\bdame\s+(telefonos|emails|correos)\b/.test(value) ||
    /\b(contacto|ver contacto|detalle contacto)\s+\d+\b/.test(value)
  ) {
    return {
      handled: true,
      gateName: GATE_NAME,
      commandType: "contact_export"
    };
  }

  if (
    includesPhrase(value, CONTACT_LIST_PHRASES) ||
    /\b(lista|listar|ver|dame|mostrar|muestrame)\s+(la\s+lista\s+de\s+)?(los\s+)?contactos\b/.test(value) ||
    /\badmin\s+contactos\b/.test(value)
  ) {
    return {
      handled: true,
      gateName: GATE_NAME,
      commandType: "contact_list"
    };
  }

  return {
    handled: false,
    gateName: GATE_NAME,
    commandType: "unknown"
  };
}

function isOwnerAdminContactCommand(text) {
  const result = classifyOwnerAdminCommand(text);
  return result.handled === true && [
    "contact_list",
    "contact_export",
    "contact_mutation",
    "admin_data"
  ].includes(result.commandType);
}

function isOwnerAdminMailboxCommand(text) {
  const result = classifyOwnerAdminCommand(text);
  return result.handled === true && result.commandType === "mailbox_read";
}

function buildOwnerAdminDeferredReply({ ownerDetected, commandType } = {}) {
  if (!ownerDetected) {
    return "Esa funcion no esta disponible para este contacto.";
  }

  if (commandType === "mailbox_read") {
    return "Owner, mailbox access is not authorized. I cannot read or share email from WhatsApp.";
  }

  return "Owner, this administrative function is disabled by policy. I cannot list, export, delete, or modify contacts from WhatsApp.";
}

function evaluateOwnerAdminCommandBoundary({ text, ownerDetected } = {}) {
  const classification = classifyOwnerAdminCommand(text);

  if (!classification.handled) {
    return {
      handled: false,
      gateName: GATE_NAME,
      commandType: "unknown",
      ownerDetected: Boolean(ownerDetected),
      ownerControlDeferred: true,
      dataAccessAllowed: false,
      mutationAllowed: false,
      googlePlacesAllowed: false,
      openAiFallbackAllowed: false,
      cosmosReadAllowed: false,
      cosmosWriteAllowed: false,
      mailboxReadAllowed: false,
      graphSubscriptionByThisPhase: false
    };
  }

  return {
    handled: true,
    gateName: GATE_NAME,
    commandType: classification.commandType,
    ownerDetected: Boolean(ownerDetected),
    ownerControlDeferred: true,
    dataAccessAllowed: false,
    mutationAllowed: false,
    googlePlacesAllowed: false,
    openAiFallbackAllowed: false,
    cosmosReadAllowed: false,
    cosmosWriteAllowed: false,
    mailboxReadAllowed: false,
    graphSubscriptionByThisPhase: false,
    reply: buildOwnerAdminDeferredReply({
      ownerDetected: Boolean(ownerDetected),
      commandType: classification.commandType
    })
  };
}

module.exports = {
  GATE_NAME,
  normalizeOwnerAdminCommandText,
  classifyOwnerAdminCommand,
  isOwnerAdminContactCommand,
  isOwnerAdminMailboxCommand,
  buildOwnerAdminDeferredReply,
  evaluateOwnerAdminCommandBoundary
};
