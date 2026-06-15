(function () {
  const API_BASE_URL = 'https://foodmedchecker-api.curly-lake-5061.workers.dev';
  const DEFAULT_DISCLAIMER = 'Food Med Checker summarizes FDA labeling for educational purposes only. It is not medical advice and does not replace guidance from a pharmacist, physician, or other qualified healthcare professional.';
  const NO_LABEL_MESSAGE = 'No FDA labeling record was found for that search term. Try the brand name, generic name, or a more specific product name.';
  const NO_FOOD_LANGUAGE_MESSAGE = 'No relevant FDA label food or beverage language was found in the scanned sections. This does not prove no interaction exists.';
  const FALLBACK_QUICK_ANSWER = 'Food Med Checker scanned FDA labeling for food, beverage, and administration language. Review the findings and source excerpts below, and confirm personal instructions with a pharmacist or prescriber.';

  const form = document.querySelector('#med-search-form');
  const input = document.querySelector('#medication-input');
  const resultCard = document.querySelector('#result-card');
  const suggestionsList = document.querySelector('#suggestions-list');
  const year = document.querySelector('#year');
  const chips = document.querySelectorAll('.example-chip');

  const cookieBanner = document.querySelector('#cookie-banner');
  const cookieAcceptButton = document.querySelector('#cookie-accept-button');
  const submitButton = form ? form.querySelector('button[type="submit"]') : null;
  const defaultButtonText = submitButton ? submitButton.textContent : 'Check Food Instructions';
  let suggestionDebounceTimer = null;
  let suggestionAbortController = null;

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

  function getNestedValue(object, path) {
    return path.reduce(function (current, key) {
      return current && current[key] !== undefined && current[key] !== null ? current[key] : undefined;
    }, object);
  }

  function firstValue() {
    for (let index = 0; index < arguments.length; index += 1) {
      const value = arguments[index];
      if (value !== undefined && value !== null && value !== '') {
        if (Array.isArray(value) && !value.length) {
          continue;
        }
        return value;
      }
    }
    return '';
  }

  function asArray(value) {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  function formatValue(value) {
    if (Array.isArray(value)) {
      return value.map(formatValue).filter(Boolean).join(', ');
    }

    if (value && typeof value === 'object') {
      return value.name || value.term || value.category || value.label || value.title || value.text || '';
    }

    return value || '';
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
    if (typeof suggestion === 'string') {
      return suggestion;
    }
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
      return `<button class="suggestion-item" type="button" role="option" data-suggestion-name="${escapeHtml(name)}" id="suggestion-${index}">${escapeHtml(name)}</button>`;
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
        headers: { Accept: 'application/json' },
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

  function formatDateTime(value) {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return escapeHtml(value);
    }
    return escapeHtml(date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
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

  function renderFriendlyMessage(title, message) {
    showResult(`<span class="result-topline">Search needed</span><h2>${escapeHtml(title)}</h2><div class="result-status result-status-warning">${escapeHtml(message)}</div>`);
  }

  function renderLoading(drugName) {
    showResult(`
      <span class="result-topline">FDA label scan in progress</span>
      <h2>Checking food and beverage label language for: ${escapeHtml(drugName)}</h2>
      <div class="loading-card"><span class="loading-spinner" aria-hidden="true"></span><div><strong>Searching FDA labeling...</strong><p>Reviewing available label language for food, meals, fasting, grapefruit/citrus, dairy, minerals, alcohol, supplements, tube feeding, and administration instructions.</p></div></div>
    `, false);
  }

  function getQuickAnswer(data) {
    if (data.status === 'no_results') {
      return NO_LABEL_MESSAGE;
    }
    if (data.status === 'no_food_language_found') {
      return NO_FOOD_LANGUAGE_MESSAGE;
    }
    return firstValue(data.quickAnswer, getNestedValue(data, ['aiSummary', 'quickAnswer']), getNestedValue(data, ['aiSummary', 'plainEnglishSummary']), FALLBACK_QUICK_ANSWER);
  }

  function getPracticalTakeaway(data) {
    if (data.status === 'no_results') {
      return NO_LABEL_MESSAGE;
    }
    if (data.status === 'no_food_language_found') {
      return NO_FOOD_LANGUAGE_MESSAGE;
    }
    return firstValue(data.practicalTakeaway, getNestedValue(data, ['aiSummary', 'practicalTakeaway']), getNestedValue(data, ['aiSummary', 'patientFriendlyCaution']));
  }

  function getFoodBadge(data) {
    return firstValue(data.foodSafetyBadge, getNestedValue(data, ['aiSummary', 'foodSafetyBadge']), data.status === 'no_food_language_found' ? 'No FDA-label concern found' : '', data.status === 'no_results' ? 'Ask a pharmacist' : 'Follow label directions');
  }

  function getResultDisclaimer(data) {
    return firstValue(data.disclaimer, DEFAULT_DISCLAIMER);
  }

  function renderBadge(value, className) {
    if (!value) {
      return '';
    }
    return `<span class="result-badge ${className || ''}">${escapeHtml(formatValue(value))}</span>`;
  }

  function renderChipGroup(title, values) {
    const items = asArray(values).map(formatValue).filter(Boolean);
    if (!items.length) {
      return '';
    }
    return `<div class="result-chip-group"><span>${escapeHtml(title)}:</span><div class="term-chip-list">${items.map(function (item) {
      return `<span class="term-chip">${escapeHtml(item)}</span>`;
    }).join('')}</div></div>`;
  }

  function renderWarnings(warnings) {
    const items = asArray(warnings).filter(Boolean);
    if (!items.length) {
      return '';
    }
    return `<section class="result-section-card warning-card"><h3>Important FDA label warnings found</h3><div class="warning-list">${items.map(function (warning) {
      const term = formatValue(firstValue(warning.term, warning.matchedTerm, warning.name, warning.category));
      const category = formatValue(firstValue(warning.category, warning.type));
      const explanation = firstValue(warning.explanation, warning.summary, warning.whatTheLabelSays, warning.whyItMatters, warning.text, warning.warning, formatValue(warning));
      return `<article class="warning-item"><h4>${escapeHtml([term, category].filter(Boolean).join(' • ') || 'FDA label warning')}</h4><p>${escapeHtml(explanation)}</p></article>`;
    }).join('')}</div></section>`;
  }

  function renderFindings(data) {
    const findings = asArray(firstValue(getNestedValue(data, ['aiSummary', 'findings']), data.labelFindings)).filter(Boolean);
    if (!findings.length) {
      return `<p>${escapeHtml(data.status === 'no_results' ? NO_LABEL_MESSAGE : data.status === 'no_food_language_found' ? NO_FOOD_LANGUAGE_MESSAGE : 'No specific label findings were returned.')}</p>`;
    }

    return `<div class="finding-card-list">${findings.map(function (finding) {
      if (typeof finding === 'string') {
        return `<article class="finding-card"><p>${escapeHtml(finding)}</p></article>`;
      }
      const matchedTerms = asArray(finding.matchedTerms || finding.terms).map(formatValue).filter(Boolean);
      return `<article class="finding-card">
        ${finding.category ? `<h4>${escapeHtml(finding.category)}</h4>` : '<h4>FDA label finding</h4>'}
        ${finding.severityLanguage ? `<p class="finding-severity">${escapeHtml(finding.severityLanguage)}</p>` : ''}
        ${finding.whatTheLabelSays ? `<p><strong>What the label says:</strong> ${escapeHtml(finding.whatTheLabelSays)}</p>` : ''}
        ${finding.whyItMatters ? `<p><strong>Why it matters:</strong> ${escapeHtml(finding.whyItMatters)}</p>` : ''}
        ${matchedTerms.length ? `<p class="finding-meta"><strong>Matched terms:</strong> ${escapeHtml(matchedTerms.join(', '))}</p>` : ''}
        ${finding.sourceSection ? `<p class="finding-meta"><strong>Source section:</strong> ${escapeHtml(finding.sourceSection)}</p>` : ''}
      </article>`;
    }).join('')}</div>`;
  }

  function normalizeMedlinePlus(data) {
    return firstValue(data.medlinePlus, getNestedValue(data, ['drugSummary', 'medlinePlus']));
  }

  function renderMedlinePlus(data) {
    const medlinePlus = normalizeMedlinePlus(data);
    if (!medlinePlus || typeof medlinePlus !== 'object') {
      return '';
    }
    const title = medlinePlus.title || medlinePlus.name || 'Medication information';
    const source = medlinePlus.source || medlinePlus.sourceLabel || medlinePlus.attribution || 'MedlinePlus, National Library of Medicine';
    const url = medlinePlus.url || medlinePlus.link || medlinePlus.href;
    const summary = medlinePlus.summary || medlinePlus.shortSummary || medlinePlus.description || medlinePlus.snippet || '';

    return `<section class="result-section-card drug-summary-card"><h3>Medication information</h3><p class="supplemental-note">Supplemental medication background only — FDA label excerpts above and below support the food/beverage conclusion.</p><div class="medline-card"><h4>${escapeHtml(title)}</h4><p class="medline-source">${escapeHtml(source)}</p>${summary ? `<p>${escapeHtml(summary)}</p>` : ''}${url ? `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Read more on MedlinePlus</a>` : ''}</div></section>`;
  }

  function findMatchingSource(excerpt, sources) {
    if (!Array.isArray(sources) || sources.length === 0) {
      return null;
    }
    return sources.find(function (source) {
      return source.setId && excerpt.setId && source.setId === excerpt.setId;
    }) || sources.find(function (source) {
      return source.title && (excerpt.sourceTitle || excerpt.productName) && source.title === (excerpt.sourceTitle || excerpt.productName);
    }) || sources[0];
  }

  function normalizeMatchedTerms(terms) {
    if (!terms) {
      return [];
    }
    if (Array.isArray(terms)) {
      return terms.map(formatValue).filter(Boolean);
    }
    return String(terms).split(',').map(function (term) { return term.trim(); }).filter(Boolean);
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
    const highlightTerms = normalizeMatchedTerms(matchedTerms).filter(function (term) { return term.length > 2; }).sort(function (a, b) { return b.length - a.length; });
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
    ranges.sort(function (a, b) { return a.start - b.start || b.end - a.end; });
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

  function renderExcerpts(excerpts, sources) {
    const excerptList = asArray(excerpts).filter(Boolean);
    if (!excerptList.length) {
      return '<p>No source excerpts were returned for this scan.</p>';
    }

    return `<p class="excerpt-count">${escapeHtml(`${excerptList.length} FDA label excerpt${excerptList.length === 1 ? '' : 's'} matched this scan.`)}</p><div class="excerpt-list">${excerptList.map(function (excerpt, index) {
      if (typeof excerpt === 'string') {
        return `<details class="excerpt-card" ${index === 0 ? 'open' : ''}><summary>FDA label excerpt ${index + 1}</summary><p>${escapeHtml(excerpt)}</p></details>`;
      }
      const matchingSource = findMatchingSource(excerpt, sources);
      const title = firstValue(excerpt.productName, excerpt.sourceTitle, excerpt.title, matchingSource && matchingSource.productName, matchingSource && matchingSource.title, 'FDA label excerpt');
      const section = firstValue(excerpt.sourceSection, excerpt.section, excerpt.labelSection);
      const matchedTerms = normalizeMatchedTerms(firstValue(excerpt.matchedTerms, excerpt.termsFound, excerpt.terms));
      const categories = asArray(firstValue(excerpt.categories, excerpt.categoriesFound, excerpt.category)).map(formatValue).filter(Boolean);
      const text = firstValue(excerpt.excerpt, excerpt.text, excerpt.snippet, 'Excerpt text was not available.');
      const effectiveDate = firstValue(excerpt.labelEffectiveDate, excerpt.effectiveTime, matchingSource && (matchingSource.labelEffectiveDate || matchingSource.effectiveTime));
      const href = firstValue(excerpt.dailyMedUrl, excerpt.sourceUrl, excerpt.url, excerpt.labelUrl, excerpt.link, matchingSource && matchingSource.dailyMedUrl);

      return `<details class="excerpt-card" ${index === 0 ? 'open' : ''}><summary><span>${escapeHtml(title)}</span>${href ? `<a class="excerpt-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">DailyMed</a>` : ''}</summary>
        <div class="excerpt-body">
          <div class="excerpt-meta">${section ? `<span>Section: ${escapeHtml(section)}</span>` : ''}${matchedTerms.length ? `<span>Matched: ${escapeHtml(matchedTerms.join(', '))}</span>` : ''}${categories.length ? `<span>Categories: ${escapeHtml(categories.join(', '))}</span>` : ''}${effectiveDate ? `<span>Effective: ${escapeHtml(effectiveDate)}</span>` : ''}</div>
          <p>${highlightMatchedTerms(text, matchedTerms)}</p>
        </div>
      </details>`;
    }).join('')}</div>`;
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

  function renderApiResult(data, rawDrugName) {
    const searchedDrug = firstValue(data.searchedDrug, rawDrugName);
    const matchedDrug = firstValue(data.drug, data.matchedDrug, data.productName);
    const status = firstValue(data.status, data.ok || data.success ? 'completed' : 'review needed');
    const quickAnswer = getQuickAnswer(data);
    const practicalTakeaway = getPracticalTakeaway(data);
    const sourceExcerpts = firstValue(data.sourceExcerpts, data.excerpts);

    showResult(`
      <div class="result-heading">
        <span class="result-topline">Search result</span>
        <h2>Food and beverage label scan</h2>
        <div class="result-summary-grid">
          <div><span>Medication searched</span><strong>${escapeHtml(searchedDrug)}</strong></div>
          ${matchedDrug ? `<div><span>FDA product matched</span><strong>${escapeHtml(matchedDrug)}</strong></div>` : ''}
          <div><span>Status</span>${renderBadge(String(status).replace(/_/g, ' '), 'status-badge')}</div>
        </div>
        ${renderMetadata(data)}
      </div>

      <div class="result-grid">
        <section class="result-section-card result-section-card-featured main-answer-card">
          <h3>Main answer</h3>
          <div class="badge-row">${renderBadge(getFoodBadge(data), 'food-badge')}</div>
          <p class="quick-answer">${escapeHtml(quickAnswer)}</p>
          ${renderChipGroup('Terms found', data.termsFound)}
          ${renderChipGroup('Categories found', data.categoriesFound)}
        </section>

        <section class="result-section-card practical-card">
          <h3>Practical takeaway</h3>
          <p>${escapeHtml(practicalTakeaway || 'Review the FDA label excerpts and ask a pharmacist or prescriber how the label applies to your dose, formulation, and routine.')}</p>
        </section>

        ${data.mctSafetyBadge ? `<section class="result-section-card mct-card"><h3>MCT oil / Tricaprin context</h3><p>${escapeHtml(formatValue(data.mctSafetyBadge))}</p></section>` : ''}
        ${renderWarnings(data.criticalDietWarnings)}

        <section class="result-section-card findings-section">
          <h3>Findings</h3>
          ${renderFindings(data)}
        </section>

        ${renderMedlinePlus(data)}

        <section class="result-section-card excerpt-section">
          <h3>Source excerpts</h3>
          <div class="sources-info-card"><span class="sources-info-icon" aria-hidden="true">i</span><p><strong>Transparency note:</strong> FDA label excerpts are shown so you can see the source language behind the summary. Some medications have multiple labels, manufacturers, doses, or formulations.</p></div>
          ${renderExcerpts(sourceExcerpts, data.sources)}
        </section>

        <div class="result-disclaimer result-disclaimer-card">${escapeHtml(getResultDisclaimer(data))}</div>
      </div>
    `);
  }

  function renderError(errorMessage, detail) {
    const technicalDetail = detail ? `<details class="technical-details"><summary>Technical details</summary><p>${escapeHtml(detail)}</p></details>` : '';
    showResult(`<span class="result-topline result-topline-error">Scan unavailable</span><h2>We could not complete the FDA label scan right now.</h2><div class="result-status result-status-error">Please try again in a moment. If the problem continues, try a brand name, generic name, or a more specific product name.</div>${technicalDetail}`);
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
    setLoadingState(true);
    renderLoading(drugName);

    try {
      const response = await fetch(`${API_BASE_URL}/check?drug=${encodeURIComponent(drugName)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json() : {};

      if (!response.ok || data.error) {
        renderError(data.error || `Request failed with status ${response.status}`, data.detail);
        return;
      }

      renderApiResult(data, drugName);
    } catch (error) {
      renderError(error.message);
    } finally {
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

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      input.value = chip.textContent.trim();
      runSearch(input.value);
    });
  });
}());
