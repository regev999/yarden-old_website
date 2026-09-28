(function () {
  // Mobile menu
  var btn = document.querySelector('.menu-btn');
  var nav = document.getElementById('nav');
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) { btn.click(); btn.focus(); }
    });
  }
  document.querySelectorAll('.nav__toggle').forEach(function (t) {
    t.addEventListener('click', function () {
      var li = t.parentElement;
      var open = !li.classList.contains('is-open');
      li.classList.toggle('is-open', open);
      t.setAttribute('aria-expanded', String(open));
    });
  });

  // Testimonials: one at a time, advanced by the visitor
  var voices = document.querySelector('[data-voices]');
  if (voices) {
    var items = voices.querySelectorAll('.voice');
    var count = document.querySelector('[data-voices-count]');
    var at = 0;
    document.querySelector('[data-voices-next]').addEventListener('click', function () {
      items[at].hidden = true;
      at = (at + 1) % items.length;
      items[at].hidden = false;
      count.textContent = (at + 1) + ' מתוך ' + items.length;
    });
  }

  // Click-to-play YouTube (lighter pages, no tracking until played)
  document.addEventListener('click', function (e) {
    var play = e.target.closest('.video__play');
    if (!play) return;
    var box = play.parentElement;
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + box.dataset.yt + '?autoplay=1&rel=0';
    f.title = play.getAttribute('aria-label') || 'YouTube';
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    f.allowFullscreen = true;
    box.replaceChildren(f);
  });

  // Hide images whose files have not been uploaded yet
  document.querySelectorAll('main img').forEach(function (img) {
    function hide() {
      var fig = img.closest('figure');
      (fig || img).classList.add('is-missing');
    }
    if (img.complete && img.naturalWidth === 0) hide();
    else img.addEventListener('error', hide);
  });

  // Remember which product a visitor chose, so the lead says "therapy" or "course"
  function setProduct(p) {
    document.querySelectorAll('form[data-form="contact"] [name="product"]').forEach(function (i) { i.value = p; });
    try { sessionStorage.setItem('product', p); } catch (e) {}
  }
  try { if (sessionStorage.getItem('product')) setProduct(sessionStorage.getItem('product')); } catch (e) {}
  document.querySelectorAll('[data-product]').forEach(function (a) {
    a.addEventListener('click', function () { setProduct(a.dataset.product); });
  });

  // Forms: post to the site's endpoint, or fall back to the visitor's mail app
  var cfg = window.SITE_FORM || {};
  document.querySelectorAll('form[data-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = form.querySelector('.form__status');
      var button = form.querySelector('button[type="submit"]');
      var data = new FormData(form);
      data.append('form', form.dataset.form);
      data.append('page', location.pathname);
      if (cfg.endpoint) {
        status.textContent = 'שולח…';
        button.disabled = true;
        fetch(cfg.endpoint, { method: 'POST', body: data, headers: { Accept: 'application/json' } })
          .then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (body) {
              if (!r.ok || !body.ok) throw new Error(body.error || '');
            });
          })
          .then(function () {
            form.reset();
            status.textContent = form.dataset.form === 'newsletter'
              ? 'תודה! נרשמת לעדכונים.'
              : 'תודה! הפרטים התקבלו ואחזור אליך בהקדם.';
          })
          .catch(function (err) {
            status.textContent = err.message || ('השליחה לא הצליחה. אפשר להתקשר או לכתוב ישירות אל ' + cfg.email);
          })
          .then(function () { button.disabled = false; });
        return;
      }
      var subject = form.dataset.form === 'newsletter' ? 'הרשמה לעדכונים מהאתר' : 'פנייה מהאתר';
      var lines = [];
      data.forEach(function (v, k) {
        var labels = { name: 'שם', phone: 'טלפון', email: 'דוא"ל', message: 'הודעה' };
        if (labels[k] && v) lines.push(labels[k] + ': ' + v);
      });
      location.href = 'mailto:' + cfg.email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(lines.join('\n'));
      status.textContent = 'נפתחה תוכנת הדואר לשליחת הפנייה.';
    });
  });
})();
