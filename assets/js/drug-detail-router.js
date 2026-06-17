(function () {
  const API_BASE_URL = 'https://foodmedchecker-api.curly-lake-5061.workers.dev';
  const PHARMACIST_URL = 'https://hellopharmacist.com/ask-a-pharmacist';
  const root = document.querySelector('#drug-detail-router-root');
  const year = document.querySelector('#year');
  if (year) year.textContent = new Date().getFullYear();

  function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function slugToName(slug) { return String(slug || '').split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); }
  function normalizeBadge(badge) { const v = String(badge || '').trim().toLowerCase(); return {'no special food issue found':'No special food issue found','follow label directions':'Follow label directions','use caution':'Use caution','avoid/separate':'Avoid/Separate','avoid / separate':'Avoid/Separate','avoid separate':'Avoid/Separate'}[v] || 'Follow label directions'; }
  function formatDateTime(value) { if (!value) return ''; const d = new Date(value); if (Number.isNaN(d.getTime())) return ''; return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  function updateMeta(name) { document.title = `${name} Food Instructions | Food Med Checker`; let meta = document.querySelector('meta[name="description"]'); if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); } meta.content = `Food instructions and meal timing summary for ${name}, powered by Food Med Checker.`; }
  function getSlugFromPath() { const match = window.location.pathname.match(/^\/drugs\/([^/]+)\/?$/); return match ? decodeURIComponent(match[1]) : ''; }
  function normalizeArray(value) { return Array.isArray(value) ? value : []; }

  function normalizeDrugCard(card, slug) {
    const name = String((card && (card.drugName || card.name || card.drug)) || slugToName(slug)).trim();
    return {
      slug,
      drugName: name,
      quickAnswer: String((card && card.quickAnswer) || '').trim(),
      practicalTakeaway: String((card && (card.practicalTakeaway || card.practicalTips)) || '').trim(),
      foodSafetyBadge: normalizeBadge(card && card.foodSafetyBadge),
      searchedCount: Math.max(0, Number(card && card.searchedCount) || 0),
      firstSearchedAt: card && card.firstSearchedAt,
      lastSearchedAt: card && card.lastSearchedAt,
      drugSummary: card && card.drugSummary,
      sourceExcerpts: normalizeArray(card && card.sourceExcerpts),
      sources: normalizeArray(card && card.sources)
    };
  }

  function renderShell(inner) { root.innerHTML = `<section class="section drug-detail-hero"><div class="container">${inner}</div></section>`; }
  function renderNormal404() { document.title = 'Page not found | Food Med Checker'; renderShell(`<p class="eyebrow">404</p><h1>Page not found</h1><p class="hero-subtitle">We couldn’t find that FoodMedChecker page.</p><div class="drug-detail-actions"><a class="directory-button-primary" href="/">Go home</a><a class="directory-button-secondary" href="/drugs/">Browse Drugs</a></div>`); }
  function renderLoading() { renderShell('<p class="eyebrow">Medication food instructions</p><h1>Loading saved drug check…</h1><p class="hero-subtitle">Fetching the saved FoodMedChecker result.</p>'); }
  function renderNotFound(slug) { document.title = 'Saved drug check not found yet | Food Med Checker'; renderShell(`<p class="eyebrow">Medication food instructions</p><h1>Saved drug check not found yet</h1><p class="hero-subtitle">This medication may not have a saved public check yet. Run a fresh search to create one.</p><div class="drug-detail-actions"><a class="directory-button-primary" href="/?drug=${encodeURIComponent(slug)}&run=1">Search this medication</a><a class="directory-button-secondary" href="/drugs/">Back to Drug Directory</a></div>`); }

  function findMatchingSource(excerpt, sources) {
    return normalizeArray(sources).find(source => (excerpt && source) && ((excerpt.setId && source.setId === excerpt.setId) || (excerpt.sourceTitle && source.title === excerpt.sourceTitle))) || null;
  }

  function getDailyMedHref(excerpt, sources) {
    const source = findMatchingSource(excerpt, sources);
    const href = excerpt.dailyMedUrl || excerpt.sourceUrl || excerpt.url || excerpt.labelUrl || excerpt.link || (source && (source.dailyMedUrl || source.sourceUrl || source.url || source.labelUrl || source.link));
    const setId = excerpt.setId || (source && source.setId);
    return href || (setId ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(setId)}` : '');
  }

  function renderDrugSummary(drugSummary) {
    const medlinePlus = drugSummary && drugSummary.medlinePlus;
    if (!medlinePlus) return '';
    const title = medlinePlus.title || medlinePlus.name || 'MedlinePlus drug information';
    const source = medlinePlus.source || medlinePlus.attribution || 'MedlinePlus, National Library of Medicine';
    const summary = medlinePlus.summary || medlinePlus.description || medlinePlus.snippet || '';
    const url = medlinePlus.url || medlinePlus.link || medlinePlus.href;
    return `<article class="drug-detail-card drug-detail-medline"><h2>MedlinePlus Drug Description</h2><h3>${escapeHtml(title)}</h3><p class="medline-source">${escapeHtml(source)}</p>${summary ? `<p>${escapeHtml(summary)}</p>` : ''}${url ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Read more on MedlinePlus</a>` : ''}</article>`;
  }

  function renderSourceExcerpts(card) {
    if (!card.sourceExcerpts.length) return `<article class="drug-detail-card"><h2>Need the source excerpts?</h2><p>Run a fresh check to review the live FDA label excerpts used by FoodMedChecker.</p></article>`;
    return `<article class="drug-detail-card drug-detail-excerpts"><h2>Source excerpts</h2><p>These FDA label excerpts supported the saved food-instruction summary for this medication.</p>${card.sourceExcerpts.slice(0, 6).map((excerpt, index) => { const href = getDailyMedHref(excerpt, card.sources); const title = excerpt.sourceTitle || 'FDA label excerpt'; const text = excerpt.text || excerpt.excerpt || excerpt.sourceText || excerpt.content || ''; return `<div class="drug-detail-excerpt"><div class="excerpt-card-heading"><h3>${escapeHtml(title)}</h3>${href ? `<a class="excerpt-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">View DailyMed label</a>` : ''}</div>${excerpt.section ? `<p class="excerpt-meta"><span>${escapeHtml(excerpt.section)}</span></p>` : ''}<p>${escapeHtml(text || `Excerpt ${index + 1} text was not available in this saved record.`)}</p></div>`; }).join('')}</article>`;
  }

  function renderDetail(card) {
    updateMeta(card.drugName);
    const first = formatDateTime(card.firstSearchedAt);
    const last = formatDateTime(card.lastSearchedAt);
    const count = card.searchedCount || 0;
    root.innerHTML = `<section class="section drug-detail-hero"><div class="container"><p class="eyebrow">Medication food instructions</p><h1>${escapeHtml(card.drugName)} Food Instructions</h1><div class="drug-detail-meta"><span>Users have checked this drug ${escapeHtml(count)} ${count === 1 ? 'time' : 'times'}</span>${first ? `<span>First checked ${escapeHtml(first)}</span>` : ''}${last ? `<span>Last checked ${escapeHtml(last)}</span>` : ''}</div><div class="drug-detail-actions"><a class="directory-button-primary" href="/?drug=${encodeURIComponent(card.drugName)}&run=1">Run a fresh check</a><a class="directory-button-secondary" href="/drugs/">Back to Drug Directory</a></div></div></section><section class="section drug-detail-layout-section"><div class="container drug-detail-layout"><article class="drug-detail-card drug-detail-card-featured"><h2>Quick Answer</h2><p>${escapeHtml(card.quickAnswer || 'No quick answer is saved for this medication yet. Run a fresh check to rescan available labeling.')}</p></article>${card.practicalTakeaway ? `<article class="drug-detail-card"><h2>Practical Takeaway</h2><p>${escapeHtml(card.practicalTakeaway)}</p></article>` : ''}${renderDrugSummary(card.drugSummary)}${renderSourceExcerpts(card)}<article class="drug-detail-card"><h2>How this page was created</h2><p>FoodMedChecker scans FDA labeling in real time when a user searches for a medication. After a qualifying search is completed, the medication name, plain-English summary, supporting FDA label context, and check history are saved automatically to this public directory so future visitors can review the result and run a fresh scan when needed.</p></article><article class="drug-detail-card drug-detail-pharmacist-cta"><h2>Still have questions about your situation?</h2><p>A pharmacist created and coded Food Med Checker to automatically search FDA labels and save user-searched medication information to this directory. Even so, these automated summaries never replace advice from your pharmacist, doctor, or another qualified healthcare professional.</p><a class="directory-button-primary" href="${PHARMACIST_URL}" target="_blank" rel="noopener noreferrer">Ask a pharmacist on HelloPharmacist</a></article><article class="drug-detail-card drug-detail-disclaimer"><h2>Educational disclaimer</h2><p>Food Med Checker summarizes FDA labeling for educational purposes only. It is not medical advice and does not replace guidance from a pharmacist, physician, or other qualified healthcare professional. Medication instructions can vary by dose, formulation, route, product, and individual patient factors.</p></article></div></section>`;
  }

  async function init() { const slug = getSlugFromPath(); if (!slug) return renderNormal404(); renderLoading(); try { const response = await fetch(`${API_BASE_URL}/drugs/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } }); if (response.status === 404) return renderNotFound(slug); if (!response.ok) throw new Error('Drug request failed'); const payload = await response.json(); let raw = payload && (payload.card || payload.drug || payload.result); if (!raw && payload && (payload.drugName || payload.name || payload.drug || payload.quickAnswer)) raw = payload; if (!raw || raw.success === false) return renderNotFound(slug); renderDetail(normalizeDrugCard(raw, slug)); } catch (e) { renderNotFound(slug); } }
  init();
}());
