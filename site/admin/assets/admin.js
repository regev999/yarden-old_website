(function () {
  // Filters apply as soon as a dropdown changes
  document.querySelectorAll('[data-autosubmit]').forEach(function (el) {
    el.addEventListener('change', function () { el.form.submit(); });
  });

  // Whole table row opens the item (links inside still work normally)
  document.querySelectorAll('tr[data-href]').forEach(function (tr) {
    tr.addEventListener('click', function (e) {
      if (e.target.closest('a, button, input')) return;
      location.href = tr.dataset.href;
    });
  });

  // Confirm destructive actions
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!confirm(f.dataset.confirm)) e.preventDefault();
    });
  });

  // SEO: live character counters and Google preview
  var form = document.querySelector('[data-seo-form]');
  if (form) {
    form.querySelectorAll('[data-count]').forEach(function (field) {
      var counter = field.parentElement.querySelector('[data-counter]');
      var max = +field.dataset.count, min = +(field.dataset.min || 0);
      var preview = document.querySelector('[data-preview="' + field.name + '"]');
      var suffix = field.dataset.suffix || '';
      function update() {
        var n = field.value.length, label = ' תווים';
        if (suffix && field.value.slice(-suffix.length) === suffix) {
          n -= suffix.length;
          label = ' תווים בשם העמוד (בלי שם האתר שבסוף)';
        }
        counter.textContent = n + label + ' · מומלץ ' + (min ? min + '–' : 'עד ') + max;
        counter.classList.toggle('is-over', n > max);
        counter.classList.toggle('is-under', min > 0 && n > 0 && n < min);
        if (preview) preview.textContent = field.value.length > max + 10 ? field.value.slice(0, max) + '…' : field.value;
      }
      field.addEventListener('input', update);
      update();
    });
  }
})();
