(function () {
  const API_BASE_URL = 'https://foodmedchecker-api.curly-lake-5061.workers.dev';
  const RECENT_SEARCHES_API_PATH = '/recent-searches';
  const RECENT_SEARCHES_STATIC_PATH = '/data/recent-drug-searches.json';
  const RECENT_SEARCHES_MAX_CARDS = 25;
  const RECENT_SEARCHES_DESKTOP_VISIBLE = 8;
  const RECENT_SEARCHES_MOBILE_VISIBLE = 6;
  const RECENT_SEARCHES_REFRESH_INTERVAL_MS = 45000;

  const DEFAULT_DISCLAIMER = 'Food Med Checker summarizes FDA labeling for educational purposes only. It is not medical advice and does not replace guidance from a pharmacist, physician, or other qualified healthcare professional.';

  const form = document.querySelector('#med-search-form');
  const input = document.querySelector('#medication-input');
  const resultCard = document.querySelector('#result-card');
  const suggestionsList = document.querySelector('#suggestions-list');
  const year = document.querySelector('#year');
  const chips = document.querySelectorAll('.example-chip');
  const recentChecksSection = document.querySelector('#recent-medication-checks');
  const recentChecksGrid = document.querySelector('#recent-medication-checks-grid');

  const cookieBanner = document.querySelector('#cookie-banner');
  const cookieAcceptButton = document.querySelector('#cookie-accept-button');
  const submitButton = form ? form.querySelector('button[type="submit"]') : null;
  const defaultButtonText = submitButton ? submitButton.textContent : 'Check Food Instructions';
  const loadingFacts = [
    'This may take a minute while we scan available FDA labels.',
    'Fun drug fact: Viagra was supposed to help the heart. The side effect became the product.',
    'Fun drug fact: Premarin’s name comes from PREgnant MARe urINe. Yes, really.',
    'Fun drug fact: Ritalin was named after Rita, the inventor’s wife.',
    'Fun drug fact: Lasix is pharmacy wordplay: it “lasts six” hours.',
    'Fun drug fact: Warfarin started with moldy clover and bleeding cows.',
    'Fun drug fact: Warfarin’s “WARF” comes from Wisconsin Alumni Research Foundation.',
    'Fun drug fact: Ivermectin’s ancestor came from soil near a Japanese golf course.',
    'Fun drug fact: Rapamycin was named after Rapa Nui, aka Easter Island.',
    'Fun drug fact: Exenatide traces back to Gila monster saliva.',
    'Fun drug fact: Captopril was inspired by Brazilian pit viper venom.',
    'Fun drug fact: Ziconotide started as cone snail venom.',
    'Fun drug fact: Botulinum’s name comes from “botulus,” Latin for sausage.',
    'Fun drug fact: Morphine was named after Morpheus, the god of dreams.',
    'Fun drug fact: Codeine comes from the Greek word for “poppy head.”',
    'Fun drug fact: Aspirin hides “acetyl” + “Spiraea” in its name.',
    'Fun drug fact: Bayer once sold heroin as a cough medicine.',
    'Fun drug fact: Heroin’s name likely comes from German for “heroic” or “strong.”',
    'Fun drug fact: Taxol’s story starts in bark from the Pacific yew tree.',
    'Fun drug fact: Penicillin’s mold name comes from a word for “paintbrush.”',
    'Fun drug fact: Rogaine began as a blood-pressure drug. Hair growth was the surprise.',
    'Fun drug fact: Nystatin was named after New York State.',
    'Fun drug fact: Tylenol hides chemistry in its name: aceTYL + phenOL.',
    'Fun drug fact: Insulin gets its name from “insula,” Latin for island.'
  ];
  let loadingFactTimer = null;
  let loadingFactIndex = 0;
  let randomizedLoadingFacts = loadingFacts.slice();
  let suggestionDebounceTimer = null;
  let suggestionAbortController = null;
  let recentMedicationChecks = [];
  let recentMedicationRefreshTimer = null;
  let recentMedicationRefreshInFlight = false;
  let activeMedicationSearches = 0;

  if (year) {
    year.textContent = new Date().getFullYear();
  }


  if (cookieBanner && cookieAcceptButton) {
    const cookieNoticeKey = 'foodMedCheckerCookieNoticeAccepted';

    let cookieNoticeAccepted = false;

    const cookieNoticeAcceptedByCookie = document.cookie.indexOf(cookieNoticeKey + '=true') !== -1;

    try {
      cookieNoticeAccepted = window.localStorage.getItem(cookieNoticeKey) === 'true' || cookieNoticeAcceptedByCookie;
    } catch (error) {
      cookieNoticeAccepted = cookieNoticeAcceptedByCookie;
    }

    if (!cookieNoticeAccepted) {
      cookieBanner.classList.remove('hidden');
    }

    cookieAcceptButton.addEventListener('click', function () {
      cookieBanner.classList.add('hidden');

      try {
        window.localStorage.setItem(cookieNoticeKey, 'true');
      } catch (error) {
        document.cookie = cookieNoticeKey + '=true; max-age=31536000; path=/; SameSite=Lax';
      }
    });
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, function (character) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[character];
    });
  }



  function normalizeRecentSearchSlug(drugName) {
    return String(drugName || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'medication-check';
  }

  function normalizeRecentSearchBadge(badge) {
    const value = String(badge || '').trim().toLowerCase();
    const badges = {
      'no special food issue found': 'No special food issue found',
      'follow label directions': 'Follow label directions',
      'use caution': 'Use caution',
      'avoid/separate': 'Avoid/Separate',
      'avoid / separate': 'Avoid/Separate',
      'avoid separate': 'Avoid/Separate'
    };

    return badges[value] || 'Follow label directions';
  }

  function getBadgeClassName(badge) {
    const normalized = normalizeRecentSearchBadge(badge).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `recent-check-badge recent-check-badge-${normalized}`;
  }

  function normalizeRecentSearchCard(card) {
    const drugName = String(card && card.drugName || '').trim();
    const quickAnswer = String(card && card.quickAnswer || '').trim();

    if (!drugName || !quickAnswer) {
      return null;
    }

    return {
      slug: String(card.slug || normalizeRecentSearchSlug(drugName)).trim() || normalizeRecentSearchSlug(drugName),
      drugName: drugName,
      quickAnswer: quickAnswer,
      foodSafetyBadge: normalizeRecentSearchBadge(card.foodSafetyBadge),
      searchedCount: Math.max(1, Number(card.searchedCount) || 1),
      lastSearchedAt: card.lastSearchedAt || new Date().toISOString()
    };
  }

  function mergeRecentSearchCards(existingCards, newCards) {
    const merged = new Map();

    [].concat(existingCards || [], newCards || []).forEach(function (card) {
      const normalizedCard = normalizeRecentSearchCard(card);
      if (!normalizedCard) {
        return;
      }

      const previous = merged.get(normalizedCard.slug);
      if (!previous || new Date(normalizedCard.lastSearchedAt).getTime() >= new Date(previous.lastSearchedAt).getTime()) {
        merged.set(normalizedCard.slug, Object.assign({}, previous || {}, normalizedCard, {
          searchedCount: Math.max(normalizedCard.searchedCount, previous ? previous.searchedCount || 1 : 1)
        }));
      }
    });

    return Array.from(merged.values()).sort(function (a, b) {
      return new Date(b.lastSearchedAt).getTime() - new Date(a.lastSearchedAt).getTime();
    }).slice(0, RECENT_SEARCHES_MAX_CARDS);
  }

  function getVisibleRecentSearchLimit() {
    return window.matchMedia && window.matchMedia('(max-width: 620px)').matches ? RECENT_SEARCHES_MOBILE_VISIBLE : RECENT_SEARCHES_DESKTOP_VISIBLE;
  }

  function renderRecentMedicationChecks(cards) {
    if (!recentChecksSection || !recentChecksGrid) {
      return;
    }

    const usableCards = mergeRecentSearchCards([], cards).slice(0, getVisibleRecentSearchLimit());
    if (!usableCards.length) {
      recentChecksSection.classList.add('hidden');
      recentChecksGrid.innerHTML = '';
      return;
    }

    recentChecksGrid.innerHTML = usableCards.map(function (card) {
      const checkedText = `Checked ${card.searchedCount} ${card.searchedCount === 1 ? 'time' : 'times'}`;
      const savedResultUrl = `/drugs/${encodeURIComponent(card.slug)}/`;
      return `
        <article class="recent-check-card">
          <div class="recent-check-card-header">
            <h3><a href="${escapeHtml(savedResultUrl)}">${escapeHtml(card.drugName)}</a></h3>
            <span class="${escapeHtml(getBadgeClassName(card.foodSafetyBadge))}">${escapeHtml(normalizeRecentSearchBadge(card.foodSafetyBadge))}</span>
          </div>
          <p class="recent-check-answer">${escapeHtml(card.quickAnswer)}</p>
          <div class="recent-check-card-footer">
            <span>${escapeHtml(checkedText)}</span>
            <div class="recent-check-actions">
              <a class="recent-check-action" href="${escapeHtml(savedResultUrl)}">View saved result</a>
              <button class="recent-check-action" type="button" data-drug-name="${escapeHtml(card.drugName)}">Check this drug</button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    recentChecksSection.classList.remove('hidden');
  }

  async function fetchJsonWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(function () { controller.abort(); }, timeoutMs || 8000);

    try {
      return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function normalizeRecentSearchPayload(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (Array.isArray(payload && payload.cards)) {
      return payload.cards;
    }

    if (Array.isArray(payload && payload.recentSearches)) {
      return payload.recentSearches;
    }

    if (Array.isArray(payload && payload.results)) {
      return payload.results;
    }

    return [];
  }

  async function fetchRecentMedicationChecksFromApi() {
    const response = await fetchJsonWithTimeout(`${API_BASE_URL}${RECENT_SEARCHES_API_PATH}?limit=${RECENT_SEARCHES_MAX_CARDS}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    }, 8000);

    if (!response.ok) {
      throw new Error(`Recent checks API returned ${response.status}`);
    }

    return normalizeRecentSearchPayload(await response.json());
  }

  async function fetchRecentMedicationChecksFromStaticFile() {
    const cacheBust = encodeURIComponent(new Date().toISOString().slice(0, 16));
    const response = await fetch(`${RECENT_SEARCHES_STATIC_PATH}?v=${cacheBust}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Static recent checks returned ${response.status}`);
    }

    return normalizeRecentSearchPayload(await response.json());
  }

  async function loadRecentMedicationChecks() {
    if (!recentChecksSection || !recentChecksGrid) {
      return;
    }

    try {
      let cards = [];

      try {
        cards = await fetchRecentMedicationChecksFromApi();
      } catch (apiError) {
        console.log('Food Med Checker recent checks API load skipped:', apiError.message);
      }

      if (!cards.length) {
        try {
          cards = await fetchRecentMedicationChecksFromStaticFile();
        } catch (staticError) {
          console.log('Food Med Checker static recent checks load skipped:', staticError.message);
        }
      }

      recentMedicationChecks = mergeRecentSearchCards([], cards);
      renderRecentMedicationChecks(recentMedicationChecks);
    } catch (error) {
      recentChecksSection.classList.add('hidden');
      console.log('Food Med Checker recent checks load skipped:', error.message);
    }
  }

  async function refreshRecentMedicationChecksFromApi() {
    if (!recentChecksSection || !recentChecksGrid || recentMedicationRefreshInFlight || activeMedicationSearches > 0 || document.hidden) {
      return;
    }

    recentMedicationRefreshInFlight = true;
    try {
      const cards = await fetchRecentMedicationChecksFromApi();
      if (cards.length) {
        recentMedicationChecks = mergeRecentSearchCards([], cards);
        renderRecentMedicationChecks(recentMedicationChecks);
      }
    } catch (error) {
      console.log('Food Med Checker recent checks refresh skipped:', error.message);
    } finally {
      recentMedicationRefreshInFlight = false;
    }
  }

  function startRecentMedicationChecksRefresh() {
    if (!recentChecksSection || !recentChecksGrid || recentMedicationRefreshTimer) {
      return;
    }

    recentMedicationRefreshTimer = window.setInterval(refreshRecentMedicationChecksFromApi, RECENT_SEARCHES_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        refreshRecentMedicationChecksFromApi();
      }
    });
  }

  function looksLikeFailedQuickAnswer(quickAnswer) {
    return /(?:no fda label results found|could not complete|try again|no results? found|scan unavailable)/i.test(String(quickAnswer || ''));
  }

  function addOrUpdateRecentMedicationCheck(result, searchedDrug) {
    const quickAnswer = String(result && result.quickAnswer || '').trim();
    const drugName = String(result && (result.drugName || result.drug || result.name) || searchedDrug || '').trim();
    const badge = result && (result.foodSafetyBadge || (result.aiSummary && result.aiSummary.foodSafetyBadge));
    const status = String(result && result.status || '').toLowerCase();

    if (!(result && (result.success === true || result.ok === true)) || !quickAnswer || !drugName || status === 'no_results' || looksLikeFailedQuickAnswer(quickAnswer)) {
      return;
    }

    const slug = normalizeRecentSearchSlug(drugName);
    const existing = recentMedicationChecks.find(function (card) { return card.slug === slug; });
    const updatedCard = {
      slug: slug,
      drugName: drugName,
      quickAnswer: quickAnswer,
      foodSafetyBadge: normalizeRecentSearchBadge(badge),
      searchedCount: existing ? (Number(existing.searchedCount) || 1) + 1 : 1,
      lastSearchedAt: new Date().toISOString()
    };

    recentMedicationChecks = mergeRecentSearchCards(recentMedicationChecks.filter(function (card) { return card.slug !== slug; }), [updatedCard]);
    renderRecentMedicationChecks(recentMedicationChecks);
    persistRecentMedicationCheck(updatedCard);
  }

  async function persistRecentMedicationCheck(card) {
    try {
      const response = await fetchJsonWithTimeout(`${API_BASE_URL}${RECENT_SEARCHES_API_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          card: card,
          limit: RECENT_SEARCHES_MAX_CARDS
        })
      }, 8000);

      if (!response.ok) {
        throw new Error(`Recent checks API update returned ${response.status}`);
      }

      const cards = normalizeRecentSearchPayload(await response.json());
      if (cards.length) {
        recentMedicationChecks = mergeRecentSearchCards([], cards);
        renderRecentMedicationChecks(recentMedicationChecks);
      }
    } catch (error) {
      console.log('Food Med Checker recent checks API update skipped:', error.message);
    }
  }

  function normalizeSuggestionList(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (Array.isArray(payload && payload.suggestions)) {
      return payload.suggestions;
    }

    if (Array.isArray(payload && payload.results)) {
      return payload.results;
    }

    return [];
  }

  function getSuggestionName(suggestion) {
    return suggestion.name || suggestion.displayName || suggestion.drug || suggestion.term || suggestion.value || '';
  }

  function hideSuggestions() {
    if (!suggestionsList || !input) {
      return;
    }

    suggestionsList.classList.add('hidden');
    suggestionsList.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
  }

  function renderSuggestions(suggestions) {
    if (!suggestionsList || !input) {
      return;
    }

    const usableSuggestions = suggestions.filter(function (suggestion) {
      return getSuggestionName(suggestion);
    }).slice(0, 8);

    if (!usableSuggestions.length) {
      hideSuggestions();
      return;
    }

    suggestionsList.innerHTML = usableSuggestions.map(function (suggestion, index) {
      const name = getSuggestionName(suggestion);

      return `
        <button class="suggestion-item" type="button" role="option" data-suggestion-name="${escapeHtml(name)}" id="suggestion-${index}">
          ${escapeHtml(name)}
        </button>
      `;
    }).join('');

    suggestionsList.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  }

  async function fetchSuggestions(query) {
    if (!query || query.length < 2) {
      hideSuggestions();
      return;
    }

    if (suggestionAbortController) {
      suggestionAbortController.abort();
    }

    suggestionAbortController = new AbortController();

    try {
      const response = await fetch(`${API_BASE_URL}/suggest?q=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        },
        signal: suggestionAbortController.signal
      });

      if (!response.ok) {
        hideSuggestions();
        return;
      }

      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await response.json() : [];

      if (input.value.trim() !== query) {
        return;
      }

      renderSuggestions(normalizeSuggestionList(payload));
    } catch (error) {
      if (error.name !== 'AbortError') {
        hideSuggestions();
        console.log('Food Med Checker suggestion error:', error.message);
      }
    }
  }

  function formatValue(value) {
    if (Array.isArray(value)) {
      return value.filter(Boolean).join(', ');
    }

    return value || '';
  }

  function formatDateTime(value) {
    if (!value) {
      return '';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return escapeHtml(value);
    }

    return escapeHtml(date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }));
  }

  function setLoadingState(isLoading) {
    if (!submitButton) {
      return;
    }

    submitButton.disabled = isLoading;
    submitButton.textContent = isLoading ? 'Checking FDA Labeling...' : defaultButtonText;
  }

  function showResult(markup, shouldScroll) {
    resultCard.innerHTML = markup;
    resultCard.classList.remove('hidden');

    if (shouldScroll !== false) {
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function getResolvedExcerptText(source) {
    if (!source || typeof source !== 'object') {
      return '';
    }

    const excerptFields = [
      source.supportingExcerpt,
      source.excerpt,
      source.text,
      source.excerptText,
      source.sourceText,
      source.snippet
    ];

    for (let index = 0; index < excerptFields.length; index += 1) {
      const value = formatValue(excerptFields[index]).trim();

      if (value) {
        return value;
      }
    }

    return '';
  }

  function shuffleLoadingFacts() {
    randomizedLoadingFacts = loadingFacts.slice();

    for (let index = randomizedLoadingFacts.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      const currentFact = randomizedLoadingFacts[index];
      randomizedLoadingFacts[index] = randomizedLoadingFacts[randomIndex];
      randomizedLoadingFacts[randomIndex] = currentFact;
    }
  }

  function updateLoadingFact() {
    const factElement = document.querySelector('#loading-fact-text');

    if (!factElement) {
      return;
    }

    factElement.classList.remove('is-visible');

    window.setTimeout(function () {
      if (loadingFactIndex >= randomizedLoadingFacts.length) {
        shuffleLoadingFacts();
        loadingFactIndex = 0;
      }

      const currentFact = randomizedLoadingFacts[loadingFactIndex];
      factElement.textContent = currentFact;
      factElement.classList.add('is-visible');
      loadingFactIndex += 1;
    }, 220);
  }

  function startLoadingFacts() {
    stopLoadingFacts();
    shuffleLoadingFacts();
    loadingFactIndex = 0;
    updateLoadingFact();
    loadingFactTimer = window.setInterval(updateLoadingFact, 5000);
  }

  function stopLoadingFacts() {
    if (loadingFactTimer) {
      window.clearInterval(loadingFactTimer);
      loadingFactTimer = null;
    }
  }

  function renderFriendlyMessage(title, message) {
    showResult(`
      <span class="result-topline">Search needed</span>
      <h2>${escapeHtml(title)}</h2>
      <div class="result-status result-status-warning">${escapeHtml(message)}</div>
    `);
  }

  function renderLoading(drugName) {
    showResult(`
      <span class="result-topline">FDA label scan in progress</span>
      <h2>Checking food instructions for: ${escapeHtml(drugName)}</h2>
      <div class="loading-card">
        <span class="loading-spinner" aria-hidden="true"></span>
        <div class="loading-copy">
          <strong>Searching FDA labeling...</strong>
          <p>Reviewing available label language for food, meal, fasting, diet, and administration terms.</p>
          <div class="loading-fact-box" aria-live="polite" aria-atomic="true">
            <span class="loading-fact-kicker">While you wait</span>
            <p class="loading-fact-text" id="loading-fact-text"></p>
          </div>
        </div>
      </div>
    `, false);
    startLoadingFacts();
  }

  function getFindingFallback(status) {
    if (status === 'no_results') {
      return 'No FDA label results were found for this search.';
    }

    if (status === 'no_food_language_found') {
      return 'FDA labeling was found, but no clear food-related language was detected in the scanned sections.';
    }

    return 'No specific label findings were returned.';
  }

  function getQuickAnswer(data) {
    if (data.status === 'no_results') {
      return 'No FDA label results found.';
    }

    if (data.status === 'no_food_language_found') {
      return 'No clear FDA-label food instruction found.';
    }

    return data.quickAnswer || 'FDA label scan completed.';
  }

  function getPracticalTakeaway(data) {
    if (data.status === 'no_results') {
      return 'Try searching with a brand name, generic name, or different spelling. Medication labeling can vary by product and formulation.';
    }

    if (data.status === 'no_food_language_found') {
      return 'FDA labeling was found, but this scan did not detect clear food, meal, fasting, high-fat meal, grapefruit, dairy, mineral, alcohol, or tube-feeding language in the scanned sections.';
    }

    return data.practicalTakeaway || 'The API returned FDA label information, but no plain-English summary was available. Review the findings and source excerpts below, and confirm individual instructions with a qualified healthcare professional.';
  }

  function renderList(items, fallback) {
    if (!Array.isArray(items) || items.length === 0) {
      return `<p>${escapeHtml(fallback)}</p>`;
    }

    return `<ul class="findings-list">${items.map(function (item) {
      return `<li>${escapeHtml(formatValue(item))}</li>`;
    }).join('')}</ul>`;
  }

  function renderTermChips(terms) {
    if (!Array.isArray(terms) || terms.length === 0) {
      return '<p>No specific food or diet terms were detected in this scan.</p>';
    }

    return `<div class="term-chip-list">${terms.map(function (term) {
      return `<span class="term-chip">${escapeHtml(formatValue(term))}</span>`;
    }).join('')}</div>`;
  }

  function findMatchingSource(excerpt, sources) {
    if (!Array.isArray(sources) || sources.length === 0) {
      return null;
    }

    return sources.find(function (source) {
      return source.setId && excerpt.setId && source.setId === excerpt.setId;
    }) || sources.find(function (source) {
      return source.title && excerpt.sourceTitle && source.title === excerpt.sourceTitle;
    }) || sources[0];
  }


  function normalizeMatchedTerms(terms) {
    if (!terms) {
      return [];
    }

    if (Array.isArray(terms)) {
      return terms.map(formatValue).filter(Boolean);
    }

    return String(terms).split(',').map(function (term) {
      return term.trim();
    }).filter(Boolean);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function makeBoundaryTermRegex(term) {
    const tokens = String(term).match(/[A-Za-z0-9]+/g) || [];
    if (!tokens.length) {
      return null;
    }

    return new RegExp(`(^|[^A-Za-z0-9])(${tokens.map(escapeRegExp).join('[\\s\\-–—/]+')})(?=$|[^A-Za-z0-9])`, 'gi');
  }

  function isKnownFalsePositiveTermContext(term, fullText, index) {
    const normalizedTerm = String(term || '').toLowerCase();
    const localText = String(fullText || '').slice(Math.max(0, index - 40), index + 80).toLowerCase();

    if (normalizedTerm === 'tyramine') {
      return /cholestyramine/.test(localText);
    }

    if (normalizedTerm === 'calcium') {
      return /calcium[\s\-–—/]+(?:channel[\s\-–—/]+blocker(?:s)?|channel[\s\-–—/]+blocking[\s\-–—/]+drug(?:s)?|channel(?:s)?|influx|channel[\s\-–—/]+antagonist(?:s)?|antagonist(?:s)?)/.test(localText);
    }

    return false;
  }

  function highlightMatchedTerms(text, matchedTerms) {
    const sourceText = text || 'Excerpt text was not available.';
    const highlightTerms = normalizeMatchedTerms(matchedTerms).filter(function (term) {
      return term.length > 2;
    }).sort(function (a, b) {
      return b.length - a.length;
    });

    if (!highlightTerms.length) {
      return escapeHtml(sourceText);
    }

    const ranges = [];

    highlightTerms.forEach(function (term) {
      const pattern = makeBoundaryTermRegex(term);
      if (!pattern) {
        return;
      }

      let match;
      while ((match = pattern.exec(sourceText))) {
        const start = match.index + match[1].length;
        const end = start + match[2].length;
        if (!isKnownFalsePositiveTermContext(term, sourceText, start)) {
          ranges.push({ start, end });
        }
        if (match[0].length === 0) {
          pattern.lastIndex += 1;
        }
      }
    });

    if (!ranges.length) {
      return escapeHtml(sourceText);
    }

    ranges.sort(function (a, b) {
      return a.start - b.start || b.end - a.end;
    });

    const mergedRanges = [];
    ranges.forEach(function (range) {
      const previous = mergedRanges[mergedRanges.length - 1];
      if (!previous || range.start > previous.end) {
        mergedRanges.push(range);
      } else if (range.end > previous.end) {
        previous.end = range.end;
      }
    });

    let output = '';
    let cursor = 0;
    mergedRanges.forEach(function (range) {
      output += escapeHtml(sourceText.slice(cursor, range.start));
      output += `<mark class="excerpt-highlight">${escapeHtml(sourceText.slice(range.start, range.end))}</mark>`;
      cursor = range.end;
    });
    output += escapeHtml(sourceText.slice(cursor));

    return output;
  }

  function renderHighlightedExcerptText(text, matchedTerms) {
    return highlightMatchedTerms(text, matchedTerms);
  }

  function renderExcerpts(excerpts, sources) {
    if (!Array.isArray(excerpts) || excerpts.length === 0) {
      return '<p>No source excerpts were returned for this scan.</p>';
    }

    const countText = `${excerpts.length} FDA label excerpt${excerpts.length === 1 ? '' : 's'} matched this scan.`;

    return `<p class="excerpt-count">${escapeHtml(countText)}</p><div class="excerpt-list">${excerpts.map(function (excerpt, index) {
      const matchingSource = findMatchingSource(excerpt, sources);
      const title = excerpt.sourceTitle || (matchingSource ? matchingSource.title : '') || 'FDA label excerpt';
      const section = excerpt.section ? `<span>${escapeHtml(excerpt.section)}</span>` : '';
      const matchedTerms = formatValue(excerpt.matchedTerms);
      const terms = matchedTerms ? `<span>Matched: ${escapeHtml(matchedTerms)}</span>` : '';
      const resolvedExcerptText = getResolvedExcerptText(excerpt);
      const highlightedText = renderHighlightedExcerptText(resolvedExcerptText || 'Excerpt text was not available.', excerpt.matchedTerms);
      const brandName = excerpt.brandName || (matchingSource ? matchingSource.brandName : '');
      const genericName = excerpt.genericName || (matchingSource ? matchingSource.genericName : '');
      const manufacturer = excerpt.manufacturer || (matchingSource ? matchingSource.manufacturer : '');
      const effectiveTime = excerpt.effectiveTime || (matchingSource ? matchingSource.effectiveTime : '');
      const setIdValue = excerpt.setId || (matchingSource ? matchingSource.setId : '');
      const sourceDetails = [brandName, genericName, manufacturer, effectiveTime ? `Effective: ${effectiveTime}` : ''].filter(Boolean);
      const setId = setIdValue ? `<p class="source-id">Set ID: ${escapeHtml(setIdValue)}</p>` : '';
      const href = excerpt.dailyMedUrl || excerpt.sourceUrl || excerpt.url || excerpt.labelUrl || excerpt.link || (matchingSource ? (matchingSource.dailyMedUrl || matchingSource.sourceUrl || matchingSource.url || matchingSource.labelUrl || matchingSource.link) : '') || (setIdValue ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(setIdValue)}` : '');
      const link = href ? `<a class="excerpt-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">View label on DailyMed</a>` : '';

      return `
        <article class="excerpt-card">
          <div class="excerpt-card-heading">
            <h4>${escapeHtml(title)}</h4>
            ${link}
          </div>
          ${sourceDetails.length ? `<p class="excerpt-source-details">${escapeHtml(sourceDetails.join(' • '))}</p>` : ''}
          ${setId}
          ${section || terms ? `<div class="excerpt-meta">${section}${terms}</div>` : ''}
          <p>${highlightedText}</p>
          ${!link ? `<p class="excerpt-source-note">Excerpt ${index + 1} source details are listed above when available.</p>` : ''}
        </article>
      `;
    }).join('')}</div>`;
  }



  function renderDetailList(label, values) {
    const formatted = formatValue(values);

    if (!formatted) {
      return '';
    }

    return `<div class="drug-summary-detail"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatted)}</dd></div>`;
  }

  function renderDrugSummary(drugSummary) {
    if (!drugSummary || typeof drugSummary !== 'object') {
      return '';
    }

    const medlinePlus = drugSummary.medlinePlus || null;

    if (!medlinePlus) {
      return '';
    }

    const medlineTitle = medlinePlus.title || medlinePlus.name || 'MedlinePlus';
    const medlineSource = medlinePlus.source || medlinePlus.attribution || 'MedlinePlus, National Library of Medicine';
    const medlineUrl = medlinePlus.url || medlinePlus.link || medlinePlus.href;
    const medlineSummary = medlinePlus.summary || medlinePlus.description || medlinePlus.snippet || '';

    return `
      <section class="result-section-card drug-summary-card">
        <h3>Drug Summary</h3>
        <div class="medline-card">
          <h4>${escapeHtml(medlineTitle)}</h4>
          <p class="medline-source">${escapeHtml(medlineSource)}</p>
          ${medlineSummary ? `<p>${escapeHtml(medlineSummary)}</p>` : ''}
          ${medlineUrl ? `<a class="source-link" href="${escapeHtml(medlineUrl)}" target="_blank" rel="noopener noreferrer">Read more on MedlinePlus</a>` : ''}
        </div>
      </section>
    `;
  }

  function renderMetadata(data) {
    const metadata = [];

    if (data.confidence !== undefined && data.confidence !== null && data.confidence !== '') {
      metadata.push(`Confidence: ${escapeHtml(data.confidence)}`);
    }

    if (data.recordCount !== undefined && data.recordCount !== null) {
      metadata.push(`FDA label records scanned: ${escapeHtml(data.recordCount)}`);
    }

    if (data.searchedAt) {
      metadata.push(`Last scanned: ${formatDateTime(data.searchedAt)}`);
    }

    if (!metadata.length) {
      return '';
    }

    return `<p class="result-metadata">${metadata.join(' <span aria-hidden="true">•</span> ')}</p>`;
  }

  function renderResultDisclaimer(drugName) {
    return `This is not medical advice. It is a summary of the data contained in FDA approval labeling for ${escapeHtml(drugName)}. Always speak with your pharmacist and doctor before making changes to your medication regimen.`;
  }

  function renderApiResult(data, rawDrugName) {
    const drugName = data.drug || rawDrugName;
    const status = data.status || (data.ok ? 'success' : 'completed');

    showResult(`
      <span class="result-topline">FDA label scan ${escapeHtml(status.replace(/_/g, ' '))}</span>
      <h2>Food instructions for: ${escapeHtml(drugName)}</h2>
      ${renderMetadata(data)}
      <div class="result-grid">
        <section class="result-section-card result-section-card-featured">
          <h3>Quick Answer</h3>
          <p>${escapeHtml(getQuickAnswer(data))}</p>
        </section>
        <section class="result-section-card result-section-card-featured">
          <h3>Practical Takeaway</h3>
          <p>${escapeHtml(getPracticalTakeaway(data))}</p>
        </section>
        <div class="result-disclaimer result-disclaimer-card">${renderResultDisclaimer(drugName)}</div>
        ${renderDrugSummary(data.drugSummary)}
        <section class="result-section-card">
          <h3>FDA Label Food Findings</h3>
          ${renderList(data.labelFindings, getFindingFallback(data.status))}
        </section>
        <section class="result-section-card">
          <h3>Specific Food/Diet Terms Found</h3>
          <p class="terms-found-note">These are food- or drink-related terms found in FDA labeling for this medication. They help identify label language that may mention meals, beverages, minerals, absorption, or administration timing.</p>
          ${renderTermChips(data.termsFound)}
        </section>
        <section class="result-section-card excerpt-section">
          <h3>Source Excerpts</h3>
          <div class="sources-info-card">
            <span class="sources-info-icon" aria-hidden="true">i</span>
            <p><strong>Why are there so many sources?</strong> This checker searches all FDA labels. Most drugs have multiple manufacturers, and each is required to submit unique labels to the FDA. We search all of them.</p>
          </div>
          ${renderExcerpts(data.sourceExcerpts, data.sources)}
        </section>
      </div>
    `);
  }

  function renderError(errorMessage, detail) {
    const technicalDetail = detail ? `<details class="technical-details"><summary>Technical details</summary><p>${escapeHtml(detail)}</p></details>` : '';

    showResult(`
      <span class="result-topline result-topline-error">Scan unavailable</span>
      <h2>We could not complete the FDA label scan right now.</h2>
      <div class="result-status result-status-error">Please try again in a moment.</div>
      ${technicalDetail}
    `);

    if (errorMessage || detail) {
      console.log('Food Med Checker API error:', errorMessage || detail);
    }
  }

  async function runSearch(rawDrugName) {
    const drugName = rawDrugName.trim();

    if (!drugName) {
      renderFriendlyMessage('Enter a medication name', 'Please enter a medication name so Food Med Checker can scan FDA labeling.');
      input.focus();
      return;
    }

    hideSuggestions();
    activeMedicationSearches += 1;
    setLoadingState(true);
    renderLoading(drugName);

    try {
      const response = await fetch(`${API_BASE_URL}/check?drug=${encodeURIComponent(drugName)}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      });
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json() : {};

      if (!response.ok || data.error) {
        renderError(data.error || `Request failed with status ${response.status}`, data.detail);
        return;
      }

      renderApiResult(data, drugName);
      addOrUpdateRecentMedicationCheck(data, drugName);
    } catch (error) {
      renderError(error.message);
    } finally {
      activeMedicationSearches = Math.max(0, activeMedicationSearches - 1);
      stopLoadingFacts();
      setLoadingState(false);
    }
  }

  if (form && input && resultCard) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      runSearch(input.value);
    });

    input.addEventListener('input', function () {
      const query = input.value.trim();
      window.clearTimeout(suggestionDebounceTimer);

      if (query.length < 2) {
        hideSuggestions();
        return;
      }

      suggestionDebounceTimer = window.setTimeout(function () {
        fetchSuggestions(query);
      }, 250);
    });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        hideSuggestions();
      }
    });

    document.addEventListener('click', function (event) {
      if (!form.contains(event.target)) {
        hideSuggestions();
      }
    });

    if (suggestionsList) {
      suggestionsList.addEventListener('click', function (event) {
        const suggestionButton = event.target.closest('.suggestion-item');

        if (!suggestionButton) {
          return;
        }

        const selectedName = suggestionButton.getAttribute('data-suggestion-name');
        input.value = selectedName;
        hideSuggestions();
        runSearch(selectedName);
      });
    }
  }

  if (recentChecksGrid) {
    recentChecksGrid.addEventListener('click', function (event) {
      const action = event.target.closest('button.recent-check-action');
      if (!action || !input) {
        return;
      }

      const drugName = action.getAttribute('data-drug-name') || '';
      input.value = drugName;
      if (form) {
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      runSearch(drugName);
    });
  }

  window.addEventListener('resize', function () {
    renderRecentMedicationChecks(recentMedicationChecks);
  });

  function applyHomepageQueryParameters() {
    if (!input) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const drugName = (params.get('drug') || '').trim();

    if (!drugName) {
      return;
    }

    input.value = drugName;

    if (params.get('run') === '1' && form && resultCard) {
      window.setTimeout(function () {
        runSearch(drugName);
      }, 150);
    }
  }

  loadRecentMedicationChecks();
  startRecentMedicationChecksRefresh();
  applyHomepageQueryParameters();

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      input.value = chip.textContent.trim();
      runSearch(input.value);
    });
  });
}());
