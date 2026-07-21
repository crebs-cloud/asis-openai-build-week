"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scryptAsync = promisify(crypto.scrypt);

function normalizeE164(value) {
  const trimmed = String(value || "").trim();
  const digits = trimmed.replace(/\D/g, "");
  const normalized = `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

function maskPhone(value) {
  const normalized = normalizeE164(value);
  if (!normalized) return null;
  return `${normalized.slice(0, 4)}••••${normalized.slice(-4)}`;
}

function requirePepper(value) {
  const pepper = String(value || "");
  if (pepper.length < 32) {
    throw new Error("OTP_HASH_PEPPER must contain at least 32 characters.");
  }
  return pepper;
}

function hashIdentifier(value, pepper) {
  return crypto
    .createHmac("sha256", requirePepper(pepper))
    .update(String(value || ""), "utf8")
    .digest("hex");
}

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function generateSalt() {
  return crypto.randomBytes(16).toString("hex");
}

async function hashOtp(code, salt, pepper) {
  if (!/^\d{6}$/.test(String(code || ""))) {
    throw new Error("OTP code must contain exactly six digits.");
  }
  const derived = await scryptAsync(`${requirePepper(pepper)}:${String(code)}`, String(salt), 32);
  return Buffer.from(derived).toString("hex");
}

function safeEqualHex(expected, actual) {
  try {
    const left = Buffer.from(String(expected || ""), "hex");
    const right = Buffer.from(String(actual || ""), "hex");
    return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

async function verifyOtp(code, salt, expectedHash, pepper) {
  if (!/^\d{6}$/.test(String(code || ""))) return false;
  const actualHash = await hashOtp(code, salt, pepper);
  return safeEqualHex(expectedHash, actualHash);
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

module.exports = {
  normalizeE164,
  maskPhone,
  requirePepper,
  hashIdentifier,
  generateOtp,
  generateSalt,
  hashOtp,
  verifyOtp,
  generateSessionToken,
  safeEqualHex
};
