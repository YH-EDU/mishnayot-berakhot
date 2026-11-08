/*! Berakhot notebook annotations */
(function (global) {
  "use strict";
  var STORAGE_PREFIX = "berakhot-notes:v1:";
  // Prototype: annotations are enabled only on these notebook pages (pages/pNN.jpg).
  var ENABLED_PAGES = [8];
  // Font size as a fraction of the page image width, so text scales with the page.
  var FONT_RATIO = 0.0205;
  var MAX_LEN = 2000;
  var DRAG_SLOP = 5;

  var opts = {
    getUser: function () { return ""; },
    toast: function (msg) { if (global.showToast) global.showToast(msg); }
  };
  var button = null;
  var writing = false;
  var hinted = false;
  var editing = null;
  var editor = null;
  var tools = null;
  var sheets = [];
  var resizeObs = null;

  function user() { return String(opts.getUser() || "").trim(); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function storageKey(name, page) { return STORAGE_PREFIX + name + ":p" + pad(page); }
  function pageNumOf(img) {
    var m = /^pages\/p(\d+)\.jpg$/.exec(img.getAttribute("src") || "");
    return m ? parseInt(m[1], 10) : 0;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function newId() { return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function load(name, page) {
    if (!name) return [];
    try {
      var data = JSON.parse(localStorage.getItem(storageKey(name, page)) || "[]");
      if (!Array.isArray(data)) return [];
      return data.filter(function (n) {
        return n && typeof n.text === "string" && n.text.trim() &&
          typeof n.x === "number" && typeof n.y === "number" && isFinite(n.x) && isFinite(n.y);
      }).map(function (n) {
        return {
          id: String(n.id || newId()),
          x: clamp(n.x, 0, 1),
          y: clamp(n.y, 0, 1),
          text: n.text.slice(0, MAX_LEN)
        };
      });
    } catch (e) { return []; }
  }
  function save(sheet) {
    var name = user();
    if (!name) return;
    var list = sheet.notes.filter(function (n) { return n.text.trim(); });
    try {
      if (list.length) localStorage.setItem(storageKey(name, sheet.page), JSON.stringify(list));
      else localStorage.removeItem(storageKey(name, sheet.page));
    } catch (e) {
      opts.toast("השמירה נכשלה");
    }
  }

  function place(el, note) {
    el.style.right = ((1 - note.x) * 100) + "%";
    el.style.top = (note.y * 100) + "%";
  }
  function pointToFraction(layer, clientX, clientY) {
    var rect = layer.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left) / rect.width, 0.02, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1)
    };
  }

  function makeNoteEl(sheet, note) {
    var el = document.createElement("div");
    el.className = "note";
    el.dir = "rtl";
    el.textContent = note.text;
    el.noteData = note;
    place(el, note);
    el.addEventListener("pointerdown", function (e) {
      if (!writing || (editing && editing.el === el)) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      startDrag(sheet, el, e, false);
    });
    return el;
  }

  function getEditor() {
    if (editor) return editor;
    editor = document.createElement("textarea");
    editor.className = "note-input";
    editor.dir = "rtl";
    editor.rows = 1;
    editor.spellcheck = false;
    editor.maxLength = MAX_LEN;
    editor.setAttribute("aria-label", "הערה על הדף");
    editor.setAttribute("autocomplete", "off");
    editor.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        finishEdit();
      }
    });
    editor.addEventListener("input", function () {
      if (!editing) return;
      var text = editor.value.replace(/\r\n?/g, "\n");
      editing.el.noteData.text = text;
      editing.el.setAttribute("data-value", text);
      save(editing.sheet);
    });
    editor.addEventListener("blur", function () {
      if (!editing || !document.hasFocus()) return;
      finishEdit();
    });
    return editor;
  }

  function startDrag(sheet, el, e, fromHandle) {
    var target = e.currentTarget;
    var note = el.noteData;
    var start = { x: e.clientX, y: e.clientY, nx: note.x, ny: note.y };
    var moved = false;
    try { target.setPointerCapture(e.pointerId); } catch (err) {}
    function onMove(ev) {
      if (ev.pointerId !== e.pointerId) return;
      var dx = ev.clientX - start.x;
      var dy = ev.clientY - start.y;
      if (!moved && Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
      moved = true;
      var rect = sheet.layer.getBoundingClientRect();
      note.x = clamp(start.nx + dx / rect.width, 0.02, 1);
      note.y = clamp(start.ny + dy / rect.height, 0, 1);
      place(el, note);
      if (tools && editing && editing.el === el) place(tools, note);
    }
    function onEnd(ev) {
      if (ev.pointerId !== e.pointerId) return;
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
      if (moved) save(sheet);
      else if (!fromHandle && ev.type === "pointerup") startEdit(sheet, el, ev.clientX, ev.clientY);
    }
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
  }

  function caretOffsetAt(el, x, y) {
    var len = el.noteData.text.length;
    if (x == null) return len;
    var node = null;
    var offset = len;
    if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (pos) { node = pos.offsetNode; offset = pos.offset; }
    } else if (document.caretRangeFromPoint) {
      var range = document.caretRangeFromPoint(x, y);
      if (range) { node = range.startContainer; offset = range.startOffset; }
    }
    if (!node || node.nodeType !== 3 || node.parentNode !== el) return len;
    return clamp(offset, 0, len);
  }

  function startEdit(sheet, el, x, y) {
    if (editing && editing.el !== el) finishEdit();
    if (editing) return;
    var caret = caretOffsetAt(el, x, y);
    var input = getEditor();
    editing = { sheet: sheet, el: el };
    el.classList.add("is-editing");
    el.setAttribute("data-value", el.noteData.text);
    el.textContent = "";
    input.value = el.noteData.text;
    el.appendChild(input);
    showTools(sheet, el);
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(caret, caret); } catch (e) {}
  }

  function finishEdit() {
    if (!editing) return;
    var cur = editing;
    editing = null;
    var el = cur.el;
    var text = (editor ? editor.value : el.noteData.text).replace(/\r\n?/g, "\n").replace(/^\s+|\s+$/g, "");
    if (editor && editor.parentNode === el) {
      if (document.activeElement === editor) editor.blur();
      el.removeChild(editor);
    }
    el.classList.remove("is-editing");
    el.removeAttribute("data-value");
    hideTools();
    if (!text) {
      removeNote(cur.sheet, el);
    } else {
      el.noteData.text = text;
      el.textContent = text;
      save(cur.sheet);
    }
  }

  function removeNote(sheet, el) {
    sheet.notes = sheet.notes.filter(function (n) { return n !== el.noteData; });
    if (el.parentNode) el.parentNode.removeChild(el);
    save(sheet);
  }

  function svg(path) {
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
  }
  function buildTools() {
    var bar = document.createElement("div");
    bar.className = "note-tools";
    var move = document.createElement("button");
    move.type = "button";
    move.className = "note-move";
    move.title = "גרירה להזזה";
    move.setAttribute("aria-label", "הזזה");
    move.innerHTML = svg('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>');
    var del = document.createElement("button");
    del.type = "button";
    del.className = "note-delete";
    del.title = "מחיקה";
    del.setAttribute("aria-label", "מחיקה");
    del.innerHTML = svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>');
    bar.appendChild(move);
    bar.appendChild(del);
    bar.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
    bar.addEventListener("click", function (e) { e.stopPropagation(); });
    move.addEventListener("pointerdown", function (e) {
      if (!editing) return;
      e.preventDefault();
      e.stopPropagation();
      startDrag(editing.sheet, editing.el, e, true);
    });
    del.addEventListener("pointerdown", function (e) { e.preventDefault(); e.stopPropagation(); });
    del.addEventListener("click", function () {
      if (!editing) return;
      var cur = editing;
      editing = null;
      hideTools();
      removeNote(cur.sheet, cur.el);
    });
    return bar;
  }
  function showTools(sheet, el) {
    if (!tools) tools = buildTools();
    place(tools, el.noteData);
    sheet.layer.appendChild(tools);
  }
  function hideTools() {
    if (tools && tools.parentNode) tools.parentNode.removeChild(tools);
  }

  function bindLayer(sheet) {
    var layer = sheet.layer;
    var down = null;
    layer.addEventListener("mousedown", function (e) {
      if (e.target.closest(".note, .note-tools")) e.stopPropagation();
    });
    layer.addEventListener("pointerdown", function (e) {
      if (!writing) return;
      down = { x: e.clientX, y: e.clientY, wasEditing: !!editing };
    });
    layer.addEventListener("click", function (e) {
      if (!writing || e.target.closest(".note, .note-tools")) return;
      var d = down;
      down = null;
      if (d && (Math.abs(e.clientX - d.x) > DRAG_SLOP || Math.abs(e.clientY - d.y) > DRAG_SLOP)) return;
      if (editing || (d && d.wasEditing)) { finishEdit(); return; }
      if (!user()) { opts.toast("צריך להתחבר כמורה"); return; }
      var pt = pointToFraction(layer, e.clientX, e.clientY);
      var note = { id: newId(), x: pt.x, y: pt.y, text: "" };
      sheet.notes.push(note);
      var el = makeNoteEl(sheet, note);
      layer.appendChild(el);
      startEdit(sheet, el);
    });
  }

  function sizeSheet(sheet) {
    var w = sheet.el.clientWidth;
    if (w) sheet.layer.style.fontSize = (w * FONT_RATIO).toFixed(2) + "px";
  }

  function renderSheet(sheet) {
    hideTools();
    Array.from(sheet.layer.querySelectorAll(".note")).forEach(function (n) { n.remove(); });
    sheet.notes = load(user(), sheet.page);
    sheet.notes.forEach(function (note) {
      sheet.layer.appendChild(makeNoteEl(sheet, note));
    });
  }

  function mount(pageEl) {
    finishEdit();
    if (resizeObs) resizeObs.disconnect();
    sheets = [];
    Array.from(pageEl.querySelectorAll("img")).forEach(function (img) {
      var page = pageNumOf(img);
      if (ENABLED_PAGES.indexOf(page) === -1) return;
      var wrap = document.createElement("div");
      wrap.className = "note-sheet";
      wrap.dataset.page = String(page);
      img.parentNode.insertBefore(wrap, img);
      wrap.appendChild(img);
      var layer = document.createElement("div");
      layer.className = "note-layer";
      wrap.appendChild(layer);
      var sheet = { el: wrap, layer: layer, page: page, notes: [] };
      bindLayer(sheet);
      renderSheet(sheet);
      sizeSheet(sheet);
      sheets.push(sheet);
    });
    if (typeof ResizeObserver === "function") {
      if (!resizeObs) {
        resizeObs = new ResizeObserver(function () { sheets.forEach(sizeSheet); });
      }
      sheets.forEach(function (s) { resizeObs.observe(s.el); });
    }
    syncButton();
  }

  function syncButton() {
    var available = sheets.length > 0;
    if (!available && writing) setWriting(false);
    if (button) {
      button.disabled = !available;
      button.title = available ? "כתיבה על הדף" : "כתיבה זמינה כרגע רק בדף הניסיון (פרק א משנה א)";
    }
  }

  function setWriting(on) {
    on = !!on;
    if (on && !user()) { opts.toast("צריך להתחבר כמורה"); return; }
    if (on && !sheets.length) return;
    if (!on) finishEdit();
    writing = on;
    document.body.classList.toggle("is-writing", on);
    if (button) {
      button.setAttribute("aria-pressed", String(on));
      button.classList.toggle("is-on", on);
    }
    if (on && !hinted) {
      hinted = true;
      opts.toast("הקישו על הדף כדי לכתוב");
    }
  }

  function onAuthChange() {
    finishEdit();
    if (!user()) setWriting(false);
    sheets.forEach(renderSheet);
  }

  function init(config) {
    config = config || {};
    if (config.getUser) opts.getUser = config.getUser;
    if (config.toast) opts.toast = config.toast;
    button = config.button || null;
    if (button) button.addEventListener("click", function () { setWriting(!writing); });
    window.addEventListener("resize", function () { sheets.forEach(sizeSheet); });
    syncButton();
  }

  global.BerakhotNotes = {
    init: init,
    mount: mount,
    onAuthChange: onAuthChange,
    setWriting: setWriting,
    isWriting: function () { return writing; }
  };
})(window);
