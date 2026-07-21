"use strict";

const SESSION_COOKIE_NAME = "crebs_asis_session";

function getHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key] || "") : "";
}

function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry !== "*");
}

function parseCookies(value) {
  return Object.fromEntries(
    String(value || "")
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const index = entry.indexOf("=");
        if (index < 1) return [entry, ""];
        return [entry.slice(0, index), decodeURIComponent(entry.slice(index + 1))];
      })
  );
}

function getSourceIp(request) {
  return getHeader(request && request.headers, "x-azure-clientip")
    || getHeader(request && request.headers, "x-forwarded-for").split(",")[0].trim()
    || "unknown";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    Vary: "Origin"
  };
}

function jsonResponse(status, body, origin, extraHeaders = {}) {
  return {
    status,
    headers: { ...corsHeaders(origin), ...extraHeaders },
    jsonBody: body
  };
}

function originDecision(request, allowedOrigins) {
  const origin = getHeader(request && request.headers, "origin");
  return {
    origin,
    allowed: Boolean(origin && allowedOrigins.includes(origin))
  };
}

function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/api/asis/otp; HttpOnly; Secure; SameSite=Strict`;
}

function createOtpHttpHandlers(options = {}) {
  const allowedOrigins = options.allowedOrigins || parseAllowedOrigins(process.env.ASIS_OTP_ALLOWED_ORIGINS);
  const serviceFactory = options.serviceFactory;
  if (typeof serviceFactory !== "function") {
    throw new Error("OTP HTTP handlers require an application service factory.");
  }

  async function readJson(request) {
    try {
      return await request.json();
    } catch {
      return null;
    }
  }

  async function guard(request) {
    const decision = originDecision(request, allowedOrigins);
    if (!decision.allowed) {
      return { response: jsonResponse(403, { error: "origin_rejected" }, "null") };
    }
    if (String(request.method || "").toUpperCase() === "OPTIONS") {
      return {
        response: {
          status: 204,
          headers: corsHeaders(decision.origin)
        }
      };
    }
    return decision;
  }

  async function createChallenge(request, context = console) {
    const decision = await guard(request);
    if (decision.response) return decision.response;
    const body = await readJson(request);
    if (!body) return jsonResponse(400, { error: "invalid_request" }, decision.origin);

    try {
      const result = await serviceFactory().requestChallenge({
        phone: body.phone,
        clientSessionId: body.client_session_id,
        consent: body.consent,
        sourceIp: getSourceIp(request)
      });
      const headers = result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : {};
      if (!result.ok) return jsonResponse(result.status, { error: result.code }, decision.origin, headers);
      return jsonResponse(202, {
        challenge_id: result.challengeId,
        masked_destination: result.maskedDestination,
        expires_in_seconds: result.expiresInSeconds,
        resend_after_seconds: result.resendAfterSeconds
      }, decision.origin);
    } catch (error) {
      if (context && typeof context.error === "function") context.error("ASIS_OTP_CREATE_FAILED");
      return jsonResponse(500, { error: "unexpected_failure" }, decision.origin);
    }
  }

  async function verifyChallenge(request, context = console) {
    const decision = await guard(request);
    if (decision.response) return decision.response;
    const body = await readJson(request);
    if (!body) return jsonResponse(400, { error: "invalid_request" }, decision.origin);

    try {
      const service = serviceFactory();
      const result = await service.verifyChallenge({
        challengeId: body.challenge_id,
        clientSessionId: body.client_session_id,
        code: body.code
      });
      if (!result.ok) return jsonResponse(result.status, { error: result.code }, decision.origin);
      return jsonResponse(200, {
        verified: true,
        session_expires_at: result.sessionExpiresAt
      }, decision.origin, {
        "Set-Cookie": sessionCookie(result.sessionToken, service.policy.sessionTtlSeconds)
      });
    } catch (error) {
      if (context && typeof context.error === "function") context.error("ASIS_OTP_VERIFY_FAILED");
      return jsonResponse(500, { error: "unexpected_failure" }, decision.origin);
    }
  }

  async function validateSession(request, context = console) {
    const decision = await guard(request);
    if (decision.response) return decision.response;
    const body = await readJson(request);
    if (!body) return jsonResponse(400, { error: "invalid_request" }, decision.origin);
    const cookies = parseCookies(getHeader(request.headers, "cookie"));

    try {
      const result = await serviceFactory().validateSession({
        challengeId: body.challenge_id,
        clientSessionId: body.client_session_id,
        sessionToken: cookies[SESSION_COOKIE_NAME]
      });
      if (!result.ok) return jsonResponse(result.status, { error: result.code }, decision.origin);
      return jsonResponse(200, {
        valid: true,
        session_expires_at: result.sessionExpiresAt
      }, decision.origin);
    } catch (error) {
      if (context && typeof context.error === "function") context.error("ASIS_OTP_SESSION_VALIDATE_FAILED");
      return jsonResponse(500, { error: "unexpected_failure" }, decision.origin);
    }
  }

  return { createChallenge, verifyChallenge, validateSession };
}

function registerAsisOtpApi(app, options = {}) {
  const handlers = createOtpHttpHandlers(options);
  app.http("asisOtpChallenges", {
    methods: ["POST", "OPTIONS"],
    authLevel: "anonymous",
    route: "asis/otp/challenges",
    handler: handlers.createChallenge
  });
  app.http("asisOtpVerifications", {
    methods: ["POST", "OPTIONS"],
    authLevel: "anonymous",
    route: "asis/otp/verifications",
    handler: handlers.verifyChallenge
  });
  app.http("asisOtpSessionValidation", {
    methods: ["POST", "OPTIONS"],
    authLevel: "anonymous",
    route: "asis/otp/sessions/validate",
    handler: handlers.validateSession
  });
  return handlers;
}

module.exports = {
  SESSION_COOKIE_NAME,
  parseAllowedOrigins,
  parseCookies,
  createOtpHttpHandlers,
  registerAsisOtpApi
};
