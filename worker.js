
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

const RECENT_SEARCHES_KEY = 'recent-searches:cards:v2';
const DRUG_INDEX_KEY = 'drug:index:v1';
const DRUG_CARD_PREFIX = 'drug:card:';
const RECENT_SEARCHES_MAX = 25;
const DRUG_INDEX_MAX = 1000;
const DEFAULT_RECENT_LIMIT = RECENT_SEARCHES_MAX;
const MAX_RECENT_LIMIT = RECENT_SEARCHES_MAX;
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

function normalizeLimit(value, maxLimit = MAX_RECENT_LIMIT, defaultLimit = DEFAULT_RECENT_LIMIT) {
  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1) return defaultLimit;
  return Math.min(limit, maxLimit);
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

function compactSourceExcerpts(excerpts) {
  if (!Array.isArray(excerpts)) return [];
  return excerpts.slice(0, 8).map((excerpt) => ({
    sourceTitle: truncateText(excerpt && excerpt.sourceTitle, 180),
    section: truncateText(excerpt && excerpt.section, 120),
    text: truncateText((excerpt && (excerpt.text || excerpt.excerpt || excerpt.supportingExcerpt || excerpt.excerptText || excerpt.sourceText || excerpt.content)) || '', 1200),
    matchedTerms: Array.isArray(excerpt && excerpt.matchedTerms) ? excerpt.matchedTerms.slice(0, 12).map((term) => truncateText(term, 60)).filter(Boolean) : [],
    setId: truncateText(excerpt && excerpt.setId, 120),
    dailyMedUrl: truncateText(excerpt && (excerpt.dailyMedUrl || excerpt.sourceUrl || excerpt.url || excerpt.labelUrl || excerpt.link), 500)
  })).filter((excerpt) => excerpt.text || excerpt.sourceTitle || excerpt.setId || excerpt.dailyMedUrl);
}

function compactSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.slice(0, 12).map((source) => ({
    title: truncateText(source && source.title, 180),
    setId: truncateText(source && source.setId, 120),
    dailyMedUrl: truncateText(source && (source.dailyMedUrl || source.sourceUrl || source.url || source.labelUrl || source.link), 500),
    brandName: truncateText(source && source.brandName, 120),
    genericName: truncateText(source && source.genericName, 160),
    manufacturer: truncateText(source && source.manufacturer, 160),
    effectiveTime: truncateText(source && source.effectiveTime, 40)
  })).filter((source) => source.title || source.setId || source.dailyMedUrl);
}

function compactDrugSummary(drugSummary) {
  const medlinePlus = drugSummary && drugSummary.medlinePlus;
  if (!medlinePlus) return null;
  return {
    medlinePlus: {
      title: truncateText(medlinePlus.title || medlinePlus.name, 180),
      source: truncateText(medlinePlus.source || medlinePlus.attribution, 180),
      summary: truncateText(medlinePlus.summary || medlinePlus.description || medlinePlus.snippet, 1200),
      url: truncateText(medlinePlus.url || medlinePlus.link || medlinePlus.href, 500)
    }
  };
}

function normalizeRecentSearchCard(card) {
  const drugName = truncateText(card && card.drugName, 120);
  const quickAnswer = truncateText(card && card.quickAnswer, 500);
  if (!drugName || !quickAnswer) return null;
  const lastSearchedAt = normalizeDate(card && card.lastSearchedAt);
  return {
    slug: normalizeSlug(card && card.slug, drugName),
    drugName,
    quickAnswer,
    practicalTakeaway: truncateText(card && card.practicalTakeaway, 700),
    foodSafetyBadge: normalizeBadge(card && card.foodSafetyBadge),
    drugSummary: compactDrugSummary(card && card.drugSummary),
    sourceExcerpts: compactSourceExcerpts(card && card.sourceExcerpts),
    sources: compactSources(card && card.sources),
    searchedCount: Math.max(1, Number.parseInt(card && card.searchedCount, 10) || 1),
    firstSearchedAt: normalizeDate((card && card.firstSearchedAt) || lastSearchedAt),
    lastSearchedAt
  };
}

const normalizeCard = normalizeRecentSearchCard;

function sortCards(cards) {
  return cards.sort((a, b) => Date.parse(b.lastSearchedAt) - Date.parse(a.lastSearchedAt));
}

function missingRecentSearchesKvResponse(request) {
  return jsonResponse(request, {
    success: false,
    ok: false,
    error: 'RECENT_SEARCHES_KV binding is not configured.'
  }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
}

function requireRecentSearchesKv(request, env) {
  return env.RECENT_SEARCHES_KV ? null : missingRecentSearchesKvResponse(request);
}

async function readRecentSearchCards(env) {
  const cards = await env.RECENT_SEARCHES_KV.get(RECENT_SEARCHES_KEY, { type: 'json' });
  return Array.isArray(cards) ? cards.map(normalizeRecentSearchCard).filter(Boolean) : [];
}

async function writeRecentSearchCards(env, cards) {
  const normalized = sortCards((Array.isArray(cards) ? cards : []).map(normalizeRecentSearchCard).filter(Boolean)).slice(0, RECENT_SEARCHES_MAX);
  await env.RECENT_SEARCHES_KV.put(RECENT_SEARCHES_KEY, JSON.stringify(normalized));
  return normalized;
}

function mergeRecentSearchCards(existingCards, card, limit = RECENT_SEARCHES_MAX) {
  const normalizedCard = normalizeRecentSearchCard(card);
  if (!normalizedCard) return sortCards(existingCards.map(normalizeRecentSearchCard).filter(Boolean)).slice(0, limit);
  const existing = existingCards.map(normalizeRecentSearchCard).filter(Boolean).find((item) => item.slug === normalizedCard.slug);
  const withoutCurrent = existingCards.map(normalizeRecentSearchCard).filter(Boolean).filter((item) => item.slug !== normalizedCard.slug);
  const savedCard = existing ? {
    ...existing,
    drugName: normalizedCard.drugName,
    quickAnswer: normalizedCard.quickAnswer,
    practicalTakeaway: normalizedCard.practicalTakeaway,
    foodSafetyBadge: normalizedCard.foodSafetyBadge,
    searchedCount: Math.max(1, Number.parseInt(existing.searchedCount, 10) || 1) + Math.max(1, Number.parseInt(normalizedCard.searchedCount, 10) || 1),
    firstSearchedAt: existing.firstSearchedAt || normalizedCard.firstSearchedAt,
    lastSearchedAt: normalizedCard.lastSearchedAt
  } : normalizedCard;
  return sortCards([savedCard, ...withoutCurrent]).slice(0, limit);
}

const readRecentCards = readRecentSearchCards;


function shouldRecordDrugSearch(result) {
  return result
    && result.status === 200
    && result.payload
    && result.payload.success === true
    && result.payload.quickAnswer
    && result.payload.status !== 'no_results';
}

function normalizeDrugCardFromPayload(payload, searchedDrug) {
  if (!payload || payload.success !== true || payload.status === 'no_results' || !payload.quickAnswer) return null;
  const drugName = truncateText(payload.drug || payload.searchedDrug || (payload.aiSummary && payload.aiSummary.drugSearched) || searchedDrug, 120);
  if (!drugName) return null;
  return normalizeRecentSearchCard({
    slug: normalizeSlug(drugName),
    drugName,
    quickAnswer: payload.quickAnswer,
    practicalTakeaway: payload.practicalTakeaway,
    foodSafetyBadge: payload.foodSafetyBadge || (payload.aiSummary && payload.aiSummary.foodSafetyBadge),
    drugSummary: payload.drugSummary,
    sourceExcerpts: payload.sourceExcerpts,
    sources: payload.sources,
    searchedCount: 1,
    firstSearchedAt: new Date().toISOString(),
    lastSearchedAt: new Date().toISOString()
  });
}

async function readDrugIndex(env) {
  const index = await env.RECENT_SEARCHES_KV.get(DRUG_INDEX_KEY, { type: 'json' });
  return Array.isArray(index) ? index.map(normalizeRecentSearchCard).filter(Boolean) : [];
}

async function writeDrugIndex(env, cards) {
  const normalized = sortCards((Array.isArray(cards) ? cards : []).map(normalizeRecentSearchCard).filter(Boolean)).slice(0, DRUG_INDEX_MAX);
  await env.RECENT_SEARCHES_KV.put(DRUG_INDEX_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function recordDrugSearch(env, payload, searchedDrug) {
  if (!env.RECENT_SEARCHES_KV) throw new Error('RECENT_SEARCHES_KV binding is not configured.');
  const card = normalizeDrugCardFromPayload(payload, searchedDrug);
  if (!card) return null;

  const key = `${DRUG_CARD_PREFIX}${card.slug}`;
  const existing = normalizeRecentSearchCard(await env.RECENT_SEARCHES_KV.get(key, { type: 'json' }));
  const savedCard = existing ? {
    ...existing,
    drugName: card.drugName,
    quickAnswer: card.quickAnswer,
    practicalTakeaway: card.practicalTakeaway,
    foodSafetyBadge: card.foodSafetyBadge,
    drugSummary: card.drugSummary || existing.drugSummary,
    sourceExcerpts: card.sourceExcerpts && card.sourceExcerpts.length ? card.sourceExcerpts : existing.sourceExcerpts,
    sources: card.sources && card.sources.length ? card.sources : existing.sources,
    searchedCount: (Number.parseInt(existing.searchedCount, 10) || 1) + 1,
    firstSearchedAt: existing.firstSearchedAt || card.firstSearchedAt,
    lastSearchedAt: card.lastSearchedAt
  } : card;

  await env.RECENT_SEARCHES_KV.put(key, JSON.stringify(savedCard));

  const indexCards = await readDrugIndex(env);
  await writeDrugIndex(env, mergeRecentSearchCards(indexCards, { ...savedCard, searchedCount: 1 }, DRUG_INDEX_MAX));

  const recentCards = await readRecentSearchCards(env);
  await writeRecentSearchCards(env, mergeRecentSearchCards(recentCards, { ...savedCard, searchedCount: 1 }, RECENT_SEARCHES_MAX));

  return savedCard;
}

async function handleDrugs(request, env) {
  if (request.method === 'OPTIONS') return optionsResponse(request);
  const missingKv = requireRecentSearchesKv(request, env);
  if (missingKv) return missingKv;
  if (request.method !== 'GET') return jsonResponse(request, { success: false, ok: false, error: 'Method not allowed' }, { status: 405 });

  const url = new URL(request.url);
  const slug = url.pathname.replace(/^\/drugs\/?/, '').replace(/^\/+|\/+$/g, '');
  if (slug) {
    const card = normalizeRecentSearchCard(await env.RECENT_SEARCHES_KV.get(`${DRUG_CARD_PREFIX}${normalizeSlug(slug)}`, { type: 'json' }));
    if (!card) return jsonResponse(request, { success: false, ok: false, error: 'Drug check not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return jsonResponse(request, { success: true, ok: true, card }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const limit = normalizeLimit(url.searchParams.get('limit'), DRUG_INDEX_MAX, 250);
  const drugs = sortCards(await readDrugIndex(env)).slice(0, limit);
  return jsonResponse(request, { success: true, ok: true, drugs, cards: drugs }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function maybeRecordCheckResult(env, result, drug) {
  if (!shouldRecordDrugSearch(result)) return;
  try {
    await recordDrugSearch(env, result.payload, drug);
  } catch (error) {
    console.error('Unable to record drug search', error);
  }
}

async function handleRecentSearches(request, env) {
  if (request.method === 'OPTIONS') return optionsResponse(request);

  const url = new URL(request.url);
  const limit = normalizeLimit(url.searchParams.get('limit'));
  const missingKv = requireRecentSearchesKv(request, env);
  if (missingKv) return missingKv;

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

    const card = normalizeRecentSearchCard(payload && payload.card);
    if (!card) {
      const cards = sortCards(await readRecentCards(env)).slice(0, limit);
      return jsonResponse(request, { success: true, cards }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const saveLimit = normalizeLimit(payload && payload.limit);
    const existingCards = await readRecentSearchCards(env);
    const cards = mergeRecentSearchCards(existingCards, card, saveLimit);
    await writeRecentSearchCards(env, cards);
    return jsonResponse(request, { success: true, cards }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return jsonResponse(request, { success: false, error: 'Method not allowed' }, { status: 405 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return jsonResponse(request, { success: true, ok: true, endpoints: ['/check', '/suggest', '/recent-searches', '/drugs', '/drugs/:slug'] });
    }
    if (url.pathname === '/recent-searches') {
      return handleRecentSearches(request, env);
    }
    if (url.pathname === '/drugs' || url.pathname.startsWith('/drugs/')) {
      return handleDrugs(request, env);
    }
    if (request.method === 'OPTIONS') {
      return optionsResponse(request);
    }
    return jsonResponse(request, { success: false, error: 'Not found' }, { status: 404 });
  }
};
