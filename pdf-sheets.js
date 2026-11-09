/*! PdfSheets: renders a PDF into one <canvas class="pdf-sheet"> per page with pdf.js,
    so worksheets can be shown (and annotated) like page images. The PDF file itself is never changed.
    Requires window.pdfjsLib (vendor/pdfjs, Apache License 2.0). */
(function (global) {
  "use strict";
  // Pixel width each page is rendered at: sharp on a projector and when zoomed in.
  var RENDER_WIDTH = 1600;
  var MAX_PAGES = 40;

  function available() {
    return !!(global.pdfjsLib && global.pdfjsLib.getDocument);
  }

  // Appends one canvas per page to container, in order, as soon as each page is ready.
  // Resolves with the canvases. isCurrent() is checked between pages so a closed worksheet
  // stops rendering; onPage(canvas, index) runs after each page is added.
  function render(src, container, isCurrent, onPage) {
    isCurrent = isCurrent || function () { return true; };
    if (!available()) return Promise.reject(new Error("pdfjs"));
    var canvases = [];
    return global.pdfjsLib.getDocument({ url: src }).promise.then(function (doc) {
      var count = Math.min(doc.numPages, MAX_PAGES);
      var chain = Promise.resolve();
      for (var i = 1; i <= count; i++) {
        chain = chain.then(renderPage.bind(null, doc, i));
      }
      return chain.then(function () { return canvases; });
    });
    function renderPage(doc, num) {
      if (!isCurrent()) return Promise.reject(new Error("stale"));
      return doc.getPage(num).then(function (page) {
        var base = page.getViewport({ scale: 1 });
        var viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
        var canvas = document.createElement("canvas");
        canvas.className = "pdf-sheet";
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.setAttribute("aria-label", "עמוד " + num);
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
          if (!isCurrent()) throw new Error("stale");
          container.appendChild(canvas);
          canvases.push(canvas);
          if (onPage) onPage(canvas, num - 1);
        });
      });
    }
  }

  global.PdfSheets = { available: available, render: render };
})(window);
