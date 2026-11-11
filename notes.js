/*! PageNotes: temporary handwriting and drawings over page images for live teaching.
    Shared module: the same file is used by the Mishnah and the Gemara sites.
    Nothing is ever saved: annotations live in memory for the surface on screen only. */
(function (global) {
  "use strict";
  var SVG_NS = "http://www.w3.org/2000/svg";
  // Default text size as a fraction of the sheet's width, so notes scale with the page.
  var FONT_RATIO = 0.0205;
  // Drawing coordinates: every sheet is VB_W units wide and keeps its natural aspect ratio.
  var VB_W = 1000;
  var DEFAULT_RATIO = 1275 / 924;
  var MAX_LEN = 2000;
  var DRAG_SLOP = 5;
  var MIN_X = 0.02;
  var NUDGE_PX = 2;
  var NUDGE_FAR_PX = 20;
  var HISTORY_MAX = 120;
  var CONFIRM_MS = 2600;
  // A note's text size is a factor of the default size (which itself follows the sheet's width).
  var SCALE_MIN = 0.5;
  var SCALE_MAX = 3;
  // Corners resize a note's text. The zone reaches a little outside the note's box and a little inside it.
  var CORNER_OUT = 12;
  var CORNER_IN = 6;
  // Along the sides (between the corners) a press moves the note instead of typing in it.
  var EDGE_OUT = 8;
  var EDGE_IN = 5;

  function icon(path) {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";
  }
  var TOOLS = [
    { id: "pen", label: "עט", icon: icon('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>') },
    { id: "line", label: "קו ישר", icon: icon('<path d="M5 19L19 5"/>') },
    { id: "arrow", label: "חץ", icon: icon('<path d="M5 19L19 5"/><path d="M10 5h9v9"/>') },
    { id: "rect", label: "מלבן", icon: icon('<rect x="3.5" y="6" width="17" height="12" rx="1.5"/>') },
    { id: "ellipse", label: "עיגול", icon: icon('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>') },
    { id: "eraser", label: "מחק", icon: icon('<path d="M7 20h13"/><path d="M4.6 14.6l9-9a2 2 0 0 1 2.8 0l2.9 2.9a2 2 0 0 1 0 2.8L12 18.6H8.6z"/><path d="M9.5 9.7l5.7 5.7"/>') }
  ];
  // Widths are screen pixels at 100% zoom; each stroke stores them in page units so it scales with zoom.
  var WIDTHS = [
    { px: 3, label: "קו דק" },
    { px: 5, label: "קו בינוני" },
    { px: 8.5, label: "קו עבה" }
  ];
  var PEN_WIDTHS = [
    { px: 0.5, label: "עט 0.5" },
    { px: 1, label: "עט 1" },
    { px: 1.5, label: "עט 1.5" },
    { px: 2.5, label: "עט דק" },
    { px: 5, label: "עט בינוני" },
    { px: 8.5, label: "עט עבה" }
  ];
  var COLORS = [
    { value: "#1b1b1b", label: "שחור" },
    { value: "#d6201f", label: "אדום" },
    { value: "#1f5ad6", label: "כחול" }
  ];

  var opts = {
    getUser: function () { return ""; },
    toast: function (msg) { if (global.showToast) global.showToast(msg); },
    // Returns true while another screen (quiz, dialog...) covers the annotated surface.
    isBlocked: function () { return false; }
  };
  var buttons = { write: [], draw: [] };
  var mode = null;
  var tool = "pen";
  var color = COLORS[0].value;
  var width = WIDTHS[1].px;
  var penWidth = PEN_WIDTHS[3].px;
  // Annotations belong to one surface (docKey); any other key starts clean.
  var docKey = null;
  var pagesData = {};
  var history = [];
  var histPos = 0;
  var sheets = [];
  var selected = null;
  var editing = false;
  var editStart = null;
  var editor = null;
  var panel = null;
  var gesture = null;
  var nudgeTid = null;
  var nudgePending = false;
  var muteBlur = false;
  var resizeObs = null;
  var resizing = null;
  var zonePress = false;
  var touchPts = {};
  var pinch = null;
  var pinchEndAt = 0;
  var hinted = {};
  var confirmTid = null;
  // Last text size the teacher set on a page; new notes on that page start at this size.
  var pageScale = {};

  function user() { return String(opts.getUser() || "").trim(); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function pageData(id) {
    if (!pagesData[id]) pagesData[id] = { notes: [], strokes: [] };
    return pagesData[id];
  }
  function hasContent() {
    return Object.keys(pagesData).some(function (k) {
      return pagesData[k].notes.length > 0 || pagesData[k].strokes.length > 0;
    });
  }
  function eachButton(fn) {
    ["write", "draw"].forEach(function (k) { buttons[k].forEach(function (b) { fn(b, k); }); });
  }

  /* ---------- history (undo / redo) ---------- */

  function resetHistory() {
    history = [clone(pagesData)];
    histPos = 0;
    syncPanel();
  }
  function commit() {
    history = history.slice(0, histPos + 1);
    history.push(clone(pagesData));
    if (history.length > HISTORY_MAX) history.shift();
    histPos = history.length - 1;
    syncPanel();
  }
  function settle() {
    cancelGesture();
    flushNudge();
    deselect();
  }
  function restore(pos) {
    histPos = pos;
    pagesData = clone(history[pos]);
    renderAll();
    syncPanel();
  }
  function undo() {
    settle();
    if (histPos > 0) restore(histPos - 1);
  }
  function redo() {
    settle();
    if (histPos < history.length - 1) restore(histPos + 1);
  }
  function clearAll() {
    settle();
    if (!hasContent()) return;
    pagesData = {};
    renderAll();
    commit();
    opts.toast("הדף נוקה · לביטול: כפתור הביטול או Ctrl+Z");
  }

  /* ---------- text notes ---------- */

  function placeNote(el, note) {
    el.style.right = ((1 - note.x) * 100) + "%";
    el.style.top = (note.y * 100) + "%";
  }
  // The default size leaves no inline style, so unscaled notes look exactly as before.
  function applyScale(el, note) {
    el.style.fontSize = note.scale ? note.scale + "em" : "";
  }
  function setScale(el, s, sheet) {
    var note = el.noteData;
    s = Math.round(clamp(s, SCALE_MIN, SCALE_MAX) * 1000) / 1000;
    if (Math.abs(s - 1) < 0.005) delete note.scale;
    else note.scale = s;
    applyScale(el, note);
    if (sheet) rememberPageScale(sheet, scaleOf(el));
  }
  function scaleOf(el) { return el.noteData.scale || 1; }
  // New notes on this page use the last size the teacher set, until they change it, reset it, or leave the page.
  function rememberPageScale(sheet, s) {
    s = Math.round(clamp(s, SCALE_MIN, SCALE_MAX) * 1000) / 1000;
    if (Math.abs(s - 1) < 0.005) delete pageScale[sheet.id];
    else pageScale[sheet.id] = s;
  }
  function scaleForPage(sheet) {
    return pageScale[sheet.id] || 1;
  }
  // corner: { left: bool, top: bool } is the corner being dragged; the opposite corner stays put.
  function anchorOf(el, corner) {
    var r = el.getBoundingClientRect();
    return { x: corner.left ? r.right : r.left, y: corner.top ? r.bottom : r.top };
  }
  function scaleAround(sheet, el, s, corner, anchor) {
    setScale(el, s, sheet);
    var now = anchorOf(el, corner);
    var lr = sheet.layer.getBoundingClientRect();
    var note = el.noteData;
    note.x = clamp(note.x + (anchor.x - now.x) / (lr.width || 1), MIN_X, 1);
    note.y = clamp(note.y + (anchor.y - now.y) / (lr.height || 1), 0, 1);
    placeNote(el, note);
  }

  /* Corner and side zones: nothing is drawn, only the cursor changes (resize at corners, move on sides). */
  function zoneHit(sheet, x, y) {
    var notes = Array.prototype.slice.call(sheet.layer.querySelectorAll(".note"));
    if (selected && selected.sheet === sheet) {
      notes = notes.filter(function (n) { return n !== selected.el; });
      notes.push(selected.el);
    }
    for (var i = notes.length - 1; i >= 0; i--) {
      var r = notes[i].getBoundingClientRect();
      var inX = Math.min(CORNER_IN, r.width / 4);
      var inY = Math.min(CORNER_IN, r.height / 4);
      var left = x >= r.left - CORNER_OUT && x <= r.left + inX;
      var right = x >= r.right - inX && x <= r.right + CORNER_OUT;
      var top = y >= r.top - CORNER_OUT && y <= r.top + inY;
      var bottom = y >= r.bottom - inY && y <= r.bottom + CORNER_OUT;
      if ((left || right) && (top || bottom)) return { el: notes[i], kind: "corner", left: left, top: top };
    }
    for (i = notes.length - 1; i >= 0; i--) {
      r = notes[i].getBoundingClientRect();
      var eX = Math.min(EDGE_IN, r.width / 4);
      var eY = Math.min(EDGE_IN, r.height / 4);
      var inBox = x >= r.left - EDGE_OUT && x <= r.right + EDGE_OUT && y >= r.top - EDGE_OUT && y <= r.bottom + EDGE_OUT;
      var inText = x > r.left + eX && x < r.right - eX && y > r.top + eY && y < r.bottom - eY;
      if (inBox && !inText) return { el: notes[i], kind: "edge" };
    }
    return null;
  }
  function showZone(sheet, hit) {
    var layer = sheet.layer;
    var kind = !hit ? "" : (hit.kind === "edge" ? "move" : (hit.left === hit.top ? "nwse" : "nesw"));
    layer.classList.toggle("is-zone-nwse", kind === "nwse");
    layer.classList.toggle("is-zone-nesw", kind === "nesw");
    layer.classList.toggle("is-zone-move", kind === "move");
    Array.prototype.forEach.call(layer.querySelectorAll(".note.is-zone"), function (n) {
      if (!hit || n !== hit.el) n.classList.remove("is-zone");
    });
    if (hit) hit.el.classList.add("is-zone");
  }
  function startResize(sheet, hit, e) {
    var el = hit.el;
    var corner = { left: hit.left, top: hit.top };
    var anchor = anchorOf(el, corner);
    var d0 = Math.max(Math.hypot(e.clientX - anchor.x, e.clientY - anchor.y), 8);
    var s0 = scaleOf(el);
    var from = { x: el.noteData.x, y: el.noteData.y };
    var wasEditing = editing && selected && selected.el === el;
    var changed = false;
    var target = sheet.layer;
    resizing = { el: el };
    try { target.setPointerCapture(e.pointerId); } catch (err) {}
    function onMove(ev) {
      if (ev.pointerId !== e.pointerId || pinch) return;
      if (!changed && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_SLOP) return;
      if (!changed) {
        changed = true;
        if (!selected || selected.el !== el) select(sheet, el, false);
      }
      scaleAround(sheet, el, s0 * Math.hypot(ev.clientX - anchor.x, ev.clientY - anchor.y) / d0, corner, anchor);
    }
    function onEnd(ev) {
      if (ev.pointerId !== e.pointerId) return;
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
      resizing = null;
      if (changed) {
        if (scaleOf(el) !== s0 || el.noteData.x !== from.x || el.noteData.y !== from.y) commit();
        if (wasEditing && editor) editor.focus({ preventScroll: true });
        return;
      }
      // A plain click on a corner only selects the note, so a double-click there can reset its size.
      if (ev.type === "pointerup" && !wasEditing && el.parentNode) select(sheet, el, false);
    }
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
  }
  function resetSize(sheet, el) {
    rememberPageScale(sheet, 1);
    if (scaleOf(el) === 1) return;
    var corner = { left: true, top: false };
    scaleAround(sheet, el, 1, corner, anchorOf(el, corner));
    commit();
  }
  // A press on a note's side moves it; a plain click there only selects it (no typing).
  function startEdgeMove(sheet, el, e) {
    startDrag(sheet, el, e, function (moved, ev) {
      if (!moved && ev.type === "pointerup" && !(editing && selected && selected.el === el)) select(sheet, el, false);
    });
  }

  // Ctrl + wheel over the selected note resizes its text instead of zooming the page or browser.
  function onNoteWheel(e) {
    if (mode !== "write" || !e.ctrlKey || !selected) return;
    e.preventDefault();
    e.stopPropagation();
    setScale(selected.el, scaleOf(selected.el) * Math.exp(-clamp(e.deltaY, -100, 100) * 0.003), selected.sheet);
    nudgePending = true;
    clearTimeout(nudgeTid);
    nudgeTid = setTimeout(flushNudge, 600);
  }

  function makeNoteEl(sheet, note) {
    var el = document.createElement("div");
    el.className = "note";
    el.dir = "rtl";
    el.textContent = note.text;
    el.noteData = note;
    placeNote(el, note);
    applyScale(el, note);
    el.addEventListener("pointerdown", function (e) {
      if (mode !== "write" || e.button !== 0) return;
      if (pinch) { e.preventDefault(); e.stopPropagation(); return; }
      if (editing && selected && selected.el === el) return;
      e.preventDefault();
      e.stopPropagation();
      startDrag(sheet, el, e, function (moved, ev) {
        if (!moved && ev.type === "pointerup") select(sheet, el, true, ev.clientX, ev.clientY);
      });
    });
    el.addEventListener("wheel", function (e) {
      if (selected && selected.el === el) onNoteWheel(e);
    }, { passive: false });
    return el;
  }

  function removeNote(sheet, el) {
    var data = pageData(sheet.id);
    data.notes = data.notes.filter(function (n) { return n !== el.noteData; });
    if (el.parentNode) el.parentNode.removeChild(el);
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
    // Keys typed into a note never reach the site's own shortcuts.
    editor.addEventListener("keydown", function (e) { e.stopPropagation(); });
    editor.addEventListener("input", function () {
      if (!editing || !selected) return;
      var text = editor.value.replace(/\r\n?/g, "\n");
      selected.el.noteData.text = text;
      selected.el.setAttribute("data-value", text);
    });
    editor.addEventListener("blur", function () {
      if (muteBlur || !editing || !document.hasFocus()) return;
      deselect();
    });
    return editor;
  }

  function detachEditor(el) {
    if (!editor || editor.parentNode !== el) return;
    muteBlur = true;
    if (document.activeElement === editor) editor.blur();
    muteBlur = false;
    el.removeChild(editor);
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

  function startEdit(x, y) {
    if (!selected || editing) return;
    var el = selected.el;
    var note = el.noteData;
    var caret = caretOffsetAt(el, x, y);
    var input = getEditor();
    editing = true;
    editStart = { text: note.text, isNew: !note.text };
    el.classList.add("is-editing");
    el.setAttribute("data-value", note.text);
    el.textContent = "";
    input.value = note.text;
    el.appendChild(input);
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(caret, caret); } catch (e) {}
  }

  function stopEdit() {
    if (!editing || !selected) { editing = false; return; }
    editing = false;
    var sel = selected;
    var el = sel.el;
    var note = el.noteData;
    var text = (editor ? editor.value : note.text).replace(/\r\n?/g, "\n").replace(/^\s+|\s+$/g, "");
    detachEditor(el);
    el.classList.remove("is-editing");
    el.removeAttribute("data-value");
    if (!text) {
      // An empty note is discarded, so stray clicks never leave empty boxes behind.
      dropSelection();
      removeNote(sel.sheet, el);
      if (!editStart.isNew) commit();
      return;
    }
    note.text = text;
    el.textContent = text;
    if (text !== editStart.text) commit();
  }

  function select(sheet, el, edit, x, y) {
    if (selected && selected.el !== el) deselect();
    if (!selected) {
      selected = { sheet: sheet, el: el };
      el.classList.add("is-selected");
    }
    if (edit) {
      startEdit(x, y);
    } else {
      if (editing) stopEdit();
      if (selected && !hinted.move) {
        hinted.move = true;
        opts.toast("גרירה מהשוליים להזזה · מהפינות לשינוי גודל · Delete למחיקה · החיצים מזיזים · Enter לעריכה");
      }
    }
  }

  function dropSelection() {
    if (!selected) return;
    selected.el.classList.remove("is-selected");
    selected = null;
  }

  function deselect() {
    flushNudge();
    if (!selected) return;
    if (editing) stopEdit();
    dropSelection();
  }

  function deleteSelected() {
    if (!selected) return;
    var sel = selected;
    var wasNew = editing && editStart && editStart.isNew;
    if (editing) {
      editing = false;
      detachEditor(sel.el);
      sel.el.classList.remove("is-editing");
    }
    flushNudge();
    dropSelection();
    removeNote(sel.sheet, sel.el);
    if (!wasNew) commit();
  }

  function startDrag(sheet, el, e, done) {
    var target = e.currentTarget;
    var note = el.noteData;
    var start = { x: e.clientX, y: e.clientY, nx: note.x, ny: note.y };
    var moved = false;
    el.dragFrom = { x: note.x, y: note.y };
    try { target.setPointerCapture(e.pointerId); } catch (err) {}
    function onMove(ev) {
      if (ev.pointerId !== e.pointerId || pinch) return;
      var dx = ev.clientX - start.x;
      var dy = ev.clientY - start.y;
      if (!moved && Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
      if (!moved) {
        moved = true;
        if (!selected || selected.el !== el) select(sheet, el, false);
      }
      var rect = sheet.layer.getBoundingClientRect();
      note.x = clamp(start.nx + dx / rect.width, MIN_X, 1);
      note.y = clamp(start.ny + dy / rect.height, 0, 1);
      placeNote(el, note);
    }
    function onEnd(ev) {
      if (ev.pointerId !== e.pointerId) return;
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
      el.dragFrom = null;
      // A two-finger pinch took over this press: it already put the note back and saved the new size.
      if (el.pinched) { el.pinched = false; return; }
      if (moved) commit();
      done(moved, ev);
    }
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
  }

  function nudge(dx, dy, far) {
    if (!selected) return;
    var sel = selected;
    var note = sel.el.noteData;
    var step = far ? NUDGE_FAR_PX : NUDGE_PX;
    note.x = clamp(note.x + dx * step / (sel.sheet.layer.offsetWidth || 1), MIN_X, 1);
    note.y = clamp(note.y + dy * step / (sel.sheet.layer.offsetHeight || 1), 0, 1);
    placeNote(sel.el, note);
    nudgePending = true;
    clearTimeout(nudgeTid);
    nudgeTid = setTimeout(flushNudge, 600);
  }
  function flushNudge() {
    clearTimeout(nudgeTid);
    nudgeTid = null;
    if (!nudgePending) return;
    nudgePending = false;
    commit();
  }

  /* Two-finger pinch on the selected note (touch screens): the first finger must start on the note. */
  function touchCount() { return Object.keys(touchPts).length; }
  function touchSpan() {
    var p = Object.keys(touchPts).slice(0, 2).map(function (k) { return touchPts[k]; });
    return Math.max(Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), 10);
  }
  function onTouchDown(e) {
    if (e.pointerType !== "touch" || mode !== "write" || !selected) return;
    var onNote = selected.el.contains(e.target);
    if (!onNote && !touchCount()) return;
    touchPts[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (touchCount() === 2 && !pinch) {
      var el = selected.el;
      // Undo any small move the first finger made before the second one landed.
      if (el.dragFrom) {
        el.noteData.x = el.dragFrom.x;
        el.noteData.y = el.dragFrom.y;
        placeNote(el, el.noteData);
        el.pinched = true;
      }
      pinch = { el: el, sheet: selected.sheet, s0: scaleOf(el), d0: touchSpan() };
      e.preventDefault();
      e.stopPropagation();
    }
  }
  function onTouchMove(e) {
    if (!touchPts[e.pointerId]) return;
    touchPts[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (!pinch || touchCount() < 2) return;
    e.preventDefault();
    setScale(pinch.el, pinch.s0 * touchSpan() / pinch.d0, pinch.sheet);
  }
  function onTouchUp(e) {
    if (!touchPts[e.pointerId]) return;
    delete touchPts[e.pointerId];
    if (pinch && touchCount() < 2) {
      var p = pinch;
      pinch = null;
      pinchEndAt = Date.now();
      touchPts = {};
      if (scaleOf(p.el) !== p.s0) commit();
    }
  }

  // A click this close to an existing note edits it instead of creating a duplicate.
  function noteNear(sheet, x, y) {
    var scale = sheet.layer.getBoundingClientRect().width / (sheet.layer.offsetWidth || 1);
    var pad = (parseFloat(sheet.layer.style.fontSize) || 19) * 0.35 * scale;
    var notes = sheet.layer.querySelectorAll(".note");
    for (var i = notes.length - 1; i >= 0; i--) {
      var r = notes[i].getBoundingClientRect();
      if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return notes[i];
    }
    return null;
  }

  function bindLayer(sheet) {
    var layer = sheet.layer;
    var down = null;
    // Zones first (capture phase): a press near a note's corner resizes its text, one on its side moves it.
    layer.addEventListener("pointerdown", function (e) {
      zonePress = false;
      if (mode !== "write" || e.button !== 0 || pinch || resizing) return;
      var hit = zoneHit(sheet, e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      down = null;
      zonePress = true;
      if (hit.kind === "corner") startResize(sheet, hit, e);
      else startEdgeMove(sheet, hit.el, e);
    }, true);
    layer.addEventListener("pointermove", function (e) {
      if (mode !== "write" || e.pointerType === "touch") return;
      if (resizing || e.buttons) return;
      showZone(sheet, zoneHit(sheet, e.clientX, e.clientY));
    }, true);
    layer.addEventListener("pointerleave", function () {
      if (!resizing) showZone(sheet, null);
    });
    layer.addEventListener("dblclick", function (e) {
      if (mode !== "write") return;
      var hit = zoneHit(sheet, e.clientX, e.clientY);
      if (!hit || hit.kind !== "corner") return;
      e.preventDefault();
      e.stopPropagation();
      resetSize(sheet, hit.el);
    }, true);
    // Presses on notes must not start the site's page panning; presses on empty paper still may.
    layer.addEventListener("mousedown", function (e) {
      // A press on a zone keeps the focus where it is (e.g. in the note being typed in).
      if (zonePress) { zonePress = false; e.preventDefault(); }
      if (e.target !== layer) e.stopPropagation();
    });
    layer.addEventListener("pointerdown", function (e) {
      down = (mode === "write" && e.target === layer)
        ? { x: e.clientX, y: e.clientY, hadSelection: !!selected }
        : null;
    });
    layer.addEventListener("click", function (e) {
      if (mode !== "write" || e.target !== layer) return;
      var d = down;
      down = null;
      if (pinch || Date.now() - pinchEndAt < 500) return;
      if (!d || Math.abs(e.clientX - d.x) > DRAG_SLOP || Math.abs(e.clientY - d.y) > DRAG_SLOP) return;
      if (d.hadSelection || selected) { deselect(); return; }
      if (!user()) { opts.toast("צריך להתחבר כמורה"); return; }
      var near = noteNear(sheet, e.clientX, e.clientY);
      if (near) { select(sheet, near, true, e.clientX, e.clientY); return; }
      var rect = layer.getBoundingClientRect();
      var note = {
        x: clamp((e.clientX - rect.left) / rect.width, MIN_X, 1),
        y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
        text: ""
      };
      var s = scaleForPage(sheet);
      if (s !== 1) note.scale = s;
      pageData(sheet.id).notes.push(note);
      var el = makeNoteEl(sheet, note);
      layer.appendChild(el);
      select(sheet, el, true);
    });
  }

  /* ---------- drawings ---------- */

  function pt(p) { return round1(p[0]) + " " + round1(p[1]); }
  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
  function arrowHead(a, b, w) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var size = Math.min(Math.max(14, w * 3.4), Math.hypot(dx, dy) * 0.6);
    var ang = Math.atan2(dy, dx);
    var spread = Math.PI / 7;
    return [
      [b[0] - size * Math.cos(ang - spread), b[1] - size * Math.sin(ang - spread)],
      [b[0] - size * Math.cos(ang + spread), b[1] - size * Math.sin(ang + spread)]
    ];
  }
  // Freehand strokes are smoothed with quadratic curves through the midpoints.
  function penHead(p, upTo) {
    var d = "M" + pt(p[0]);
    for (var i = 1; i < upTo; i++) d += "Q" + pt(p[i]) + " " + pt(mid(p[i], p[i + 1]));
    return d;
  }
  function pathOf(s) {
    var p = s.points;
    if (s.tool === "pen") {
      if (p.length === 1) return "M" + pt(p[0]) + "h0.01";
      return penHead(p, p.length - 1) + "L" + pt(p[p.length - 1]);
    }
    var a = p[0];
    var b = p[p.length - 1];
    var d = "M" + pt(a) + "L" + pt(b);
    if (s.tool === "arrow" && (a[0] !== b[0] || a[1] !== b[1])) {
      var h = arrowHead(a, b, s.width);
      d += "M" + pt(h[0]) + "L" + pt(b) + "L" + pt(h[1]);
    }
    return d;
  }
  function applyStroke(el, s) {
    var a = s.points[0];
    var b = s.points[s.points.length - 1];
    if (s.tool === "rect") {
      el.setAttribute("x", round1(Math.min(a[0], b[0])));
      el.setAttribute("y", round1(Math.min(a[1], b[1])));
      el.setAttribute("width", round1(Math.abs(b[0] - a[0])));
      el.setAttribute("height", round1(Math.abs(b[1] - a[1])));
      el.setAttribute("rx", round1(s.width * 0.6));
    } else if (s.tool === "ellipse") {
      el.setAttribute("cx", round1((a[0] + b[0]) / 2));
      el.setAttribute("cy", round1((a[1] + b[1]) / 2));
      el.setAttribute("rx", round1(Math.abs(b[0] - a[0]) / 2));
      el.setAttribute("ry", round1(Math.abs(b[1] - a[1]) / 2));
    } else {
      el.setAttribute("d", pathOf(s));
    }
  }
  function makeStrokeEl(s) {
    var tag = s.tool === "rect" ? "rect" : (s.tool === "ellipse" ? "ellipse" : "path");
    var el = document.createElementNS(SVG_NS, tag);
    el.setAttribute("class", "ink-stroke");
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", s.color);
    el.setAttribute("stroke-width", s.width);
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    el.strokeData = s;
    applyStroke(el, s);
    return el;
  }

  function segmentsOf(s) {
    var p = s.points;
    var a = p[0];
    var b = p[p.length - 1];
    var out = [];
    var i;
    if (s.tool === "pen") {
      if (p.length === 1) out.push([a, a]);
      for (i = 1; i < p.length; i++) out.push([p[i - 1], p[i]]);
    } else if (s.tool === "line") {
      out.push([a, b]);
    } else if (s.tool === "arrow") {
      var h = arrowHead(a, b, s.width);
      out.push([a, b], [h[0], b], [h[1], b]);
    } else if (s.tool === "rect") {
      var c1 = [a[0], b[1]];
      var c2 = [b[0], a[1]];
      out.push([a, c1], [c1, b], [b, c2], [c2, a]);
    } else if (s.tool === "ellipse") {
      var cx = (a[0] + b[0]) / 2;
      var cy = (a[1] + b[1]) / 2;
      var rx = Math.abs(b[0] - a[0]) / 2;
      var ry = Math.abs(b[1] - a[1]) / 2;
      var prev = [cx + rx, cy];
      for (i = 1; i <= 48; i++) {
        var t = i / 48 * Math.PI * 2;
        var cur = [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
        out.push([prev, cur]);
        prev = cur;
      }
    }
    return out;
  }
  function distPointSeg(p, a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len2 = dx * dx + dy * dy;
    var t = len2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1) : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }
  function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  function distSegSeg(a, b, c, d) {
    var d1 = cross(c, d, a);
    var d2 = cross(c, d, b);
    var d3 = cross(a, b, c);
    var d4 = cross(a, b, d);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
    return Math.min(distPointSeg(a, c, d), distPointSeg(b, c, d), distPointSeg(c, a, b), distPointSeg(d, a, b));
  }

  // The eraser only touches annotations; the page image underneath is never modified.
  function eraseAlong(sheet, a, b, tol, clientX, clientY) {
    var data = pagesData[sheet.id];
    if (!data) return false;
    var hit = false;
    for (var i = data.strokes.length - 1; i >= 0; i--) {
      var s = data.strokes[i];
      var segs = segmentsOf(s);
      var limit = tol + s.width / 2;
      for (var j = 0; j < segs.length; j++) {
        if (distSegSeg(a, b, segs[j][0], segs[j][1]) <= limit) {
          Array.prototype.forEach.call(sheet.ink.childNodes, function (node) {
            if (node.strokeData === s) sheet.ink.removeChild(node);
          });
          data.strokes.splice(i, 1);
          hit = true;
          break;
        }
      }
    }
    Array.prototype.slice.call(sheet.layer.querySelectorAll(".note")).forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        removeNote(sheet, el);
        hit = true;
      }
    });
    return hit;
  }

  // Page units per screen pixel at 100% zoom (layout width ignores CSS transforms).
  function unitsPerPx(sheet) {
    return VB_W / (sheet.el.offsetWidth || VB_W);
  }
  function toUnits(sheet, e) {
    var r = sheet.ink.getBoundingClientRect();
    var k = VB_W / (r.width || 1);
    return [
      round1(clamp((e.clientX - r.left) * k, 0, VB_W)),
      round1(clamp((e.clientY - r.top) * k, 0, sheet.vbH))
    ];
  }
  function constrain(kind, a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    if (kind === "rect" || kind === "ellipse") {
      var side = Math.max(Math.abs(dx), Math.abs(dy));
      return [a[0] + (dx < 0 ? -side : side), a[1] + (dy < 0 ? -side : side)];
    }
    var len = Math.hypot(dx, dy);
    var ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return [round1(a[0] + len * Math.cos(ang)), round1(a[1] + len * Math.sin(ang))];
  }

  function cancelGesture() {
    var g = gesture;
    if (!g) return;
    gesture = null;
    if (g.frame) cancelAnimationFrame(g.frame);
    if (g.erase) {
      if (g.hit) commit();
      return;
    }
    if (g.el.parentNode) g.el.parentNode.removeChild(g.el);
  }

  // Redraws the stroke being drawn at most once per frame. Freehand strokes extend a cached
  // path prefix, so long strokes stay smooth on slower classroom computers.
  function paintGesture(g) {
    g.frame = 0;
    var s = g.stroke;
    if (s.tool !== "pen") { applyStroke(g.el, s); return; }
    var p = s.points;
    if (p.length === 1) { g.el.setAttribute("d", pathOf(s)); return; }
    while (g.done < p.length - 2) {
      g.done += 1;
      g.head += "Q" + pt(p[g.done]) + " " + pt(mid(p[g.done], p[g.done + 1]));
    }
    g.el.setAttribute("d", g.head + "L" + pt(p[p.length - 1]));
  }
  function schedulePaint(g) {
    if (!g.frame) g.frame = requestAnimationFrame(function () { if (gesture === g) paintGesture(g); });
  }

  function bindInk(sheet) {
    var svg = sheet.ink;
    // Drawing must not also pan the page underneath.
    svg.addEventListener("mousedown", function (e) {
      if (mode === "draw") e.stopPropagation();
    });
    svg.addEventListener("pointerdown", function (e) {
      if (mode !== "draw" || gesture || !e.isPrimary) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (!user()) { opts.toast("צריך להתחבר כמורה"); return; }
      try { svg.setPointerCapture(e.pointerId); } catch (err) {}
      var p = toUnits(sheet, e);
      if (tool === "eraser") {
        gesture = { sheet: sheet, id: e.pointerId, erase: true, last: p, hit: false, tol: e.pointerType === "mouse" ? 5 : 10 };
        gesture.hit = eraseAlong(sheet, p, p, gesture.tol, e.clientX, e.clientY);
        return;
      }
      var px = tool === "pen" ? penWidth : width;
      var s = {
        tool: tool,
        color: color,
        width: round2(px * unitsPerPx(sheet)),
        points: tool === "pen" ? [p] : [p, p.slice()]
      };
      var el = makeStrokeEl(s);
      el.classList.add("is-preview");
      svg.appendChild(el);
      gesture = { sheet: sheet, id: e.pointerId, stroke: s, el: el, head: "M" + pt(p), done: 0, frame: 0 };
    });
    svg.addEventListener("pointermove", function (e) {
      var g = gesture;
      if (!g || g.sheet !== sheet || e.pointerId !== g.id) return;
      e.preventDefault();
      var list = (g.erase || g.stroke.tool === "pen") && e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (!list.length) list = [e];
      list.forEach(function (ev) {
        var p = toUnits(sheet, ev);
        if (g.erase) {
          if (eraseAlong(sheet, g.last, p, g.tol, ev.clientX, ev.clientY)) g.hit = true;
          g.last = p;
          return;
        }
        var pts = g.stroke.points;
        if (g.stroke.tool === "pen") {
          var last = pts[pts.length - 1];
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1) pts.push(p);
        } else {
          pts[1] = e.shiftKey ? constrain(g.stroke.tool, pts[0], p) : p;
        }
      });
      if (!g.erase) schedulePaint(g);
    });
    function end(e) {
      var g = gesture;
      if (!g || g.sheet !== sheet || e.pointerId !== g.id) return;
      gesture = null;
      if (g.frame) cancelAnimationFrame(g.frame);
      if (g.erase) {
        if (g.hit) commit();
        return;
      }
      var s = g.stroke;
      var a = s.points[0];
      var b = s.points[s.points.length - 1];
      if (s.tool !== "pen" && Math.hypot(b[0] - a[0], b[1] - a[1]) < 4) {
        if (g.el.parentNode) g.el.parentNode.removeChild(g.el);
        return;
      }
      applyStroke(g.el, s);
      g.el.classList.remove("is-preview");
      pageData(sheet.id).strokes.push(s);
      commit();
    }
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
  }

  /* ---------- tool panel ---------- */

  function panelButton(cls, label, html, onClick, parent) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "ink-btn " + cls;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = html;
    b.addEventListener("click", onClick);
    (parent || panel).appendChild(b);
    return b;
  }
  // A short diagonal line drawn at the real width, so thin pens look thin in the picker.
  function widthSample(px) {
    var w = Math.max(px, 0.5);
    return '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19L19 5" stroke="currentColor" stroke-width="' + w + '" stroke-linecap="round" fill="none"/></svg>';
  }
  function resetClearButton() {
    clearTimeout(confirmTid);
    confirmTid = null;
    if (!panel) return;
    var b = panel.querySelector(".ink-clear");
    b.classList.remove("is-confirm");
    b.textContent = "נקה הכול";
  }
  function onClearClick() {
    var b = panel.querySelector(".ink-clear");
    if (!b.classList.contains("is-confirm")) {
      b.classList.add("is-confirm");
      b.textContent = "למחוק הכול?";
      clearTimeout(confirmTid);
      confirmTid = setTimeout(resetClearButton, CONFIRM_MS);
      return;
    }
    resetClearButton();
    clearAll();
  }
  function buildPanel() {
    panel = document.createElement("div");
    panel.className = "ink-panel";
    panel.dir = "rtl";
    panel.setAttribute("role", "toolbar");
    panel.setAttribute("aria-label", "כלי סימון על הדף");
    TOOLS.forEach(function (t) {
      panelButton("ink-draw-only ink-tool", t.label, t.icon, function () { tool = t.id; syncPanel(); }).dataset.tool = t.id;
    });
    var penRow = document.createElement("div");
    penRow.className = "ink-draw-only ink-pen-widths";
    penRow.setAttribute("role", "group");
    penRow.setAttribute("aria-label", "עובי העט");
    panel.appendChild(penRow);
    PEN_WIDTHS.forEach(function (w) {
      var b = panelButton("ink-pen-width", w.label, widthSample(w.px), function () { penWidth = w.px; syncPanel(); }, penRow);
      b.dataset.penWidth = String(w.px);
    });
    WIDTHS.forEach(function (w) {
      var b = panelButton("ink-draw-only ink-width", w.label, widthSample(w.px), function () { width = w.px; syncPanel(); });
      b.dataset.width = String(w.px);
    });
    COLORS.forEach(function (c) {
      var b = panelButton("ink-draw-only ink-color", c.label, '<span class="ink-swatch" style="background:' + c.value + '"></span>', function () { color = c.value; syncPanel(); });
      b.dataset.color = c.value;
    });
    panelButton("ink-undo", "ביטול (Ctrl+Z)", icon('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'), undo);
    panelButton("ink-redo", "חזרה (Ctrl+Y)", icon('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'), redo);
    panelButton("ink-exit", "סיום (חזרה לדפדוף)", icon('<path d="M6 6l12 12M18 6L6 18"/>'), function () { setMode(null); });
    panelButton("ink-clear", "נקה הכול", "נקה הכול", onClearClick);
    panel.addEventListener("mousedown", function (e) { e.preventDefault(); });
    document.body.appendChild(panel);
  }
  function syncPanel() {
    document.body.classList.toggle("ink-erasing", tool === "eraser");
    if (!panel) return;
    panel.classList.toggle("is-pen", tool === "pen");
    Array.prototype.forEach.call(panel.querySelectorAll(".ink-btn"), function (b) {
      var on = (b.dataset.tool && b.dataset.tool === tool) ||
        (b.dataset.width && Number(b.dataset.width) === width) ||
        (b.dataset.penWidth && Number(b.dataset.penWidth) === penWidth) ||
        (b.dataset.color && b.dataset.color === color);
      if (b.dataset.tool || b.dataset.width || b.dataset.penWidth || b.dataset.color) b.setAttribute("aria-pressed", String(!!on));
    });
    panel.querySelector(".ink-undo").disabled = histPos <= 0;
    panel.querySelector(".ink-redo").disabled = histPos >= history.length - 1;
    var clear = panel.querySelector(".ink-clear");
    clear.disabled = !hasContent();
    if (clear.disabled) resetClearButton();
  }

  /* ---------- modes ---------- */

  function setMode(next) {
    next = (next === "write" || next === "draw") ? next : null;
    if (next && (!sheets.length || opts.isBlocked())) return;
    if (next && !user()) { opts.toast("צריך להתחבר כמורה"); return; }
    settle();
    sheets.forEach(function (sheet) { showZone(sheet, null); });
    mode = next;
    var body = document.body;
    body.classList.toggle("is-writing", mode === "write");
    body.classList.toggle("is-drawing", mode === "draw");
    body.classList.toggle("is-annotating", !!mode);
    eachButton(function (b, k) {
      b.setAttribute("aria-pressed", String(mode === k));
      b.classList.toggle("is-on", mode === k);
    });
    if (mode && !panel) buildPanel();
    if (!mode) resetClearButton();
    syncPanel();
    if (mode && !hinted[mode]) {
      hinted[mode] = true;
      opts.toast(mode === "write" ? "הקישו על מקום ריק בדף כדי לכתוב · Ctrl+Z לביטול" : "גררו על הדף כדי לצייר");
    }
  }

  // pending: pages are still loading (e.g. a PDF being rendered), so an active mode is kept.
  function syncButtons(pending) {
    var ok = sheets.length > 0;
    if (!ok && mode && !pending) setMode(null);
    eachButton(function (b, k) {
      b.disabled = !ok;
      if (k === "write") b.title = ok ? "כתיבה על הדף" : "אין כאן דף לכתיבה";
      else b.title = ok ? "ציור על הדף" : "אין כאן דף לציור";
    });
  }

  function isTypingTarget(t) {
    return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  }
  function stopKey(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  // Runs in the capture phase, before the site's own shortcuts (page arrows, Escape...).
  function onKeyDown(e) {
    if (!mode || opts.isBlocked()) return;
    if (editor && e.target === editor) {
      if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        stopKey(e);
        stopEdit();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !editor.value) {
        // Delete in an empty note removes it, the same as on a selected note.
        stopKey(e);
        deleteSelected();
      }
      return;
    }
    if (isTypingTarget(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      var k = String(e.key || "").toLowerCase();
      var isZ = e.code === "KeyZ" || k === "z";
      var isY = e.code === "KeyY" || k === "y";
      if (isZ && !e.shiftKey) { stopKey(e); undo(); }
      else if (isY || (isZ && e.shiftKey)) { stopKey(e); redo(); }
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (gesture && e.key === "Escape") { stopKey(e); cancelGesture(); return; }
    // Writing has no panel: with nothing selected, Escape switches writing off (like the כתיבה button).
    if (mode === "write" && !selected && e.key === "Escape") { stopKey(e); setMode(null); return; }
    if (!selected || editing) return;
    var dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (dir) { stopKey(e); nudge(dir[0], dir[1], e.shiftKey); return; }
    if (e.key === "Delete" || e.key === "Backspace") { stopKey(e); deleteSelected(); return; }
    if (e.key === "Enter" || e.key === "F2") { stopKey(e); startEdit(); return; }
    if (e.key === "Escape") { stopKey(e); deselect(); }
  }

  /* ---------- sheets ---------- */

  function naturalRatio(media) {
    var isImg = media.tagName === "IMG";
    var w = isImg ? media.naturalWidth : media.width;
    var h = isImg ? media.naturalHeight : media.height;
    return (w && h) ? h / w : DEFAULT_RATIO;
  }
  function setViewBox(sheet) {
    sheet.vbH = round1(VB_W * naturalRatio(sheet.media));
    sheet.ink.setAttribute("viewBox", "0 0 " + VB_W + " " + sheet.vbH);
  }
  function sizeSheet(sheet) {
    var w = sheet.el.clientWidth;
    if (w) sheet.layer.style.fontSize = (w * sheet.fontRatio).toFixed(2) + "px";
  }
  function renderSheet(sheet) {
    Array.prototype.slice.call(sheet.layer.querySelectorAll(".note")).forEach(function (n) { n.remove(); });
    while (sheet.ink.firstChild) sheet.ink.removeChild(sheet.ink.firstChild);
    var data = pagesData[sheet.id];
    if (!data) return;
    data.strokes.forEach(function (s) { sheet.ink.appendChild(makeStrokeEl(s)); });
    data.notes.forEach(function (n) { sheet.layer.appendChild(makeNoteEl(sheet, n)); });
  }
  function renderAll() { sheets.forEach(renderSheet); }

  function unmountSheets() {
    sheets.forEach(function (sheet) {
      if (sheet.media && sheet.onLoad) sheet.media.removeEventListener("load", sheet.onLoad);
      if (sheet.ink.parentNode) sheet.ink.parentNode.removeChild(sheet.ink);
      if (sheet.layer.parentNode) sheet.layer.parentNode.removeChild(sheet.layer);
    });
    sheets = [];
    if (resizeObs) resizeObs.disconnect();
  }

  // target: an <img>/<canvas> (wrapped in a positioned .note-sheet), or { host, media } where
  // host is an existing positioned element whose box exactly covers the media.
  function makeSheet(target, id, fontRatio) {
    var media = target.media || target;
    var host = target.host;
    if (!host) {
      host = media.parentNode && media.parentNode.classList.contains("note-sheet") ? media.parentNode : null;
      if (!host) {
        host = document.createElement("div");
        host.className = "note-sheet";
        media.parentNode.insertBefore(host, media);
        host.appendChild(media);
      }
    }
    var ink = document.createElementNS(SVG_NS, "svg");
    ink.setAttribute("class", "ink-layer");
    ink.setAttribute("aria-hidden", "true");
    host.appendChild(ink);
    var layer = document.createElement("div");
    layer.className = "note-layer";
    host.appendChild(layer);
    var sheet = { el: host, media: media, ink: ink, layer: layer, id: id, vbH: VB_W * DEFAULT_RATIO, fontRatio: fontRatio || FONT_RATIO };
    setViewBox(sheet);
    if (media.tagName === "IMG") {
      sheet.onLoad = function () { setViewBox(sheet); sizeSheet(sheet); };
      media.addEventListener("load", sheet.onLoad);
    }
    bindInk(sheet);
    bindLayer(sheet);
    return sheet;
  }

  // Shows annotation layers over the given targets. key identifies what is on screen
  // (a Mishnah, a Gemara page, a worksheet); a different key always starts clean.
  // A null key (e.g. a video) shows no layers and clears everything.
  // targets: <img>/<canvas> elements (wrapped automatically) or {host, media} pairs.
  // options: fontRatio (note size / sheet width), pending (pages still loading; keep the mode).
  function mount(key, targets, options) {
    options = options || {};
    settle();
    if (key !== docKey) {
      docKey = key;
      pagesData = {};
      pageScale = {};
      resetHistory();
    }
    unmountSheets();
    if (key && targets) {
      Array.prototype.slice.call(targets).forEach(function (target, i) {
        if (target) sheets.push(makeSheet(target, i, options.fontRatio));
      });
    }
    sheets.forEach(function (sheet) { renderSheet(sheet); sizeSheet(sheet); });
    if (typeof ResizeObserver === "function") {
      if (!resizeObs) resizeObs = new ResizeObserver(function () { sheets.forEach(sizeSheet); });
      sheets.forEach(function (s) { resizeObs.observe(s.el); });
    }
    syncButtons(!!options.pending);
    syncPanel();
  }

  function onAuthChange() {
    settle();
    pagesData = {};
    pageScale = {};
    resetHistory();
    if (!user()) setMode(null);
    renderAll();
  }

  function asList(v) {
    if (!v) return [];
    return Array.isArray(v) ? v.filter(Boolean) : [v];
  }
  function init(config) {
    config = config || {};
    if (config.getUser) opts.getUser = config.getUser;
    if (config.toast) opts.toast = config.toast;
    if (config.isBlocked) opts.isBlocked = config.isBlocked;
    buttons.write = asList(config.writeButton);
    buttons.draw = asList(config.drawButton);
    eachButton(function (b, k) {
      b.addEventListener("click", function () { setMode(mode === k ? null : k); });
    });
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onTouchDown, true);
    document.addEventListener("pointermove", onTouchMove, true);
    document.addEventListener("pointerup", onTouchUp, true);
    document.addEventListener("pointercancel", onTouchUp, true);
    window.addEventListener("resize", function () { sheets.forEach(sizeSheet); });
    resetHistory();
    syncButtons();
  }

  global.PageNotes = {
    init: init,
    mount: mount,
    onAuthChange: onAuthChange,
    setMode: setMode,
    getMode: function () { return mode; },
    undo: undo,
    redo: redo,
    clearAll: clearAll
  };
})(window);
