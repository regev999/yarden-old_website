/*
 * Images are resized (up to 2400px on the long side) and re-encoded as WebP
 * in the browser before upload: a 6MB phone photo becomes ~300-500KB.
 * GIFs, PDFs and videos are sent as they are.
 */
(function () {
  var MAX_SIDE = 2400;
  var QUALITY = 0.82;

  function encode(canvas, type) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, QUALITY); });
  }

  window.YKCompress = function (file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap) return Promise.resolve(file);
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return encode(canvas, 'image/webp').then(function (blob) {
        // Browsers that can't write WebP return PNG; use JPEG for photos then.
        if (blob && blob.type === 'image/webp') return blob;
        return file.type === 'image/png' ? encode(canvas, 'image/png') : encode(canvas, 'image/jpeg');
      }).then(function (blob) {
        if (!blob || (scale === 1 && blob.size >= file.size)) return file;
        var ext = { 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/png': '.png' }[blob.type] || '';
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + ext, { type: blob.type });
      });
    }).catch(function () { return file; });
  };

  /** Upload files (compressed) to the media library; resolves with the new URLs. */
  window.YKUpload = function (files, csrf) {
    return Promise.all(Array.prototype.map.call(files, window.YKCompress)).then(function (ready) {
      var fd = new FormData();
      ready.forEach(function (f) { fd.append('files', f, f.name); });
      fd.append('csrf', csrf);
      fd.append('action', 'upload');
      return fetch('/admin/media/?format=json', { method: 'POST', body: fd, headers: { Accept: 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (res) { if (!res.ok) throw new Error(res.error || 'ההעלאה נכשלה'); return res.urls; });
    });
  };

  // Media screen: upload as soon as files are chosen or dropped.
  document.querySelectorAll('[data-upload-form]').forEach(function (form) {
    var input = form.querySelector('input[type=file]');
    var status = form.querySelector('[data-upload-status]');
    function send(files) {
      if (!files.length) return;
      status.textContent = 'מכווץ ומעלה ' + files.length + ' קבצים…';
      window.YKUpload(files, form.querySelector('input[name=csrf]').value)
        .then(function () { location.reload(); })
        .catch(function (err) { status.textContent = err.message; });
    }
    input.addEventListener('change', function () { send(input.files); });
    form.addEventListener('dragover', function (e) { e.preventDefault(); });
    form.addEventListener('drop', function (e) { e.preventDefault(); send(e.dataTransfer.files); });
  });
})();
