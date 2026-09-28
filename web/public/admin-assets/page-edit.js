/* Page edit mode: click a text block on the page to edit it in place, then save. */
(function () {
  var bar = document.querySelector('[data-yk-bar]');
  if (!bar) return;
  var saveBtn = bar.querySelector('[data-yk-save]');
  var status = bar.querySelector('[data-yk-status]');
  var dirty = {};
  var active = null;

  // Toolbar row inside the top bar; buttons depend on the kind of block.
  var tools = document.createElement('div');
  tools.className = 'yk-tools';
  tools.hidden = true;
  var buttons = [
    ['bold', 'B', 'all'], ['italic', 'I', 'all'], ['link', 'קישור', 'all'], ['unlink', 'הסרת קישור', 'all'],
    ['p', 'פסקה', 'rich'], ['h3', 'כותרת משנה', 'rich'], ['ul', '• רשימה', 'rich'], ['ol', '1. רשימה', 'rich'],
    ['image', 'תמונה', 'rich'], ['video', 'סרטון', 'rich'], ['undo', 'ביטול', 'all']
  ];
  buttons.forEach(function (b) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b[1];
    btn.dataset.cmd = b[0];
    btn.dataset.scope = b[2];
    tools.appendChild(btn);
  });
  bar.appendChild(tools);
  tools.addEventListener('mousedown', function (e) { if (e.target.closest('button')) e.preventDefault(); });
  tools.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b && active) {
      window.YKEditor.run(b.dataset.cmd, active);
      mark(active);
    }
  });

  function status_(t, kind) {
    status.textContent = t || '';
    status.dataset.kind = kind || '';
  }

  function mark(el) {
    dirty[el.dataset.ykEdit] = el;
    el.classList.add('yk-changed');
    saveBtn.disabled = false;
    status_(Object.keys(dirty).length + ' שינויים לא שמורים', 'warn');
  }

  function activate(el) {
    if (active === el) return;
    if (active) active.classList.remove('yk-active');
    active = el;
    el.classList.add('yk-active');
    if (el.getAttribute('contenteditable') !== 'true') {
      el.setAttribute('contenteditable', 'true');
      el.querySelectorAll('.video').forEach(function (v) { v.setAttribute('contenteditable', 'false'); });
      el.addEventListener('input', function () { mark(el); });
      el.addEventListener('paste', function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
      });
      el.addEventListener('keydown', function (e) {
        // Single-line blocks (headings, captions) do not take new paragraphs.
        if (e.key === 'Enter' && el.dataset.ykKind === 'inline') e.preventDefault();
      });
    }
    var rich = el.dataset.ykKind === 'rich';
    tools.hidden = false;
    tools.querySelectorAll('button').forEach(function (b) { b.hidden = b.dataset.scope === 'rich' && !rich; });
    el.focus();
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-yk-edit]');
    if (el) {
      // Links inside editable text are edited, not followed.
      if (e.target.closest('a')) e.preventDefault();
      activate(el);
      return;
    }
    if (e.target.closest('form')) e.preventDefault();
  }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);

  saveBtn.addEventListener('click', function () {
    var edits = {};
    Object.keys(dirty).forEach(function (k) { edits[k] = dirty[k].innerHTML; });
    saveBtn.disabled = true;
    status_('שומר…');
    fetch('/admin/page-save/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ csrf: bar.dataset.csrf, path: bar.dataset.path, hash: bar.dataset.hash, edits: edits })
    })
      .then(function (r) { return r.json().then(function (b) { if (!r.ok || !b.ok) throw new Error(b.error || 'השמירה נכשלה'); return b; }); })
      .then(function (res) {
        bar.dataset.hash = res.hash;
        Object.keys(dirty).forEach(function (k) { dirty[k].classList.remove('yk-changed'); });
        dirty = {};
        status_('נשמר. השינויים כבר באתר.', 'ok');
        // Reload so block numbers and cleaned text match the saved file.
        setTimeout(function () { location.reload(); }, 900);
      })
      .catch(function (err) {
        saveBtn.disabled = false;
        status_(err.message, 'error');
      });
  });

  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(dirty).length) { e.preventDefault(); e.returnValue = ''; }
  });
})();
