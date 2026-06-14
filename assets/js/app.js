(function () {
  const form = document.querySelector('#med-search-form');
  const input = document.querySelector('#medication-input');
  const resultCard = document.querySelector('#result-card');
  const year = document.querySelector('#year');
  const chips = document.querySelectorAll('.example-chip');

  if (year) {
    year.textContent = new Date().getFullYear();
  }

  function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, function (character) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[character];
    });
  }

  function renderPlaceholderResult(rawDrugName) {
    const drugName = escapeHtml(rawDrugName.trim());

    resultCard.innerHTML = `
      <span class="result-topline">MVP placeholder result</span>
      <h2>Food instructions for: ${drugName}</h2>
      <div class="result-status">FDA label search endpoint not connected yet. This MVP page is ready for the Worker API.</div>
      <div class="result-grid">
        <section class="result-section-card">
          <h3>Quick Answer</h3>
          <p>Endpoint not connected yet.</p>
        </section>
        <section class="result-section-card">
          <h3>Practical Takeaway</h3>
          <p>This front-end MVP is ready. Once the Worker API is connected, this section will summarize FDA label language related to food, meals, fasting, and diet-related instructions.</p>
        </section>
        <section class="result-section-card">
          <h3>FDA Label Food Findings</h3>
          <p>The real FDA label search will appear here.</p>
        </section>
        <section class="result-section-card">
          <h3>Specific Food/Diet Terms Found</h3>
          <p>Food, meal, fasting, high-fat meal, grapefruit, dairy, minerals, alcohol, tube feeding.</p>
        </section>
        <section class="result-section-card">
          <h3>Source Excerpts</h3>
          <p>FDA label excerpts will appear here once the API is connected.</p>
        </section>
      </div>
    `;

    resultCard.classList.remove('hidden');
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (form && input && resultCard) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const drugName = input.value.trim();

      if (!drugName) {
        input.focus();
        return;
      }

      renderPlaceholderResult(drugName);
    });
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      input.value = chip.textContent.trim();
      renderPlaceholderResult(input.value);
    });
  });
}());
