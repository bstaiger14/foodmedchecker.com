(function () {
  const API_BASE_URL = 'https://foodmedchecker-api.curly-lake-5061.workers.dev';
  const DEFAULT_DISCLAIMER = 'Food Med Checker summarizes FDA labeling for educational purposes only. It is not medical advice and does not replace guidance from a pharmacist, physician, or other qualified healthcare professional.';

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
        <div>
          <strong>Searching FDA labeling...</strong>
          <p>Reviewing available label language for food, meal, fasting, diet, and administration terms.</p>
        </div>
      </div>
    `, false);
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
      const text = excerpt.text || 'Excerpt text was not available.';
      const brandName = excerpt.brandName || (matchingSource ? matchingSource.brandName : '');
      const genericName = excerpt.genericName || (matchingSource ? matchingSource.genericName : '');
      const manufacturer = excerpt.manufacturer || (matchingSource ? matchingSource.manufacturer : '');
      const effectiveTime = excerpt.effectiveTime || (matchingSource ? matchingSource.effectiveTime : '');
      const setIdValue = excerpt.setId || (matchingSource ? matchingSource.setId : '');
      const sourceDetails = [brandName, genericName, manufacturer, effectiveTime ? `Effective: ${effectiveTime}` : ''].filter(Boolean);
      const setId = setIdValue ? `<p class="source-id">Set ID: ${escapeHtml(setIdValue)}</p>` : '';
      const href = excerpt.dailyMedUrl || excerpt.sourceUrl || excerpt.url || excerpt.labelUrl || excerpt.link || (matchingSource ? matchingSource.dailyMedUrl : '');
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
          <p>${escapeHtml(text)}</p>
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
      metadata.push(`FDA label records scanned: ${escapeHtml(data.recordCount)} <span class="sources-info"><button class="sources-info-trigger" type="button" aria-label="Why are there so many sources?" aria-describedby="sources-info-text">i</button><span class="sources-info-tooltip" id="sources-info-text" role="tooltip">Why are there so many sources? This checker searches all FDA labels. Most drugs have multiple manufacturers, and each is required to submit unique labels to the FDA. We search all of them.</span></span>`);
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
          ${renderExcerpts(data.sourceExcerpts, data.sources)}
        </section>
      </div>
      <div class="result-disclaimer">${escapeHtml(data.disclaimer || DEFAULT_DISCLAIMER)}</div>
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
