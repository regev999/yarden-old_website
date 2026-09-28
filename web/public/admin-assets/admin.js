(function () {
  // Sidebar on small screens
  var side = document.getElementById('side');
  var scrim = document.querySelector('[data-close-side]');
  var toggle = document.querySelector('[data-toggle-side]');
  function setSide(open) {
    if (!side) return;
    side.classList.toggle('is-open', open);
    scrim.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }
  if (toggle) toggle.addEventListener('click', function () { setSide(!side.classList.contains('is-open')); });
  if (scrim) scrim.addEventListener('click', function () { setSide(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setSide(false); });

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

  // Copy a link to the clipboard
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var url = location.origin + b.dataset.copy;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () {
        var t = b.textContent; b.textContent = 'הועתק'; setTimeout(function () { b.textContent = t; }, 1500);
      }, function () { prompt('העתיקו את הקישור:', url); });
    });
  });

  // Drag files onto the upload area
  document.querySelectorAll('[data-dropzone]').forEach(function (z) {
    ['dragenter', 'dragover'].forEach(function (ev) { z.addEventListener(ev, function () { z.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { z.addEventListener(ev, function () { z.classList.remove('is-over'); }); });
  });

  // Live character counters (SEO fields) and the Google preview
  var form = document.querySelector('[data-seo-form]') || document.querySelector('#post-form');
  if (form) {
    form.querySelectorAll('[data-count]').forEach(function (field) {
      var counter = field.parentElement.querySelector('[data-counter]');
      if (!counter) return;
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
