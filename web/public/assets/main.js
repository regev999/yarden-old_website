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
      // The page behind the open menu can't be reached with Tab or a screen reader
      ['main', '.site-footer', '.actionbar', '.whatsapp'].forEach(function (sel) {
        var el = document.querySelector(sel);
        if (el) el.inert = open;
      });
    };
    btn.addEventListener('click', function () { setOpen(btn.getAttribute('aria-expanded') !== 'true'); });
    // A link inside the menu (or the header's booking button) closes it
    document.querySelector('.site-header').addEventListener('click', function (e) {
      if (e.target.closest('a[href]') && nav.classList.contains('is-open')) setOpen(false);
    });
    window.matchMedia('(min-width: 1141px)').addEventListener('change', function (m) { if (m.matches) setOpen(false); });
    // In the phone menu a section's name opens its list too (tap or keyboard), like its + button
    nav.querySelectorAll('.nav__label').forEach(function (label) {
      var toggle = label.parentNode.querySelector('.nav__toggle');
      var shown = function () { return toggle && getComputedStyle(toggle).display !== 'none'; };
      label.addEventListener('click', function () { if (shown()) toggle.click(); });
      label.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (shown()) { e.preventDefault(); toggle.click(); }
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) { btn.click(); btn.focus(); }
    });
  }
  // Header: a hairline once the page moves; on phones and tablets it steps aside
  // after a real scroll down and comes back after a real scroll up. Small moves,
  // the bounce at either end and the browser's own toolbar resizing the page
  // never make it jump.
  (function () {
    var root = document.documentElement;
    var header = document.querySelector('.site-header');
    var small = window.matchMedia('(max-width: 1140px)');
    var HIDE_AFTER = 64;   // px of continuous scrolling down
    var SHOW_AFTER = 40;   // px of continuous scrolling up
    var lastY = window.scrollY;
    var travel = 0;        // distance in the current direction
    var holdUntil = 0;
    var queued = false;
    var hidden = function () { return root.classList.contains('header-hidden'); };
    var hide = function (on) { if (hidden() !== on) root.classList.toggle('header-hidden', on); travel = 0; };
    var update = function () {
      queued = false;
      var y = window.scrollY;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      root.classList.toggle('scrolled', y > 4);
      if (Date.now() < holdUntil) { lastY = y; travel = 0; return; }
      if (!small.matches || root.classList.contains('menu-open') || y < 160) { hide(false); lastY = y; return; }
      // Rubber-band past either end: ignore
      if (y < 0 || y > max) { lastY = Math.max(0, Math.min(y, max)); return; }
      var dy = y - lastY;
      lastY = y;
      if (!dy) return;
      travel = (dy > 0) === (travel > 0) ? travel + dy : dy;
      if (travel > HIDE_AFTER && !hidden()) hide(true);
      else if (travel < -SHOW_AFTER && hidden()) hide(false);
    };
    window.addEventListener('scroll', function () {
      if (!queued) { queued = true; requestAnimationFrame(update); }
    }, { passive: true });
    // The toolbar of mobile browsers showing or hiding moves the page a little: not a scroll
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () { holdUntil = Date.now() + 300; });
    }
    small.addEventListener('change', update);
    update();
    // A jump within the page decides once, so the heading lands just under what stays on screen
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a || !small.matches || a.hash.length < 2) return;
      var target;
      try { target = document.getElementById(decodeURIComponent(a.hash.slice(1))); } catch (err) { return; }
      if (!target) return;
      var top = target.getBoundingClientRect().top;
      hide(top > 0 && window.scrollY + top > 160);
      holdUntil = Date.now() + 1000;
    });
    // Keyboard users reaching the header always see it
    if (header) header.addEventListener('focusin', function () { hide(false); holdUntil = Date.now() + 600; });
  })();

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
    f.src = 'https://www.youtube-nocookie.com/embed/' + box.dataset.yt + '?autoplay=1&rel=0&playsinline=1';
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

  // Warm up the connection to YouTube while the pointer (or a finger) is on
  // its way to a video, so it starts playing sooner. Only once videos are
  // allowed: before that, nothing is sent to YouTube.
  var warmed = false;
  function warmUp(e) {
    if (warmed || !e.target.closest || !e.target.closest('.video__play')) return;
    if (window.YKConsent && !window.YKConsent.allowed('media')) return;
    warmed = true;
    ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://i.ytimg.com', 'https://www.google.com'].forEach(function (h) {
      var l = document.createElement('link');
      l.rel = 'preconnect';
      l.href = h;
      l.crossOrigin = '';
      document.head.appendChild(l);
    });
  }
  document.addEventListener('pointerover', warmUp, { passive: true });
  document.addEventListener('touchstart', warmUp, { passive: true });
  document.addEventListener('focusin', warmUp);

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
    var current = null;
    var settle = 0;
    // Slide the chip row to the current section only once the page has stopped
    // moving, so it never competes with the page's own scrolling
    var centre = function () {
      if (!current) return;
      var r = current.getBoundingClientRect();
      var box = inner.getBoundingClientRect();
      inner.scrollBy({ left: (r.left + r.width / 2) - (box.left + box.width / 2), behavior: 'smooth' });
    };
    window.addEventListener('scroll', function () { clearTimeout(settle); settle = setTimeout(centre, 180); }, { passive: true });
    var mark = function (a) {
      if (a === current) return;
      if (current) current.removeAttribute('aria-current');
      current = a;
      a.setAttribute('aria-current', 'true');
      clearTimeout(settle);
      settle = setTimeout(centre, 180);
    };
    inner.addEventListener('click', function (e) { var a = e.target.closest('a'); if (a) mark(a); });
    if (!('IntersectionObserver' in window)) return;
    // The section whose heading is in the upper part of the screen is the one being read
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) mark(links[heads.indexOf(e.target)]); });
    }, { rootMargin: '-12% 0px -68% 0px' });
    heads.forEach(function (h) { io.observe(h); });
  })();

  // Blog: filter the publications as you type
  var topics = document.querySelector('.topic-nav');
  if (topics) {
    var items = [].slice.call(document.querySelectorAll('.year .entries > li'));
    var box = document.createElement('div');
    box.className = 'finder';
    box.innerHTML = '<label class="finder__label" for="finder">חיפוש בבלוג</label>' +
      '<input id="finder" class="finder__input" type="search" placeholder="מילה מהכותרת, למשל: טראומה" autocomplete="off">' +
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
  document.querySelectorAll('main > section.block .prose, main .vision').forEach(function (p) {
    var min = p.classList.contains('vision') ? 500 : 1400;
    if (p.closest('.article, details, .quote, .readmore') || p.textContent.length < min) return;
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

  // Purchases (Cardcom): a product's button, or a payment link's form, opens the secure payment page
  function checkout(payload, done) {
    payload.returnPath = location.pathname;
    return fetch('/api/checkout/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (r) {
        if (r.ok && r.body.url) { location.href = r.body.url; return; }
        throw new Error(r.body.error || '');
      })
      .catch(function (err) { done(err.message || 'לא הצלחנו לפתוח את עמוד התשלום. נסו שוב, או צרו קשר בטלפון.'); });
  }
  document.querySelectorAll('[data-checkout]').forEach(function (btn) {
    var note = document.createElement('p');
    note.className = 'buy-status';
    note.setAttribute('role', 'status');
    btn.after(note);
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      var label = btn.textContent;
      btn.dataset.label = label;
      btn.disabled = true;
      btn.textContent = 'רגע…';
      note.textContent = '';
      checkout({ slug: btn.getAttribute('data-checkout') }, function (msg) {
        btn.disabled = false;
        btn.textContent = label;
        note.textContent = msg;
      });
    });
  });
  document.querySelectorAll('form[data-checkout-token]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = form.querySelector('.form__status');
      var button = form.querySelector('button[type="submit"]');
      var v = function (n) { return form.elements[n].value.trim(); };
      var missing = [['name', 'שם מלא'], ['phone', 'טלפון'], ['email', 'מייל']].filter(function (f) { return !v(f[0]); });
      if (missing.length) { status.textContent = 'נא למלא: ' + missing.map(function (f) { return f[1]; }).join(', '); form.elements[missing[0][0]].focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) { status.textContent = 'כתובת המייל לא תקינה.'; form.elements.email.focus(); return; }
      button.disabled = true;
      status.textContent = 'מעבירים לעמוד התשלום…';
      checkout({ token: form.getAttribute('data-checkout-token'), name: v('name'), phone: v('phone'), email: v('email') }, function (msg) {
        button.disabled = false;
        status.textContent = msg;
      });
    });
  });
  // Back from Cardcom with the browser's back button, the page comes back as it
  // was left (buttons disabled, "רגע…"): make it usable again
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    document.querySelectorAll('[data-checkout], form[data-checkout-token] button[type="submit"]').forEach(function (b) {
      b.disabled = false;
      if (b.dataset.label) b.textContent = b.dataset.label;
    });
    document.querySelectorAll('form[data-checkout-token] .form__status, .buy-status').forEach(function (s) { s.textContent = ''; });
  });

  // Back from Cardcom: say how it went, once
  (function () {
    var result = new URLSearchParams(location.search).get('payment');
    if (result !== 'success' && result !== 'failed') return;
    var ok = result === 'success';
    var box = document.createElement('div');
    box.className = 'pay-toast' + (ok ? ' pay-toast--ok' : '');
    box.setAttribute('role', 'status');
    box.innerHTML = '<p><b></b><span></span></p><button type="button" aria-label="סגירה">×</button>';
    box.querySelector('b').textContent = ok ? 'התשלום התקבל, תודה.' : 'התשלום לא הושלם.';
    box.querySelector('span').textContent = ok ? 'אישור וחשבונית יגיעו אליכם במייל.' : 'לא חויבתם. אפשר לנסות שוב מתי שנוח, או ליצור קשר.';
    box.querySelector('button').addEventListener('click', function () { box.remove(); });
    document.body.appendChild(box);
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  })();

  // Forms: post to the site's endpoint, or fall back to the visitor's mail app
  var cfg = window.SITE_FORM || {};
  document.querySelectorAll('form[data-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = form.querySelector('.form__status');
      var button = form.querySelector('button[type="submit"]');
      var data = new FormData(form);
      data.set('form', form.dataset.form);
      data.set('page', location.pathname);
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
