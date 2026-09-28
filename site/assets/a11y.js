/*
 * Accessibility menu: text size, high contrast, link highlighting, readable
 * spacing and stopping motion. Choices are kept on this device (localStorage,
 * a "necessary" setting) and applied as classes on <html> before paint.
 */
(function () {
  var KEY = 'yk_a11y';
  var html = document.documentElement;
  var opts = { size: 0, contrast: false, links: false, spacing: false, motion: false };
  try { Object.assign(opts, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}

  function apply() {
    html.classList.toggle('a11y-size-1', opts.size === 1);
    html.classList.toggle('a11y-size-2', opts.size === 2);
    html.classList.toggle('a11y-size-3', opts.size === 3);
    html.classList.toggle('a11y-contrast', !!opts.contrast);
    html.classList.toggle('a11y-links', !!opts.links);
    html.classList.toggle('a11y-spacing', !!opts.spacing);
    html.classList.toggle('a11y-motion', !!opts.motion);
    try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch (e) {}
  }
  apply();   // runs early, so the page never flashes the default style

  function init() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'a11y-btn';
    btn.setAttribute('aria-label', 'תפריט נגישות');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'a11y-panel');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm8 6.5-5.5 1V14l2.2 7.3-1.9.6L12.6 15h-1.2l-2.2 6.9-1.9-.6L9.5 14V9.5L4 8.5l.4-2 7.6 1.2 7.6-1.2.4 2Z"/></svg>';

    var panel = document.createElement('div');
    panel.className = 'a11y-panel';
    panel.id = 'a11y-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'הגדרות נגישות');
    panel.innerHTML =
      '<h2>נגישות</h2>' +
      '<div class="a11y-row" role="group" aria-label="גודל טקסט"><span>גודל טקסט</span>' +
      '<button type="button" data-a="size-down" aria-label="הקטנת טקסט">א−</button>' +
      '<output data-size aria-live="polite"></output>' +
      '<button type="button" data-a="size-up" aria-label="הגדלת טקסט">א+</button></div>' +
      '<button type="button" class="a11y-toggle" data-a="contrast" aria-pressed="false">ניגודיות גבוהה</button>' +
      '<button type="button" class="a11y-toggle" data-a="links" aria-pressed="false">הדגשת קישורים</button>' +
      '<button type="button" class="a11y-toggle" data-a="spacing" aria-pressed="false">ריווח קריא</button>' +
      '<button type="button" class="a11y-toggle" data-a="motion" aria-pressed="false">עצירת תנועה</button>' +
      '<div class="a11y-foot"><button type="button" class="linklike" data-a="reset">איפוס</button>' +
      '<a href="/הצהרת-נגישות/">הצהרת נגישות</a></div>';

    function sync() {
      panel.querySelector('[data-size]').textContent = ['רגיל', '110%', '125%', '140%'][opts.size];
      ['contrast', 'links', 'spacing', 'motion'].forEach(function (k) {
        panel.querySelector('[data-a="' + k + '"]').setAttribute('aria-pressed', String(!!opts[k]));
      });
    }
    function toggle(open) {
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) { sync(); panel.querySelector('button').focus(); }
    }

    btn.addEventListener('click', function () { toggle(panel.hidden); });
    panel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]');
      if (!b) return;
      var a = b.dataset.a;
      if (a === 'size-up') opts.size = Math.min(3, opts.size + 1);
      else if (a === 'size-down') opts.size = Math.max(0, opts.size - 1);
      else if (a === 'reset') opts = { size: 0, contrast: false, links: false, spacing: false, motion: false };
      else opts[a] = !opts[a];
      apply();
      sync();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) { toggle(false); btn.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) toggle(false);
    });
    document.body.appendChild(btn);
    document.body.appendChild(panel);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
