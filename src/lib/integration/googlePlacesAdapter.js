"use strict";

const { searchPlaces } = require("../localSearchProvider");

const GOOGLE_PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const BUSINESS_LOOKUP_FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.currentOpeningHours",
  "places.regularOpeningHours"
].join(",");

function sanitizeStatusText(value) {
  const normalized = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 80);
  const allowed = new Set([
    "OK",
    "Bad Request",
    "Unauthorized",
    "Forbidden",
    "Not Found",
    "Too Many Requests",
    "Internal Server Error",
    "Bad Gateway",
    "Service Unavailable",
    "Gateway Timeout"
  ]);
  return allowed.has(normalized) ? normalized : null;
}

function createGooglePlacesRuntimeAdapter(options = {}) {
  const apiKey = options.apiKey;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!apiKey || typeof fetchImpl !== "function") {
    throw new Error("Google Places adapter settings are incomplete.");
  }

  return {
    adapterType: "google_places_text_search",
    async searchBusiness(input = {}) {
      const response = await fetchImpl(GOOGLE_PLACES_TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": BUSINESS_LOOKUP_FIELD_MASK
        },
        body: JSON.stringify({
          textQuery: input.query,
          languageCode: input.languageCode || "es",
          regionCode: input.regionCode || "CR",
          pageSize: input.pageSize || 1
        })
      });
      const json = await response.json().catch(() => ({}));
      return {
        ok: response.ok === true,
        status: Number(response.status || 0),
        statusText: sanitizeStatusText(response.statusText),
        hasError: Boolean(json && json.error),
        places: json && Array.isArray(json.places) ? json.places : []
      };
    }
  };
}

function createGooglePlacesAdapter(options = {}) {
  const search = options.search || searchPlaces;
  return {
    adapterType: "google_places",
    async probe(input = {}) {
      const result = await search({
        query: input.query || "cafetería",
        locationText: input.locationText || "San José, Costa Rica",
        limit: 1
      });
      return {
        ok: Boolean(result && result.ok === true && Array.isArray(result.results)),
        resultCount: result && Array.isArray(result.results) ? result.results.length : 0
      };
    }
  };
}

module.exports = {
  GOOGLE_PLACES_TEXT_SEARCH_URL,
  BUSINESS_LOOKUP_FIELD_MASK,
  createGooglePlacesRuntimeAdapter,
  createGooglePlacesAdapter
};
