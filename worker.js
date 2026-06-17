
const FOOD_TERMS = [
  'food', 'meal', 'meals', 'grapefruit', 'grapefruit juice', 'high fat', 'high-fat', 'dairy', 'milk', 'calcium', 'magnesium', 'aluminum', 'iron', 'zinc', 'antacid', 'supplement', 'tyramine'
];
const MINERAL_TERMS = new Set(['calcium', 'magnesium', 'aluminum', 'iron', 'zinc']);
const MINERAL_CONTEXT_REGEX = /(?:diet|food|meal|milk|dairy|supplement|antacid|carbonate|absorption|separate|administer|coadminister|take|taking|bind|reduce)/i;

export function makeBoundaryTermRegex(term) {
  const escapedParts = String(term).toLowerCase().split(/[-\s/]+/).filter(Boolean).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = escapedParts.join('[\\s\\-\\u2010-\\u2015/]+');
  return new RegExp(`(^|[^a-z0-9])${pattern}(?=$|[^a-z0-9])`, 'i');
}

export function findValidatedTerms(text) {
  const value = String(text || '');
  const found = [];
  const seen = new Set();
  for (const term of FOOD_TERMS) {
    const canonical = term.replace(/-/g, ' ');
    if (seen.has(canonical)) continue;
    if (!makeBoundaryTermRegex(term).test(value)) continue;
    if (MINERAL_TERMS.has(canonical)) {
      const mineralRegex = makeBoundaryTermRegex(term);
      const match = mineralRegex.exec(value);
      const context = match ? value.slice(Math.max(0, match.index - 80), match.index + 120) : value;
      if (/calcium\s+channel/i.test(context) || !MINERAL_CONTEXT_REGEX.test(context)) continue;
    }
    seen.add(canonical);
    found.push({ term: canonical });
  }
  return found;
}

const RECENT_SEARCHES_KEY = 'recent-searches:cards:v1';
const DEFAULT_RECENT_LIMIT = 25;
const MAX_RECENT_LIMIT = 25;
const ALLOWED_ORIGINS = new Set([
  'https://foodmedchecker.com',
  'https://www.foodmedchecker.com',
  'http://localhost:8787',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
]);

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://foodmedchecker.com';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function jsonResponse(request, body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
      ...(init.headers || {})
    }
  });
}

function optionsResponse(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function normalizeLimit(value) {
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_RECENT_LIMIT;
  return Math.min(limit, MAX_RECENT_LIMIT);
}

function truncateText(value, maxLength) {
  return String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeSlug(value, fallbackName) {
  const source = value || fallbackName || '';
  return String(source)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'medication-check';
}

function normalizeBadge(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const badges = {
    'no special food issue found': 'No special food issue found',
    'follow label directions': 'Follow label directions',
    'use caution': 'Use caution',
    'avoid/separate': 'Avoid/Separate',
    'avoid / separate': 'Avoid/Separate',
    'avoid separate': 'Avoid/Separate'
  };
  return badges[normalized] || 'Follow label directions';
}

function normalizeDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

function normalizeCard(card) {
  const drugName = truncateText(card && card.drugName, 120);
  const quickAnswer = truncateText(card && card.quickAnswer, 500);
  if (!drugName || !quickAnswer) return null;
  return {
    slug: normalizeSlug(card && card.slug, drugName),
    drugName,
    quickAnswer,
    foodSafetyBadge: normalizeBadge(card && card.foodSafetyBadge),
    searchedCount: Math.max(1, Number.parseInt(card && card.searchedCount, 10) || 1),
    lastSearchedAt: normalizeDate(card && card.lastSearchedAt)
  };
}

function sortCards(cards) {
  return cards.sort((a, b) => Date.parse(b.lastSearchedAt) - Date.parse(a.lastSearchedAt));
}

async function readRecentCards(env) {
  if (!env.RECENT_SEARCHES_KV) return [];
  const cards = await env.RECENT_SEARCHES_KV.get(RECENT_SEARCHES_KEY, { type: 'json' });
  return Array.isArray(cards) ? cards.map(normalizeCard).filter(Boolean) : [];
}

async function handleRecentSearches(request, env) {
  if (request.method === 'OPTIONS') return optionsResponse(request);

  const url = new URL(request.url);
  const limit = normalizeLimit(url.searchParams.get('limit'));

  if (request.method === 'GET') {
    const cards = sortCards(await readRecentCards(env)).slice(0, limit);
    return jsonResponse(request, { success: true, cards }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (request.method === 'POST') {
    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return jsonResponse(request, { success: false, error: 'Invalid JSON body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }

    const card = normalizeCard(payload && payload.card);
    if (!card) {
      const cards = sortCards(await readRecentCards(env)).slice(0, limit);
      return jsonResponse(request, { success: true, cards }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const saveLimit = normalizeLimit(payload && payload.limit);
    const existingCards = await readRecentCards(env);
    const existing = existingCards.find((item) => item.slug === card.slug);
    const withoutCurrent = existingCards.filter((item) => item.slug !== card.slug);
    const savedCard = existing ? {
      ...existing,
      drugName: card.drugName,
      quickAnswer: card.quickAnswer,
      foodSafetyBadge: card.foodSafetyBadge,
      searchedCount: (Number.parseInt(existing.searchedCount, 10) || 1) + 1,
      lastSearchedAt: card.lastSearchedAt
    } : card;

    const cards = sortCards([savedCard, ...withoutCurrent]).slice(0, saveLimit);
    if (env.RECENT_SEARCHES_KV) {
      await env.RECENT_SEARCHES_KV.put(RECENT_SEARCHES_KEY, JSON.stringify(cards));
    }
    return jsonResponse(request, { success: true, cards }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return jsonResponse(request, { success: false, error: 'Method not allowed' }, { status: 405 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/recent-searches') {
      return handleRecentSearches(request, env);
    }
    if (request.method === 'OPTIONS') {
      return optionsResponse(request);
    }
    return jsonResponse(request, { success: false, error: 'Not found' }, { status: 404 });
  }
};
