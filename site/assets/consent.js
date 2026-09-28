/*
 * Cookie consent that actually controls what runs.
 *
 * - Nothing optional loads until the visitor chooses. Scripts that need
 *   consent are written as <script type="text/plain" data-consent="analytics"
 *   data-src="..."> and are only turned into real scripts after approval.
 * - The choice is stored for 180 days in the "yk_consent" cookie and can be
 *   changed any time from the footer link ("הגדרות עוגיות").
 * - Google Consent Mode v2 starts as "denied" and is updated from the choice.
 * - YouTube videos ask before loading when "embedded content" isn't approved.
 */
(function () {
  var NAME = 'yk_consent';
  var VERSION = 1;
  var DAYS = 180;
  var CATEGORIES = [
    { id: 'necessary', title: 'הכרחיות', text: 'שומרות את בחירת העוגיות ואת הגדרות הנגישות. בלעדיהן האתר לא יעבוד כמו שצריך, ולכן הן תמיד פעילות.', locked: true },
    { id: 'analytics', title: 'סטטיסטיקה', text: 'עוזרות להבין כמה אנשים מבקרים באתר ובאילו עמודים, בלי לזהות אתכם אישית.' },
    { id: 'marketing', title: 'שיווק', text: 'מאפשרות למדוד פרסום ולהציג תוכן מותאם ברשתות חברתיות.' },
    { id: 'media', title: 'תוכן מוטמע (יוטיוב)', text: 'נדרשות כדי לנגן סרטונים מיוטיוב בתוך האתר. יוטיוב עשויה לשמור עוגיות משלה.' }
  ];

  /* ------------------------------------------------------------ storage */
  function read() {
    var m = document.cookie.match(/(?:^|; )yk_consent=([^;]*)/);
    if (!m) return null;
    try {
      var v = JSON.parse(decodeURIComponent(m[1]));
      return v && v.v === VERSION ? v : null;
    } catch (e) { return null; }
  }
  function write(choice) {
    var v = { v: VERSION, t: new Date().toISOString().slice(0, 10) };
    CATEGORIES.forEach(function (c) { v[c.id] = c.locked ? true : !!choice[c.id]; });
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = NAME + '=' + encodeURIComponent(JSON.stringify(v)) + '; Max-Age=' + DAYS * 86400 + '; Path=/; SameSite=Lax' + secure;
    return v;
  }

  var state = read();
  var listeners = [];

  function allowed(cat) { return cat === 'necessary' || !!(state && state[cat]); }

  /* ------------------------------------------------- gated scripts, gtag */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: 'denied', functionality_storage: 'granted', security_storage: 'granted',
    wait_for_update: 500
  });

  function apply() {
    gtag('consent', 'update', {
      analytics_storage: allowed('analytics') ? 'granted' : 'denied',
      ad_storage: allowed('marketing') ? 'granted' : 'denied',
      ad_user_data: allowed('marketing') ? 'granted' : 'denied',
      ad_personalization: allowed('marketing') ? 'granted' : 'denied'
    });
    document.querySelectorAll('script[type="text/plain"][data-consent]').forEach(function (s) {
      if (!allowed(s.dataset.consent) || s.dataset.done) return;
      s.dataset.done = '1';
      var n = document.createElement('script');
      if (s.dataset.src) { n.src = s.dataset.src; n.async = true; } else { n.textContent = s.textContent; }
      s.parentNode.insertBefore(n, s.nextSibling);
    });
    document.documentElement.dataset.consentMedia = allowed('media') ? 'yes' : 'no';
    listeners.forEach(function (fn) { fn(state); });
  }

  /* ------------------------------------------------------------ UI */
  var root, panel, lastFocus;

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }

  function build() {
    root = el('div', { class: 'consent', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'consent-title', 'aria-describedby': 'consent-text' });
    root.innerHTML =
      '<div class="consent__box">' +
      '<h2 id="consent-title" class="consent__title">עוגיות באתר</h2>' +
      '<p id="consent-text" class="consent__text">האתר משתמש בעוגיות הכרחיות כדי לעבוד. בהסכמתכם נשתמש גם בעוגיות סטטיסטיקה, שיווק ותוכן מוטמע. ' +
      'אפשר לבחור מה לאשר, ולשנות את הבחירה בכל עת. <a href="/מדיניות-פרטיות/">מדיניות הפרטיות</a></p>' +
      '<div class="consent__settings" hidden></div>' +
      '<div class="consent__actions">' +
      '<button type="button" class="btn" data-c="all">אישור הכל</button>' +
      '<button type="button" class="btn btn--line" data-c="necessary">רק הכרחיות</button>' +
      '<button type="button" class="btn btn--line" data-c="settings" aria-expanded="false">בחירה לפי סוג</button>' +
      '<button type="button" class="btn" data-c="save" hidden>שמירת הבחירה</button>' +
      '</div></div>';
    panel = root.querySelector('.consent__settings');
    panel.innerHTML = CATEGORIES.map(function (c) {
      var on = c.locked || allowed(c.id);
      return '<label class="consent__cat"><input type="checkbox" name="' + c.id + '"' + (on ? ' checked' : '') + (c.locked ? ' disabled' : '') + '>' +
        '<span><b>' + c.title + (c.locked ? ' (תמיד פעילות)' : '') + '</b><small>' + c.text + '</small></span></label>';
    }).join('');
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-c]');
      if (!b) return;
      var c = b.dataset.c;
      if (c === 'settings') { openSettings(); return; }
      var choice = {};
      if (c === 'all') CATEGORIES.forEach(function (x) { choice[x.id] = true; });
      if (c === 'save') panel.querySelectorAll('input').forEach(function (i) { choice[i.name] = i.checked; });
      state = write(choice);
      close();
      apply();
    });
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state) close(); });
    document.body.appendChild(root);
  }

  function openSettings() {
    panel.hidden = false;
    root.querySelector('[data-c="settings"]').hidden = true;
    root.querySelector('[data-c="save"]').hidden = false;
    root.querySelector('[data-c="settings"]').setAttribute('aria-expanded', 'true');
    panel.querySelector('input:not([disabled])').focus();
  }

  function open(withSettings) {
    lastFocus = document.activeElement;
    if (!root) build();
    panel.querySelectorAll('input').forEach(function (i) { i.checked = i.disabled || allowed(i.name); });
    root.hidden = false;
    if (withSettings) openSettings();
    else root.querySelector('button[data-c="all"]').focus({ preventScroll: true });
  }

  function close() {
    root.hidden = true;
    if (lastFocus && lastFocus.focus && lastFocus !== document.body) lastFocus.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------ public */
  window.YKConsent = {
    allowed: allowed,
    open: function () { open(true); },
    grant: function (cat) { var c = {}; CATEGORIES.forEach(function (x) { c[x.id] = allowed(x.id); }); c[cat] = true; state = write(c); apply(); },
    onChange: function (fn) { listeners.push(fn); }
  };

  function init() {
    document.querySelectorAll('[data-consent-open]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.preventDefault(); open(true); });
    });
    apply();
    if (!state) open(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
