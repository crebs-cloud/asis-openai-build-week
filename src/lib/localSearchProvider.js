'use strict';

/**
 * CREBS WhatsApp AI Orchestrator / Asis
 * Fase 5A.2 - Local Search Provider Abstraction
 *
 * This module provides a provider-neutral local search interface:
 *   searchPlaces(input)
 *
 * Current provider:
 *   - Google Places API (New), Text Search endpoint
 *
 * Safety rules:
 *   - Do not invent merchants.
 *   - Do not invent phone numbers.
 *   - Do not invent schedules.
 *   - Do not claim delivery/express availability unless provider data says so.
 *   - If provider is missing or fails, return a clear structured error.
 */

const GOOGLE_PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function uniqueValues(values) {
  const output = [];
  const seen = new Set();

  for (const value of values || []) {
    const normalized = normalizeText(value);
    const key = normalized.toLowerCase();

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function ensureArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean).map(normalizeText).filter(Boolean);
  }

  return [normalizeText(value)].filter(Boolean);
}

function buildTextQuery(input) {
  const category = normalizeText(input && input.category);
  const query = normalizeText(input && input.query);
  const locationText = normalizeText(input && input.locationText);
  const referencePlace = normalizeText(input && input.referencePlace);
  const preferences = ensureArray(input && input.preferences);

  const parts = [];

  if (query) {
    parts.push(query);
  } else {
    if (category) {
      parts.push(category);
    }

    if (preferences.length) {
      parts.push(preferences.join(' '));
    }

    if (referencePlace) {
      parts.push(`similar a ${referencePlace}`);
    }
  }

  if (locationText) {
    parts.push(`en ${locationText}`);
  }

  if (!parts.join(' ').toLowerCase().includes('costa rica')) {
    parts.push('Costa Rica');
  }

  return normalizeText(parts.join(' '));
}

function mapGooglePlace(place) {
  const displayName =
    place &&
    place.displayName &&
    place.displayName.text
      ? normalizeText(place.displayName.text)
      : null;

  return {
    source: 'google_places',
    providerId: place.id || null,
    placeResourceName: place.name || null,

    name: displayName,
    formattedAddress: place.formattedAddress || null,
    shortFormattedAddress: place.shortFormattedAddress || null,
    googleMapsUri: place.googleMapsUri || null,
    websiteUri: place.websiteUri || null,

    nationalPhoneNumber: place.nationalPhoneNumber || null,
    internationalPhoneNumber: place.internationalPhoneNumber || null,

    rating: typeof place.rating === 'number' ? place.rating : null,
    userRatingCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    priceLevel: place.priceLevel || null,
    businessStatus: place.businessStatus || null,

    primaryType: place.primaryType || null,
    types: Array.isArray(place.types) ? place.types : [],
    location: place.location || null,

    takeout: typeof place.takeout === 'boolean' ? place.takeout : null,
    delivery: typeof place.delivery === 'boolean' ? place.delivery : null,
    dineIn: typeof place.dineIn === 'boolean' ? place.dineIn : null
  };
}

function scoreResult(result, input) {
  let score = 0;

  const preferenceText = normalizeLower(ensureArray(input && input.preferences).join(' '));
  const categoryText = normalizeLower(input && input.category);
  const resultName = normalizeLower(result && result.name);
  const resultAddress = normalizeLower(
    (result && result.shortFormattedAddress) ||
    (result && result.formattedAddress) ||
    ''
  );

  if (result && result.name) {
    score += 20;
  }

  if (result && (result.shortFormattedAddress || result.formattedAddress)) {
    score += 10;
  }

  if (result && result.googleMapsUri) {
    score += 5;
  }

  if (result && typeof result.rating === 'number') {
    score += result.rating;
  }

  if (result && typeof result.userRatingCount === 'number') {
    score += Math.min(result.userRatingCount / 100, 6);
  }

  if (
    preferenceText.includes('express') ||
    preferenceText.includes('delivery') ||
    preferenceText.includes('pedido') ||
    preferenceText.includes('servicio express')
  ) {
    if (result.delivery === true) {
      score += 12;
    }

    if (result.takeout === true) {
      score += 5;
    }
  }

  if (
    preferenceText.includes('llevar') ||
    preferenceText.includes('takeout') ||
    preferenceText.includes('para llevar')
  ) {
    if (result.takeout === true) {
      score += 10;
    }
  }

  if (
    preferenceText.includes('calidad') ||
    preferenceText.includes('mejor') ||
    preferenceText.includes('recomendado')
  ) {
    if (typeof result.rating === 'number') {
      score += result.rating * 2;
    }

    if (typeof result.userRatingCount === 'number') {
      score += Math.min(result.userRatingCount / 50, 8);
    }
  }

  if (categoryText && resultName.includes(categoryText)) {
    score += 4;
  }

  if (resultAddress.includes('heredia')) {
    score += 2;
  }

  return Number(score.toFixed(2));
}

function validateSearchInput(input) {
  const textQuery = buildTextQuery(input || {});

  if (!textQuery) {
    return {
      ok: false,
      reason: 'missing_search_query',
      query: ''
    };
  }

  return {
    ok: true,
    query: textQuery
  };
}

async function searchGooglePlaces(input) {
  const validation = validateSearchInput(input);

  if (!validation.ok) {
    return {
      ok: false,
      provider: 'google',
      reason: validation.reason,
      query: validation.query,
      results: []
    };
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      provider: 'google',
      reason: 'missing_google_places_api_key',
      query: validation.query,
      results: []
    };
  }

  if (typeof fetch !== 'function') {
    return {
      ok: false,
      provider: 'google',
      reason: 'fetch_not_available_in_node_runtime',
      query: validation.query,
      results: []
    };
  }

  const languageCode = process.env.LOCAL_SEARCH_DEFAULT_LANGUAGE || 'es';
  const regionCode = process.env.LOCAL_SEARCH_DEFAULT_COUNTRY || 'CR';
  const limit = Math.max(1, Math.min(Number(input && input.limit ? input.limit : 5), 10));

  const requestBody = {
    textQuery: validation.query,
    languageCode,
    regionCode,
    maxResultCount: limit
  };

  const fieldMask = [
    'places.id',
    'places.name',
    'places.displayName',
    'places.formattedAddress',
    'places.shortFormattedAddress',
    'places.googleMapsUri',
    'places.websiteUri',
    'places.businessStatus',
    'places.primaryType',
    'places.types',
    'places.location',
    'places.rating',
    'places.userRatingCount',
    'places.priceLevel',
    'places.nationalPhoneNumber',
    'places.internationalPhoneNumber',
    'places.takeout',
    'places.delivery',
    'places.dineIn'
  ].join(',');

  let response;
  let raw;

  try {
    response = await fetch(GOOGLE_PLACES_TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask
      },
      body: JSON.stringify(requestBody)
    });

    raw = await response.json().catch(() => ({}));
  } catch (error) {
    return {
      ok: false,
      provider: 'google',
      reason: 'google_places_request_failed',
      query: validation.query,
      error: error && error.message ? error.message : String(error),
      results: []
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      provider: 'google',
      reason: 'google_places_error',
      status: response.status,
      query: validation.query,
      error:
        raw &&
        raw.error &&
        raw.error.message
          ? raw.error.message
          : 'Unknown Google Places API error',
      results: []
    };
  }

  const mapped = Array.isArray(raw.places)
    ? raw.places.map(mapGooglePlace).filter(item => item && item.name)
    : [];

  const ranked = mapped
    .map(item => ({
      ...item,
      score: scoreResult(item, input || {})
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(limit, 5));

  return {
    ok: true,
    provider: 'google',
    query: validation.query,
    resultCount: ranked.length,
    results: ranked
  };
}

async function searchPlaces(input) {
  const provider = process.env.LOCAL_SEARCH_PROVIDER || 'google';

  if (process.env.LOCAL_SEARCH_ENABLED !== 'true') {
    return {
      ok: false,
      provider,
      reason: 'local_search_disabled',
      query: buildTextQuery(input || {}),
      results: []
    };
  }

  if (provider === 'google') {
    return searchGooglePlaces(input || {});
  }

  return {
    ok: false,
    provider,
    reason: 'unsupported_local_search_provider',
    query: buildTextQuery(input || {}),
    results: []
  };
}

function formatAvailabilityFlags(place) {
  const flags = [];

  if (place.delivery === true) {
    flags.push('delivery indicado por Google');
  }

  if (place.takeout === true) {
    flags.push('para llevar indicado por Google');
  }

  if (place.dineIn === true) {
    flags.push('consumo en el lugar indicado por Google');
  }

  return flags;
}

function formatPlaceForWhatsApp(place, index) {
  const lines = [];

  const name = place.name || 'Comercio sin nombre disponible';
  const address =
    place.shortFormattedAddress ||
    place.formattedAddress ||
    'dirección no disponible';

  const phone =
    place.nationalPhoneNumber ||
    place.internationalPhoneNumber ||
    null;

  const rating =
    typeof place.rating === 'number'
      ? ` | ⭐ ${place.rating}${place.userRatingCount ? ` (${place.userRatingCount})` : ''}`
      : '';

  lines.push(`${index + 1}. ${name}${rating}`);
  lines.push(address);

  if (phone) {
    lines.push(`Tel: ${phone}`);
  }

  const availability = formatAvailabilityFlags(place);

  if (availability.length) {
    lines.push(availability.join(', '));
  }

  if (place.googleMapsUri) {
    lines.push(place.googleMapsUri);
  }

  return lines.join('\n');
}

function formatSearchResultsForWhatsApp(searchResult, options) {
  const query = searchResult && searchResult.query ? searchResult.query : 'tu búsqueda';

  if (!searchResult || !searchResult.ok) {
    const reason = searchResult && searchResult.reason ? searchResult.reason : 'unknown_error';

    if (reason === 'missing_google_places_api_key') {
      return 'Asis todavía no tiene configurada la llave de Google Places para buscar comercios reales.';
    }

    if (reason === 'local_search_disabled') {
      return 'Asis todavía no tiene habilitada la búsqueda local en tiempo real.';
    }

    return `Asis intentó buscar comercios reales, pero la búsqueda falló. Motivo técnico: ${reason}.`;
  }

  if (!Array.isArray(searchResult.results) || searchResult.results.length === 0) {
    return `Asis buscó opciones reales para "${query}", pero no encontró resultados confiables.`;
  }

  const maxResults = Math.max(1, Math.min(Number(options && options.maxResults ? options.maxResults : 3), 5));
  const selected = searchResult.results.slice(0, maxResults);

  const lines = [];

  lines.push(`Encontré estas opciones reales para "${query}":`);
  lines.push('');

  for (let i = 0; i < selected.length; i++) {
    lines.push(formatPlaceForWhatsApp(selected[i], i));
    lines.push('');
  }

  lines.push('Nota: puedo mostrar opciones reales, pero no confirmo precios, tiempos de entrega ni disponibilidad exacta sin validar con el comercio.');

  return lines.join('\n').trim();
}

module.exports = {
  searchPlaces,
  buildTextQuery,
  formatSearchResultsForWhatsApp,
  formatPlaceForWhatsApp
};
