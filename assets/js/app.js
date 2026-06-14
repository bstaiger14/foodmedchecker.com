(function () {
  const API_BASE_URL = 'https://foodmedchecker-api.curly-lake-5061.workers.dev';
  const DEFAULT_DISCLAIMER = 'Food Med Checker summarizes FDA labeling for educational purposes only. It is not medical advice and does not replace guidance from a pharmacist, physician, or other qualified healthcare professional.';

  const form = document.querySelector('#med-search-form');
  const input = document.querySelector('#medication-input');
  const resultCard = document.querySelector('#result-card');
  const year = document.querySelector('#year');
  const chips = document.querySelectorAll('.example-chip');
  const submitButton = form ? form.querySelector('button[type="submit"]') : null;
  const defaultButtonText = submitButton ? submitButton.textContent : 'Check Food Instructions';

  if (year) {
    year.textContent = new Date().getFullYear();
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

  function renderExcerpts(excerpts) {
    if (!Array.isArray(excerpts) || excerpts.length === 0) {
      return '<p>No source excerpts were returned for this scan.</p>';
    }

    return `<div class="excerpt-list">${excerpts.map(function (excerpt) {
      const title = excerpt.sourceTitle || 'FDA label excerpt';
      const section = excerpt.section ? `<span>${escapeHtml(excerpt.section)}</span>` : '';
      const matchedTerms = formatValue(excerpt.matchedTerms);
      const terms = matchedTerms ? `<span>Matched: ${escapeHtml(matchedTerms)}</span>` : '';
      const text = excerpt.text || 'Excerpt text was not available.';

      return `
        <article class="excerpt-card">
          <h4>${escapeHtml(title)}</h4>
          ${section || terms ? `<div class="excerpt-meta">${section}${terms}</div>` : ''}
          <p>${escapeHtml(text)}</p>
        </article>
      `;
    }).join('')}</div>`;
  }

  function renderSources(sources) {
    if (!Array.isArray(sources) || sources.length === 0) {
      return '';
    }

    return `
      <section class="result-section-card sources-card">
        <h3>Sources / Label Links</h3>
        <div class="source-list">
          ${sources.map(function (source) {
            const title = source.title || source.brandName || source.genericName || 'FDA label source';
            const details = [source.brandName, source.genericName, source.manufacturer, source.effectiveTime ? `Effective: ${source.effectiveTime}` : ''].filter(Boolean);
            const setId = source.setId ? `<p class="source-id">Set ID: ${escapeHtml(source.setId)}</p>` : '';
            const link = source.dailyMedUrl ? `<a class="source-link" href="${escapeHtml(source.dailyMedUrl)}" target="_blank" rel="noopener noreferrer">View label on DailyMed</a>` : '';

            return `
              <article class="source-card">
                <h4>${escapeHtml(title)}</h4>
                ${details.length ? `<p>${escapeHtml(details.join(' • '))}</p>` : ''}
                ${setId}
                ${link}
              </article>
            `;
          }).join('')}
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
        <section class="result-section-card">
          <h3>FDA Label Food Findings</h3>
          ${renderList(data.labelFindings, getFindingFallback(data.status))}
        </section>
        <section class="result-section-card">
          <h3>Specific Food/Diet Terms Found</h3>
          ${renderTermChips(data.termsFound)}
        </section>
        <section class="result-section-card excerpt-section">
          <h3>Source Excerpts</h3>
          ${renderExcerpts(data.sourceExcerpts)}
        </section>
        ${renderSources(data.sources)}
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
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      input.value = chip.textContent.trim();
      runSearch(input.value);
    });
  });
}());
