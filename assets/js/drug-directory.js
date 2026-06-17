(function () {
  const API_BASE_URL = 'https://foodmedchecker-api.curly-lake-5061.workers.dev';
  const DRUGS_ENDPOINT = `${API_BASE_URL}/drugs?limit=1000`;
  const LETTERS = ['All'].concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), ['#']);
  const root = document.querySelector('#drug-directory-root');
  const searchInput = document.querySelector('#directory-search-input');
  const azFilter = document.querySelector('#az-filter');
  const count = document.querySelector('#directory-count');
  const year = document.querySelector('#year');
  let allCards = [];
  let activeLetter = 'All';
  if (year) year.textContent = new Date().getFullYear();

  function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function slugify(value) { return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'medication-check'; }
  function normalizeBadge(badge) { const v = String(badge || '').trim().toLowerCase(); return {'no special food issue found':'No special food issue found','follow label directions':'Follow label directions','use caution':'Use caution','avoid/separate':'Avoid/Separate','avoid / separate':'Avoid/Separate','avoid separate':'Avoid/Separate'}[v] || 'Follow label directions'; }
  function getBadgeClassName(badge) { return `recent-check-badge recent-check-badge-${normalizeBadge(badge).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`; }
  function formatDateTime(value) { if (!value) return ''; const d = new Date(value); if (Number.isNaN(d.getTime())) return ''; return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
  function normalizeDrugCard(card) {
    const name = String((card && (card.drugName || card.name || card.drug || card.slug)) || '').trim();
    if (!name) return null;
    const quickAnswer = String((card && card.quickAnswer) || '').trim();
    return { slug: String((card && card.slug) || slugify(name)).trim() || slugify(name), drugName: name, quickAnswer: quickAnswer || 'Saved FoodMedChecker result available.', practicalTakeaway: String((card && (card.practicalTakeaway || card.practicalTips)) || '').trim(), foodSafetyBadge: normalizeBadge(card && card.foodSafetyBadge), searchedCount: Math.max(0, Number(card && card.searchedCount) || 0), firstSearchedAt: card && card.firstSearchedAt, lastSearchedAt: card && card.lastSearchedAt };
  }
  function getDrugFirstLetter(card) { const first = String(card && card.drugName || '').trim().charAt(0).toUpperCase(); return /^[A-Z]$/.test(first) ? first : '#'; }
  function groupCardsByLetter(cards) { return cards.reduce((groups, card) => { const letter = getDrugFirstLetter(card); (groups[letter] = groups[letter] || []).push(card); return groups; }, {}); }
  function getFilteredCards() { const q = (searchInput && searchInput.value || '').trim().toLowerCase(); return allCards.filter(card => (activeLetter === 'All' || getDrugFirstLetter(card) === activeLetter) && (!q || card.drugName.toLowerCase().includes(q) || card.quickAnswer.toLowerCase().includes(q))); }
  function renderLoading() { if (root) root.innerHTML = '<div class="directory-empty-state"><h2>Loading saved drug checks…</h2><p>Fetching saved medication summaries from FoodMedChecker.</p></div>'; }
  function renderEmpty() { if (root) root.innerHTML = '<div class="directory-empty-state"><h2>No saved medication checks found</h2><p>Try another search or run a live check from the homepage.</p><a class="directory-button-primary" href="/">Go to medication search</a></div>'; }
  function renderError() { if (root) root.innerHTML = '<div class="directory-error-state"><h2>We couldn’t load the drug directory</h2><p>Please refresh the page or run a live check from the homepage.</p><a class="directory-button-primary" href="/">Go home</a></div>'; }
  function renderDirectory() {
    const cards = getFilteredCards();
    if (count) count.textContent = `${cards.length} of ${allCards.length} saved medication ${allCards.length === 1 ? 'check' : 'checks'} shown`;
    if (!cards.length) return renderEmpty();
    const groups = groupCardsByLetter(cards);
    root.innerHTML = Object.keys(groups).sort((a,b)=> a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)).map(letter => `<section class="drug-directory-section" aria-labelledby="drug-letter-${letter}"><h2 class="drug-letter-heading" id="drug-letter-${letter}">${letter}</h2><div class="drug-directory-grid">${groups[letter].map(card => { const last = formatDateTime(card.lastSearchedAt); return `<article class="drug-directory-card"><div class="drug-directory-card-header"><h3 class="drug-directory-card-title"><a href="/drugs/${encodeURIComponent(card.slug)}/">${escapeHtml(card.drugName)}</a></h3><span class="${escapeHtml(getBadgeClassName(card.foodSafetyBadge))}">${escapeHtml(card.foodSafetyBadge)}</span></div><p class="drug-directory-card-answer">${escapeHtml(card.quickAnswer)}</p><div class="drug-directory-card-meta"><span>Checked ${escapeHtml(card.searchedCount || 0)} ${card.searchedCount === 1 ? 'time' : 'times'}</span>${last ? `<span>Last checked ${escapeHtml(last)}</span>` : ''}</div><div class="drug-directory-card-actions"><a class="directory-button-primary" href="/drugs/${encodeURIComponent(card.slug)}/">View result</a><a class="directory-button-secondary" href="/?drug=${encodeURIComponent(card.drugName)}&run=1">Run fresh check</a></div></article>`; }).join('')}</div></section>`).join('');
  }
  function renderAzFilter() { if (!azFilter) return; azFilter.innerHTML = LETTERS.map(letter => `<button class="az-filter-button${letter === activeLetter ? ' active' : ''}" type="button" data-letter="${letter}" aria-pressed="${letter === activeLetter}">${letter}</button>`).join(''); }
  function wireFilters() { if (searchInput) searchInput.addEventListener('input', renderDirectory); if (azFilter) azFilter.addEventListener('click', e => { const b = e.target.closest('.az-filter-button'); if (!b) return; activeLetter = b.dataset.letter; renderAzFilter(); renderDirectory(); }); }
  async function init() { renderAzFilter(); wireFilters(); renderLoading(); try { const response = await fetch(DRUGS_ENDPOINT, { headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error('Directory request failed'); const payload = await response.json(); const rows = Array.isArray(payload) ? payload : (payload.drugs || payload.cards || payload.results || []); allCards = rows.map(normalizeDrugCard).filter(Boolean).sort((a,b)=>a.drugName.localeCompare(b.drugName)); renderDirectory(); } catch (e) { renderError(); } }
  init();
}());
