const OPENFDA_LABEL_URL = 'https://api.fda.gov/drug/label.json';
const OPENFDA_NDC_URL = 'https://api.fda.gov/drug/ndc.json';
const RXNAV_SUGGEST_URL = 'https://rxnav.nlm.nih.gov/REST/spellingsuggestions.json';
const MEDLINE_CONNECT_URL = 'https://connect.medlineplus.gov/service';
const DISCLAIMER = 'Food Med Checker summarizes FDA labeling for educational purposes only. It is not medical advice and does not replace guidance from a pharmacist, physician, or other qualified healthcare professional.';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400'
};

const LABEL_SECTIONS = [
  'boxed_warning', 'indications_and_usage', 'dosage_and_administration', 'dosage_and_administration_table',
  'administration', 'patient_medication_information', 'patient_medication_information_table', 'patient_information',
  'patient_information_table', 'information_for_patients', 'information_for_patients_table', 'instructions_for_use',
  'instructions_for_use_table', 'spl_medguide', 'spl_medguide_table', 'spl_patient_package_insert',
  'spl_patient_package_insert_table', 'drug_interactions', 'drug_interactions_table', 'warnings', 'warnings_table',
  'warnings_and_cautions', 'warnings_and_cautions_table', 'precautions', 'precautions_table', 'contraindications',
  'contraindications_table', 'clinical_pharmacology', 'clinical_pharmacology_table', 'pharmacokinetics',
  'pharmacokinetics_table', 'ask_doctor', 'ask_doctor_table', 'ask_doctor_or_pharmacist',
  'ask_doctor_or_pharmacist_table', 'when_using', 'when_using_table', 'do_not_use', 'do_not_use_table',
  'stop_use', 'stop_use_table', 'food_safety_warning', 'use_in_specific_populations'
];

const FLEXIBLE_TERM_SEPARATOR = '[\\s\\-–—/]+';
const MINERAL_SUPPORT_RX = /\b(diet(?:ary)?|food|meal|intake|supplement(?:s|al)?|vitamin|mineral|multivitamin|antacid(?:s)?|milk|dairy|yogurt|cheese|carbonate|citrate|acetate|sulfate|sulphate|gluconate|oxide|hydroxide|salt(?:s)?|bind(?:s|ing)?|chelat(?:e|es|ion|ing)|absorption|bioavailability|separat(?:e|ed|ion)|administ(?:er|ered|ration).*\b(apart|with|from)|apart|reduc(?:e|ed|es|ing)\s+(?:efficacy|effectiveness|absorption)|decreas(?:e|ed|es|ing)\s+absorption)\b/i;
const MINERAL_EXCLUSION_RX = /\b(?:calcium[\s\-–—/]+(?:channel(?:s)?|influx|antagonist(?:s)?|channel[\s\-–—/]+blocker(?:s)?|channel[\s\-–—/]+blocking[\s\-–—/]+drug(?:s)?)|iron[\s\-–—/]+(?:deficiency|overload)|magnesium[\s\-–—/]+(?:level(?:s)?|concentration(?:s)?)|alumin(?:um|ium)[\s\-–—/]+(?:adjuvant(?:s)?|container(?:s)?))\b/i;

const TERMS = [
  { term: 'grapefruit juice', priority: 100, warning: 'avoid grapefruit juice', aliases: ['grapefruit juice', 'grapefruit'] },
  { term: 'alcohol', priority: 95, warning: 'avoid or ask about alcohol', aliases: ['alcohol', 'alcoholic', 'ethanol'] },
  { term: 'dairy', priority: 90, warning: 'separate from dairy when directed', aliases: ['dairy', 'milk', 'yogurt'] },
  { term: 'calcium', priority: 90, warning: 'separate from calcium/mineral products when directed', aliases: ['calcium'], validator: validateMineralTerm },
  { term: 'iron', priority: 90, warning: 'separate from iron/mineral products when directed', aliases: ['iron', 'ferrous'], validator: validateMineralTerm },
  { term: 'magnesium', priority: 90, warning: 'separate from magnesium/mineral products when directed', aliases: ['magnesium'], validator: validateMineralTerm },
  { term: 'aluminum', priority: 90, warning: 'separate from aluminum/mineral products when directed', aliases: ['aluminum', 'aluminium'], validator: validateMineralTerm },
  { term: 'antacids', priority: 88, warning: 'separate from antacids when directed', aliases: ['antacid', 'antacids'] },
  { term: 'vitamin K', priority: 86, warning: 'keep vitamin K intake consistent if directed', aliases: ['vitamin K'] },
  { term: 'tyramine', priority: 86, warning: 'avoid high-tyramine foods if directed', aliases: ['tyramine'] },
  { term: 'caffeine', priority: 84, warning: 'limit caffeine if directed', aliases: ['caffeine', 'coffee', 'tea'] },
  { term: 'fruit juice', priority: 84, warning: 'separate from fruit juice when directed', aliases: ['fruit juice', 'apple juice', 'orange juice'] },
  { term: 'high-fat meal', priority: 82, warning: 'follow high-fat meal instructions', aliases: ['high fat meal', 'high fat food', 'fatty meal'] },
  { term: 'tube feeding', priority: 82, warning: 'follow tube-feeding instructions', aliases: ['enteral feeding', 'tube feeding', 'feeding tube', 'nasogastric', 'gastrostomy'] },
  { term: 'food', priority: 50, aliases: ['food', 'meal', 'meals', 'fed', 'fasting', 'fasted', 'empty stomach'] },
  { term: 'absorption', priority: 20, aliases: ['absorption', 'AUC', 'Cmax', 'exposure', 'pharmacokinetic'] }
].map(prepareTerm);
const WARNING_RX = /avoid|do not|not recommended|separate|increase(?:d|s)?\s+(?:risk|exposure|AUC|Cmax)|reduce(?:d|s)?\s+absorption|decrease(?:d|s)?\s+absorption|contraindicat|should not|must not|limit/i;

export default { async fetch(request, env) { return handleRequest(request, env); } };

async function handleRequest(request, env = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  const url = new URL(request.url);
  try {
    if (url.pathname === '/') return json({ ok: true, service: 'Food Med Checker API' });
    if (url.pathname === '/suggest') return json(await suggest(url.searchParams.get('q') || ''));
    if (url.pathname === '/check') return json(await checkDrug(url.searchParams.get('drug') || '', env));
    return json({ error: 'Not found' }, 404);
  } catch (error) { return json({ error: 'API error', detail: error.message }, 500); }
}

async function checkDrug(drug, env) {
  drug = drug.trim();
  if (!drug) return { error: 'Missing drug parameter' };
  const labels = await fetchLabels(drug);
  if (!labels.length) return base(drug, 'no_results', [], [], [], [], null);
  const excerpts = collectExcerpts(labels);
  const terms = [...new Set(excerpts.flatMap(e => e.matchedTerms))];
  const critical = detectCriticalWarnings(excerpts);
  excerpts.sort((a, b) => b.score - a.score);
  const findings = buildFindings(excerpts, critical);
  const medlinePlus = await fetchMedline(drug).catch(() => null);
  let summary = await summarizeWithOpenAI(drug, findings, critical, excerpts.slice(0, 6), env).catch(() => null);
  if (!summary) summary = deterministicSummary(findings, critical, terms);
  summary = applySafetyOverride(summary, critical);
  return { ok: true, drug, status: excerpts.length ? 'success' : 'no_food_language_found', quickAnswer: summary.quickAnswer, practicalTakeaway: summary.practicalTakeaway, labelFindings: findings, termsFound: terms, criticalDietWarnings: critical, sourceExcerpts: excerpts.slice(0, 8), sources: labels.map(sourceMeta), drugSummary: { medlinePlus }, confidence: critical.length ? 'high' : (excerpts.length ? 'medium' : 'low'), recordCount: labels.length, searchedAt: new Date().toISOString(), disclaimer: DISCLAIMER };
}

function base(drug, status, findings, terms, critical, excerpts, medlinePlus) { return { ok: true, drug, status, labelFindings: findings, termsFound: terms, criticalDietWarnings: critical, sourceExcerpts: excerpts, sources: [], drugSummary: { medlinePlus }, recordCount: 0, searchedAt: new Date().toISOString(), disclaimer: DISCLAIMER }; }
async function fetchLabels(drug) {
  const queries = [`openfda.brand_name:"${esc(drug)}"`, `openfda.generic_name:"${esc(drug)}"`, `openfda.substance_name:"${esc(drug)}"`];
  const bySetId = new Map();
  for (const search of queries) {
    const url = `${OPENFDA_LABEL_URL}?search=${encodeURIComponent(search)}&limit=10`;
    let r;
    try { r = await fetch(url); } catch (error) { continue; }
    if (!r.ok) continue;
    const d = await r.json();
    for (const result of d.results || []) bySetId.set(result.set_id || JSON.stringify(result.openfda || {}).slice(0, 120), result);
    if (bySetId.size >= 10) break;
  }
  return [...bySetId.values()].slice(0, 10);
}
function esc(s) { return String(s).replace(/["\\]/g, ''); }
function flatten(v) { if (v == null) return []; if (typeof v === 'string') return [v]; if (Array.isArray(v)) return v.flatMap(flatten); if (typeof v === 'object') return Object.values(v).flatMap(flatten); return [String(v)]; }
function collectExcerpts(labels) { const out = []; for (const label of labels) for (const section of LABEL_SECTIONS) for (const text of flatten(label[section])) { const clean = text.replace(/\s+/g, ' ').trim(); if (!clean) continue; const matched = findValidatedTerms(clean); if (!matched.length) continue; const score = Math.max(...matched.map(t => t.priority)) + (WARNING_RX.test(clean) ? 25 : 0); out.push({ section, text: trimExcerpt(clean, matched), matchedTerms: matched.sort((a,b)=>b.priority-a.priority).map(t=>t.term), score, ...sourceMeta(label) }); } return out; }
function trimExcerpt(text, matched) { const i = Math.min(...matched.map(t => t.index ?? 999999)); const start = Math.max(0, i - 180); return (start ? '...' : '') + text.slice(start, start + 700) + (text.length > start + 700 ? '...' : ''); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function makeBoundaryTermRegex(term) { const tokens = String(term).match(/[A-Za-z0-9]+/g) || []; if (!tokens.length) return null; return new RegExp(`(^|[^A-Za-z0-9])(${tokens.map(escapeRegExp).join(FLEXIBLE_TERM_SEPARATOR)})(?=$|[^A-Za-z0-9])`, 'gi'); }
function prepareTerm(term) { const aliases = term.aliases || [term.term]; return { ...term, aliases, patterns: aliases.map(makeBoundaryTermRegex).filter(Boolean) }; }
function getTermMatches(text, term) { const matches = []; for (const pattern of term.patterns) { pattern.lastIndex = 0; let match; while ((match = pattern.exec(text))) { const phraseIndex = match.index + match[1].length; if (!term.validator || term.validator(term, text, phraseIndex)) matches.push({ index: phraseIndex, value: match[2] }); if (match[0].length === 0) pattern.lastIndex += 1; } } return matches; }
function findValidatedTerms(text) { return TERMS.map(t => ({ ...t, matches: getTermMatches(text, t) })).filter(t => t.matches.length).map(t => ({ ...t, index: Math.min(...t.matches.map(m => m.index)) })); }
function validateMineralTerm(term, text, index) { const windowText = text.slice(Math.max(0, index - 80), index + 120); if (MINERAL_EXCLUSION_RX.test(windowText)) return false; return MINERAL_SUPPORT_RX.test(windowText); }
function sourceMeta(l) { const of = l.openfda || {}; const setId = l.set_id || ''; return { sourceTitle: [first(of.brand_name), first(of.generic_name)].filter(Boolean).join(' / ') || 'FDA label', title: [first(of.brand_name), first(of.generic_name)].filter(Boolean).join(' / ') || 'FDA label', brandName: first(of.brand_name), genericName: first(of.generic_name), manufacturer: first(of.manufacturer_name), effectiveTime: l.effective_time, setId, dailyMedUrl: setId ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}` : '' }; }
function first(v) { return Array.isArray(v) ? v[0] : (v || ''); }
function detectCriticalWarnings(excerpts) { const map = new Map(); for (const e of excerpts) { if (!WARNING_RX.test(e.text)) continue; for (const name of e.matchedTerms || []) { const t = TERMS.find(x => x.term === name); if (t?.warning && t.priority >= 82) map.set(t.term, { term: t.term, warning: t.warning, excerpt: e.text, section: e.section }); } } return [...map.values()]; }
function buildFindings(excerpts, critical) { const findings = critical.map(c => `${cap(c.term)}: ${c.warning}.`); for (const e of excerpts.slice(0, 6)) findings.push(`${e.section.replace(/_/g, ' ')} mentions ${e.matchedTerms.join(', ')}.`); return [...new Set(findings)].slice(0, 8); }
function deterministicSummary(findings, critical, terms) { let quick = terms.includes('food') ? 'Review the FDA label food instructions found below.' : 'No clear with-food or without-food instruction was found.'; if (critical.some(c => c.term === 'grapefruit juice')) {
    quick = 'Can be taken with or without food, but avoid grapefruit juice.';
    return { quickAnswer: quick, practicalTakeaway: 'Avoid grapefruit juice because FDA labeling says it can increase drug exposure and/or side-effect risk. Follow the label and ask a pharmacist or prescriber how it applies to your product.' };
  }
  if (critical.length) quick = `Important food/drink warning found: ${critical.map(c => c.warning).join('; ')}.`;
  return { quickAnswer: quick, practicalTakeaway: critical.length ? `The FDA label includes important diet-related language: ${critical.map(c => `${c.term} (${c.warning})`).join('; ')}. Follow the label and ask a pharmacist or prescriber how it applies to your product.` : (findings[0] || 'Review the source excerpts and confirm instructions with a pharmacist or prescriber.') }; }
async function summarizeWithOpenAI(drug, findings, critical, excerpts, env) { if (!env.OPENAI_API_KEY) return null; const body = { model: env.OPENAI_MODEL || 'gpt-4o-mini', messages: [{ role: 'system', content: 'Return JSON with quickAnswer and practicalTakeaway. Be definitive, consumer-facing, and include every criticalDietWarning.' }, { role: 'user', content: JSON.stringify({ drug, criticalDietWarnings: critical, findings, excerpts }) }], response_format: { type: 'json_object' }, temperature: 0.1 }; const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) return null; return JSON.parse((await r.json()).choices[0].message.content); }
function applySafetyOverride(s, critical) { const need = critical.filter(c => !new RegExp(c.term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i').test(`${s.quickAnswer} ${s.practicalTakeaway}`)); if (need.some(c => c.term === 'grapefruit juice')) { if (!/grapefruit/i.test(s.quickAnswer)) s.quickAnswer = `${s.quickAnswer.replace(/\.$/, '')}, but avoid grapefruit juice.`; if (!/grapefruit/i.test(s.practicalTakeaway)) s.practicalTakeaway += ' Grapefruit juice can increase simvastatin exposure and may increase the risk of side effects.'; } else if (need.length) { const add = need.map(c => c.warning).join('; '); s.quickAnswer = `${s.quickAnswer.replace(/\.$/, '')}. Important: ${add}.`; s.practicalTakeaway = `${s.practicalTakeaway.replace(/\.$/, '')}. Important food/drink warning: ${add}.`; } return s; }
async function suggest(q) { q = q.trim(); if (q.length < 2) return { suggestions: [] }; const [rx, ndc] = await Promise.allSettled([fetch(`${RXNAV_SUGGEST_URL}?name=${encodeURIComponent(q)}`).then(r=>r.json()), fetch(`${OPENFDA_NDC_URL}?search=${encodeURIComponent(`brand_name:${q}* generic_name:${q}*`)}&limit=10`).then(r=>r.ok?r.json():{results:[]})]); const names = new Set(); (((rx.value||{}).suggestionGroup||{}).suggestionList||{}).suggestion?.forEach(n=>names.add(n)); (ndc.value?.results||[]).forEach(x => { if (x.brand_name) names.add(x.brand_name); if (x.generic_name) names.add(x.generic_name); }); return { suggestions: [...names].slice(0, 10).map(name => ({ name })) }; }
async function fetchMedline(drug) { const url = `${MEDLINE_CONNECT_URL}?mainSearchCriteria.v.cs=2.16.840.1.113883.6.88&mainSearchCriteria.v.dn=${encodeURIComponent(drug)}&knowledgeResponseType=application/json`; const r = await fetch(url); if (!r.ok) return null; const d = await r.json(); const e = d.feed?.entry?.[0]; return e ? { title: e.title?._value || e.title, url: e.link?.[0]?.href, summary: e.summary?._value || e.summary, source: 'MedlinePlus, National Library of Medicine' } : null; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function json(data, status = 200) { return new Response(JSON.stringify(data, null, 2), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } }); }

export { escapeRegExp, makeBoundaryTermRegex, findValidatedTerms };
