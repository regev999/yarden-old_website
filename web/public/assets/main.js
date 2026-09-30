(function () {
  // Mobile menu
  var btn = document.querySelector('.menu-btn');
  var nav = document.getElementById('nav');
  if (btn && nav) {
    var setOpen = function (open) {
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'סגירה' : 'תפריט';
      nav.classList.toggle('is-open', open);
      document.documentElement.classList.toggle('menu-open', open);
    };
    btn.addEventListener('click', function () { setOpen(btn.getAttribute('aria-expanded') !== 'true'); });
    // A link inside the menu (or the header's booking button) closes it
    document.querySelector('.site-header').addEventListener('click', function (e) {
      if (e.target.closest('a[href]') && nav.classList.contains('is-open')) setOpen(false);
    });
    window.matchMedia('(min-width: 1141px)').addEventListener('change', function (m) { if (m.matches) setOpen(false); });
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
  function playVideo(box) {
    var play = box.querySelector('.video__play');
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + box.dataset.yt + '?autoplay=1&rel=0';
    f.title = play.getAttribute('aria-label') || 'YouTube';
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    f.allowFullscreen = true;
    box.replaceChildren(f);
  }

  // YouTube stores its own cookies, so videos wait for "embedded content" consent.
  function askForVideo(box) {
    if (box.querySelector('.video__consent')) return;
    var id = box.dataset.yt;
    var note = document.createElement('div');
    note.className = 'video__consent';
    note.setAttribute('role', 'group');
    note.setAttribute('aria-label', 'הסכמה להפעלת סרטון');
    note.innerHTML = '<p>הסרטון מגיע מיוטיוב, שעשויה לשמור עוגיות. להפעיל אותו כאן?</p>' +
      '<div><button type="button" class="btn btn--paper btn--sm" data-yes>להפעיל ולאשר סרטונים</button> ' +
      '<a class="video__out" href="https://www.youtube.com/watch?v=' + id + '" target="_blank" rel="noopener">לצפייה ביוטיוב</a></div>';
    box.appendChild(note);
    note.querySelector('[data-yes]').focus();
    note.querySelector('[data-yes]').addEventListener('click', function () {
      if (window.YKConsent) window.YKConsent.grant('media');
      playVideo(box);
    });
  }

  document.addEventListener('click', function (e) {
    var play = e.target.closest('.video__play');
    if (!play) return;
    var box = play.parentElement;
    if (window.YKConsent && !window.YKConsent.allowed('media')) askForVideo(box);
    else playVideo(box);
  });

  // In-page contents: a sticky row of links to the page's sections
  (function () {
    var hero = document.querySelector('main > .page-hero');
    if (!hero || document.querySelector('.article')) return;
    var heads = [].slice.call(document.querySelectorAll('main > section.block > .wrap > h2.heading, main > section.block > .wrap > .split > h2.heading'))
      .filter(function (h) { return h.textContent.trim().length > 1 && !h.closest('.block--contact'); });
    if (heads.length < 3) return;
    var nav = document.createElement('nav');
    nav.className = 'toc';
    nav.setAttribute('aria-label', 'בעמוד הזה');
    var inner = document.createElement('div');
    inner.className = 'wrap toc__inner';
    var links = heads.map(function (h, i) {
      var sec = h.closest('section');
      if (!sec.id) sec.id = 'part-' + (i + 1);
      var a = document.createElement('a');
      a.href = '#' + sec.id;
      a.textContent = h.textContent.replace(/[:：]\s*$/, '').trim();
      inner.appendChild(a);
      return a;
    });
    nav.appendChild(inner);
    hero.after(nav);
    if (!('IntersectionObserver' in window)) return;
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var a = links[heads.indexOf(e.target)];
        if (current) current.removeAttribute('aria-current');
        current = a;
        a.setAttribute('aria-current', 'true');
        a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    heads.forEach(function (h) { io.observe(h); });
  })();

  // Blog: filter the publications as you type
  var topics = document.querySelector('.topic-nav');
  if (topics) {
    var items = [].slice.call(document.querySelectorAll('.year .entries > li'));
    var box = document.createElement('div');
    box.className = 'finder';
    box.innerHTML = '<label class="finder__label" for="finder">חיפוש בבלוג</label>' +
      '<input id="finder" class="finder__input" type="search" placeholder="מילה מהכותרת או מהתקציר, למשל: טראומה" autocomplete="off">' +
      '<p class="finder__count" role="status" aria-live="polite"></p>';
    topics.before(box);
    var input = box.querySelector('input');
    var count = box.querySelector('.finder__count');
    var norm = function (t) { return t.toLowerCase().replace(/["'׳״]/g, ''); };
    var texts = items.map(function (li) { return norm(li.textContent); });
    input.addEventListener('input', function () {
      var q = norm(input.value.trim());
      var n = 0;
      items.forEach(function (li, i) {
        var hit = !q || texts[i].indexOf(q) !== -1;
        li.hidden = !hit;
        if (hit) n++;
      });
      document.querySelectorAll('.year').forEach(function (y) { y.hidden = !y.querySelector('.entries > li:not([hidden])'); });
      topics.hidden = !!q;
      count.textContent = q ? (n ? (n === 1 ? 'נמצא פרסום אחד' : 'נמצאו ' + n + ' פרסומים') : 'לא נמצאו פרסומים. אפשר לנסות מילה אחרת.') : '';
    });
  }

  // Long testimonials: a button to read the whole thing, only where it's cut off
  document.querySelectorAll('.quote:not(.is-open) blockquote').forEach(function (q) {
    if (q.scrollHeight <= q.clientHeight + 8) { q.style.webkitMaskImage = 'none'; q.style.maskImage = 'none'; return; }
    var fig = q.closest('.quote');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'quote__more';
    b.setAttribute('aria-expanded', 'false');
    b.textContent = 'להמשך ההמלצה';
    q.after(b);
    b.addEventListener('click', function () {
      var open = fig.classList.toggle('is-open');
      b.setAttribute('aria-expanded', String(open));
      b.textContent = open ? 'לקצר' : 'להמשך ההמלצה';
    });
  });

  // Reading progress on articles
  var article = document.querySelector('.article');
  if (article) {
    var bar = document.createElement('div');
    bar.className = 'progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    var tick = function () {
      var r = article.getBoundingClientRect();
      var total = r.height - window.innerHeight * 0.6;
      bar.style.setProperty('--p', Math.min(1, Math.max(0, -r.top / (total > 0 ? total : 1))).toFixed(3));
    };
    window.addEventListener('scroll', tick, { passive: true });
    tick();
  }

  // Long blocks of text open on request instead of filling the screen
  document.querySelectorAll('main > section.block .prose').forEach(function (p) {
    if (p.closest('.article, details, .quote, .readmore') || p.textContent.length < 1400) return;
    var box = document.createElement('div');
    box.className = 'readmore is-closed';
    var body = document.createElement('div');
    body.className = 'readmore__body';
    body.id = 'rm-' + Math.random().toString(36).slice(2, 8);
    p.replaceWith(box);
    body.appendChild(p);
    box.appendChild(body);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'readmore__btn';
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', body.id);
    b.textContent = 'להמשך קריאה';
    box.appendChild(b);
    b.addEventListener('click', function () {
      var open = box.classList.toggle('is-closed') === false;
      b.setAttribute('aria-expanded', String(open));
      b.textContent = open ? 'לקצר' : 'להמשך קריאה';
      if (!open) box.scrollIntoView({ block: 'nearest' });
    });
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
