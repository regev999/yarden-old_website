/*
 * Small rich-text editor for the admin: headings, bold/italic, lists, quotes,
 * links, images from the media library, YouTube videos. Pasted text arrives
 * clean. The server sanitizes everything again on save.
 *
 * Markup: <div class="rte" data-rte data-name="body"> + <textarea name="body" hidden>
 */
(function () {
  var ICON = {
    bold: 'B', italic: 'I', h2: 'כותרת', h3: 'כותרת משנה', p: 'פסקה', ul: '• רשימה', ol: '1. רשימה',
    quote: 'ציטוט', link: 'קישור', unlink: 'הסרת קישור', image: 'תמונה', video: 'סרטון', clear: 'ניקוי עיצוב', undo: 'ביטול', redo: 'חזרה'
  };

  function exec(cmd, val) { document.execCommand(cmd, false, val || null); }

  function toolbar(inlineOnly) {
    var groups = inlineOnly
      ? [['bold', 'italic'], ['link', 'unlink'], ['undo', 'redo']]
      : [['p', 'h2', 'h3'], ['bold', 'italic'], ['ul', 'ol', 'quote'], ['link', 'unlink'], ['image', 'video'], ['clear', 'undo', 'redo']];
    var bar = document.createElement('div');
    bar.className = 'rte__bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'עיצוב טקסט');
    groups.forEach(function (g) {
      var wrap = document.createElement('span');
      wrap.className = 'rte__group';
      g.forEach(function (k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.dataset.cmd = k;
        b.textContent = ICON[k];
        b.className = 'rte__btn rte__btn--' + k;
        wrap.appendChild(b);
      });
      bar.appendChild(wrap);
    });
    return bar;
  }

  function cleanPaste(e) {
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain');
    var html = text.split(/\r?\n\s*\r?\n/).map(function (para) {
      var safe = para.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');
      return '<p>' + safe + '</p>';
    }).join('');
    if (text.indexOf('\n') === -1) exec('insertText', text); else exec('insertHTML', html);
  }

  function run(cmd, area, inlineOnly) {
    area.focus();
    switch (cmd) {
      case 'bold': exec('bold'); break;
      case 'italic': exec('italic'); break;
      case 'p': exec('formatBlock', 'P'); break;
      case 'h2': exec('formatBlock', 'H2'); break;
      case 'h3': exec('formatBlock', 'H3'); break;
      case 'ul': exec('insertUnorderedList'); break;
      case 'ol': exec('insertOrderedList'); break;
      case 'quote': exec('formatBlock', 'BLOCKQUOTE'); break;
      case 'unlink': exec('unlink'); break;
      case 'clear': exec('removeFormat'); exec('formatBlock', 'P'); break;
      case 'undo': exec('undo'); break;
      case 'redo': exec('redo'); break;
      case 'link': {
        var url = prompt('לאן הקישור? (כתובת מלאה, או כתובת בתוך האתר כמו /אודות/)', 'https://');
        if (url && url !== 'https://') exec('createLink', url.trim());
        break;
      }
      case 'video': {
        var v = prompt('הדביקו קישור לסרטון ביוטיוב');
        if (v && /youtu/.test(v)) exec('insertHTML', '<p>' + v.trim().replace(/</g, '') + '</p><p><br></p>');
        break;
      }
      case 'image': {
        var sel = saveSelection();
        window.YKMedia.pick(function (url) {
          restoreSelection(sel);
          var alt = prompt('תיאור קצר של התמונה (לנגישות ולגוגל)', '') || '';
          exec('insertHTML', '<figure><img src="' + url + '" alt="' + alt.replace(/"/g, '&quot;') + '"></figure><p><br></p>');
        });
        break;
      }
    }
  }

  function saveSelection() {
    var s = window.getSelection();
    return s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
  }
  function restoreSelection(r) {
    if (!r) return;
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  /** Turn an element into an editor. Returns the editable area. */
  function attach(el, opts) {
    opts = opts || {};
    var inlineOnly = !!opts.inline;
    var area = document.createElement('div');
    area.className = 'rte__area';
    area.contentEditable = 'true';
    area.innerHTML = opts.html || '';
    area.setAttribute('role', 'textbox');
    area.setAttribute('aria-multiline', 'true');
    if (opts.label) area.setAttribute('aria-label', opts.label);
    var bar = toolbar(inlineOnly);
    el.appendChild(bar);
    el.appendChild(area);
    bar.addEventListener('mousedown', function (e) { if (e.target.closest('button')) e.preventDefault(); });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b) run(b.dataset.cmd, area, inlineOnly);
    });
    area.addEventListener('paste', cleanPaste);
    area.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); run('link', area); }
    });
    try { exec('defaultParagraphSeparator', 'p'); } catch (err) {}
    return area;
  }

  // Form editors: <div data-rte data-name="body"></div> + <textarea name="body" hidden>
  document.querySelectorAll('[data-rte]').forEach(function (el) {
    var field = el.parentElement.querySelector('textarea[name="' + el.dataset.name + '"]');
    var area = attach(el, { html: field.value, label: el.dataset.label, inline: el.hasAttribute('data-inline') });
    var form = el.closest('form');
    function sync() { field.value = area.innerHTML; }
    area.addEventListener('input', function () { sync(); if (form) form.dataset.dirty = '1'; });
    if (form) form.addEventListener('submit', sync);
  });

  window.YKEditor = { attach: attach, run: run };

  // Warn before leaving a form with unsaved changes
  document.querySelectorAll('form[data-track-changes]').forEach(function (f) {
    f.addEventListener('input', function () { f.dataset.dirty = '1'; });
    f.addEventListener('submit', function () { f.dataset.dirty = ''; });
  });
  window.addEventListener('beforeunload', function (e) {
    if (document.querySelector('form[data-dirty="1"]')) { e.preventDefault(); e.returnValue = ''; }
  });
})();

/* Media picker: a dialog that lists the library and allows uploading on the spot. */
(function () {
  var dialog, grid, onPick, csrf;
  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'picker';
    dialog.innerHTML =
      '<div class="picker__head"><h2>בחירת תמונה</h2><button type="button" class="linklike" data-close>סגירה</button></div>' +
      '<div class="picker__tools"><input type="search" placeholder="חיפוש לפי שם קובץ" data-search>' +
      '<label class="btn btn--quiet picker__upload">העלאת תמונה חדשה<input type="file" accept="image/*" hidden data-upload></label></div>' +
      '<p class="picker__status muted" data-status></p><ul class="picker__grid" data-grid></ul>';
    document.body.appendChild(dialog);
    grid = dialog.querySelector('[data-grid]');
    dialog.querySelector('[data-close]').addEventListener('click', function () { dialog.close(); });
    var t;
    dialog.querySelector('[data-search]').addEventListener('input', function (e) {
      clearTimeout(t);
      t = setTimeout(function () { load(e.target.value); }, 250);
    });
    dialog.querySelector('[data-upload]').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      status('מכווץ ומעלה…');
      window.YKUpload([f], csrf)
        .then(function (urls) { choose(urls[0]); })
        .catch(function (err) { status(err.message || 'ההעלאה נכשלה'); });
    });
    grid.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-url]');
      if (b) choose(b.dataset.url);
    });
  }
  function status(t) { dialog.querySelector('[data-status]').textContent = t || ''; }
  function choose(url) { dialog.close(); if (onPick) onPick(url); }
  function load(q) {
    status('טוען…');
    fetch('/admin/media/?format=json&type=image&q=' + encodeURIComponent(q || ''), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (items) {
        grid.innerHTML = '';
        items.forEach(function (m) {
          var li = document.createElement('li');
          var b = document.createElement('button');
          b.type = 'button';
          b.dataset.url = m.url;
          b.title = m.name;
          var img = document.createElement('img');
          img.src = m.url;
          img.alt = '';
          img.loading = 'lazy';
          b.appendChild(img);
          li.appendChild(b);
          grid.appendChild(li);
        });
        status(items.length ? '' : 'אין עדיין תמונות בספרייה. אפשר להעלות אחת עכשיו.');
      });
  }
  window.YKMedia = {
    pick: function (cb) {
      csrf = (document.querySelector('input[name="csrf"]') || {}).value || ((document.querySelector('[data-yk-bar]') || {}).dataset || {}).csrf || '';
      if (!dialog) build();
      onPick = cb;
      dialog.showModal();
      load('');
    }
  };
})();
