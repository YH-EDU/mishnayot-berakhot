/*! Berakhot Mishnah Quiz */
(function (global) {
  "use strict";
  var STORAGE_PREFIX = "berakhot-quiz:v1:";
  var opts = {
    getContext: function () { return { perek: 1, mish: 1, label: "", username: "" }; },
    toast: function (msg) { if (global.showToast) global.showToast(msg); else try { alert(msg); } catch (e) {} }
  };
  var mode = "play";
  var quizIndex = 0;
  var quizPicked = {};
  var tableDrag = null;
  var winPlayed = {};
  var editList = null; // working copy while editing
  var quizOpen = false;

  function ctx() { return opts.getContext() || {}; }
  function mishKey() {
    var c = ctx();
    return String(c.perek || 1) + "-" + String(c.mish || 1);
  }
  function username() { return String((ctx().username || "")).trim(); }
  function storageKey(user, key) { return STORAGE_PREFIX + (user || "_") + ":" + (key || mishKey()); }
  function loadQuestions(user, key) {
    if (!user) return [];
    try {
      var raw = localStorage.getItem(storageKey(user, key));
      if (!raw) return [];
      var data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
  }
  function saveQuestions(list) {
    var user = username();
    if (!user) { opts.toast("צריך להתחבר כמורה"); return false; }
    try {
      localStorage.setItem(storageKey(user, mishKey()), JSON.stringify(list || []));
      updateBadge();
      return true;
    } catch (e) { opts.toast("השמירה נכשלה"); return false; }
  }
  function ensureList() { return loadQuestions(username(), mishKey()).slice(); }
  function persistCurrent() {
    if (editList) saveQuestions(editList);
  }
  function playTap() {}
  function playWinOnce() {
    var k = quizKeyAt(quizIndex);
    if (winPlayed[k]) return;
    winPlayed[k] = true;
  }
  function noteAttempt() {}
  function quizKeyAt(i) { return mishKey() + "#" + i; }


function quizKindLabel(item) {
  if (item.type === "tf") return "נכון / לא נכון";
  if (item.type === "match") return "התאמת מושגים";
  if (item.type === "cloze") return "השלמת משפט";
  if (item.type === "table") return "גרירת פתקים לטבלה";
  if (item.type === "order") return "גרירת פתקים לסדר";
  if (item.type === "flow") return "מהלך הסוגיא";
  if (item.type === "pick") return "בחירה בתוך המשפט";
  if (item.type === "multi") return "סימון כל הנכונות";
  if (item.type === "stage") return "זיהוי שלב הסוגיא";
  if (item.type === "typein") return "כתיבת התשובה";
  return "רב־ברירה";
}
// האם השאלה כבר נענתה נכון — לצביעת נקודות ההתקדמות.
function quizOutcome(item, st) {
  if (st === undefined || st === null) return null;
  if (typeof st !== "object") {
    const correct = item.type === "tf" ? (item.answer ? 0 : 1) : item.answer;
    return st === correct ? "right" : "wrong";
  }
  if (st.kind === "match") return st.matched && st.matched.length === (item.pairs || []).length ? "right" : null;
  if (st.kind === "table" || st.kind === "flow") {
    const rows = item.rows || [];
    if (!rows.length) return null;
    return tableAllRight(st, rows) ? "right" : null;
  }
  if (st.kind === "order") {
    const items = item.items || [];
    if (Array.isArray(st.slots)) return orderAllRight(st, items) ? "right" : null;
    return st.placed && st.placed.length === items.length ? "right" : null;
  }
  if (st.kind === "pick") {
    const lines = item.lines || [];
    const done = lines.every(function (_, i) { return st.pick[i] !== undefined; });
    if (!done) return null;
    return lines.every(function (l, i) { return st.pick[i] === l.answer; }) ? "right" : "wrong";
  }
  if (st.kind === "multi") {
    if (!st.checked) return null;
    return st.wasRight ? "right" : "wrong";
  }
  if (st.kind === "typein") {
    if (!st.checked) return null;
    return st.wasRight ? "right" : "wrong";
  }
  return null;
}
function renderQuizDots(list) {
  const host = document.getElementById("quizDots");
  host.innerHTML = "";
  list.forEach(function (item, i) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", "שאלה " + (i + 1));
    const out = quizOutcome(item, quizPicked[quizKeyAt(i)]);
    if (out) b.classList.add(out === "right" ? "is-right" : "is-wrong");
    if (i === quizIndex) b.classList.add("is-now");
    b.addEventListener("click", function () { quizIndex = i; renderPlay(); });
    host.appendChild(b);
  });
}
function shuffleIdx(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function ensureChoiceOrder(n) {
  const k = quizKeyAt(quizIndex) + "|ord";
  let ord = quizPicked[k];
  if (!Array.isArray(ord) || ord.length !== n) {
    ord = shuffleIdx(n);
    quizPicked[k] = ord;
  }
  return ord;
}
function ensureBankOrder(st, n) {
  if (!Array.isArray(st.bankOrd) || st.bankOrd.length !== n) st.bankOrd = shuffleIdx(n);
  return st.bankOrd;
}

function showQuizNote(item, note, done) {
  if (done && item.note) {
    note.hidden = false;
    note.textContent = item.note;
  } else {
    note.hidden = true;
    note.textContent = "";
  }
}
function renderChoiceQuiz(item, opts, note) {
  const isTf = item.type === "tf";
  const choices = isTf ? ["נכון", "לא נכון"] : item.choices;
  const order = isTf ? [0, 1] : ensureChoiceOrder(choices.length);
  const picked = quizPicked[quizKeyAt(quizIndex)];
  const correct = isTf ? (item.answer ? 0 : 1) : item.answer;
  order.forEach(function (orig) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quiz-opt";
    btn.textContent = choices[orig];
    if (picked !== undefined && typeof picked !== "object") {
      btn.disabled = true;
      if (orig === correct) btn.classList.add("is-right");
      else if (orig === picked) btn.classList.add("is-wrong");
    }
    btn.addEventListener("click", function () {
      quizPicked[quizKeyAt(quizIndex)] = orig;
      noteAttempt(orig === correct);
      renderPlay();
    });
    opts.appendChild(btn);
  });
  showQuizNote(item, note, picked !== undefined && typeof picked !== "object");
}
function renderStageQuiz(item, opts, note) {
  const picked = quizPicked[quizKeyAt(quizIndex)];
  const answered = picked !== undefined && typeof picked !== "object";
  if (true) {
    const phrase = document.createElement("p");
    phrase.className = "stage-phrase";
    phrase.textContent = item.phrase || "";
    opts.appendChild(phrase);
  }
  const hint = document.createElement("p");
  hint.className = "quiz-hint";
  hint.textContent = item.hint || "איזה שלב בסוגיא פותחות המילים האלה?";
  opts.appendChild(hint);
  const row = document.createElement("div");
  row.className = "stage-row";
  ensureChoiceOrder((item.choices || []).length).forEach(function (orig) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stage-btn";
    btn.textContent = item.choices[orig];
    if (answered) {
      btn.disabled = true;
      if (orig === item.answer) btn.classList.add("is-right");
      else if (orig === picked) btn.classList.add("is-wrong");
    }
    btn.addEventListener("click", function () {
      quizPicked[quizKeyAt(quizIndex)] = orig;
      noteAttempt(orig === item.answer);
      renderPlay();
    });
    row.appendChild(btn);
  });
  opts.appendChild(row);
  showQuizNote(item, note, answered);
}
function answerWordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length || 1;
}
function appendBlankRun(host, n, filledText, state) {
  const words = filledText ? String(filledText).trim().split(/\s+/).filter(Boolean) : [];
  const wrap = document.createElement("span");
  wrap.className = "quiz-blanks";
  wrap.setAttribute("dir", "rtl");
  for (let i = 0; i < n; i++) {
    const b = document.createElement("span");
    b.className = "quiz-blank" + (state ? " is-" + state : "");
    b.textContent = words[i] || "\u00a0";
    wrap.appendChild(b);
  }
  host.appendChild(wrap);
}
function fillSentenceBlanks(sentenceEl, template, filledText, state, nWords) {
  const parts = String(template || "").split(/_{2,}/);
  sentenceEl.appendChild(document.createTextNode(parts[0] || ""));
  appendBlankRun(sentenceEl, nWords, filledText, state);
  sentenceEl.appendChild(document.createTextNode(parts.slice(1).join("") || ""));
}
function renderClozeQuiz(item, opts, note) {
  const picked = quizPicked[quizKeyAt(quizIndex)];
  const correct = item.answer;
  const choices = item.choices || [];
  const nWords = answerWordCount(choices[correct] || "");
  const answered = picked !== undefined && typeof picked !== "object";
  const filled = answered ? (choices[picked] || "") : "";
  const state = answered ? (picked === correct ? "right" : "wrong") : "";
  const sentence = document.createElement("p");
  sentence.className = "quiz-sentence";
  fillSentenceBlanks(sentence, item.sentence, filled, state, nWords);
  opts.appendChild(sentence);
  const hint = document.createElement("p");
  hint.className = "quiz-hint";
  hint.textContent = nWords > 1
    ? "בחרו מילה מהמאגר להשלמת המשפט — " + nWords + " קווים, כמספר המילים"
    : "בחרו מילה מהמאגר להשלמת המשפט";
  opts.appendChild(hint);
  const bank = document.createElement("div");
  bank.className = "bank-row";
  ensureChoiceOrder(choices.length).forEach(function (orig) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "bank-chip";
    chip.textContent = choices[orig];
    if (answered) {
      chip.disabled = true;
      if (orig === correct) chip.classList.add("is-right");
      if (orig === picked && picked !== correct) chip.classList.add("is-wrong");
    }
    chip.addEventListener("click", function () {
      quizPicked[quizKeyAt(quizIndex)] = orig;
      renderPlay();
    });
    bank.appendChild(chip);
  });
  opts.appendChild(bank);
  showQuizNote(item, note, answered);
}
function renderMatchQuiz(item, opts, note, store, storeKey, rerender) {
  const pairs = item.pairs || [];
  store = store || quizPicked;
  storeKey = storeKey == null ? quizKeyAt(quizIndex) : storeKey;
  rerender = rerender || renderPlay;
  let st = store[storeKey];
  if (!st || st.kind !== "match" || !st.left || st.left.length !== pairs.length) {
    st = { kind: "match", matched: [], selected: null, left: shuffleIdx(pairs.length), right: shuffleIdx(pairs.length) };
    store[storeKey] = st;
  }
  const hint = document.createElement("p");
  hint.className = "quiz-hint";
  hint.textContent = item.hint || "לחצו על פריט בטור אחד ואז על ההתאמה בטור השני — לא משנה מאיזה צד";
  opts.appendChild(hint);
  const board = document.createElement("div");
  board.className = "match-board";
  const leftIsAr = item.arFont !== false;
  const GAP = 10;
  const MIN_H = 56;
  function rowOf(base, i) {
    const rest = base.filter(function (k) { return st.matched.indexOf(k) < 0; });
    const at = st.matched.indexOf(i);
    return at >= 0 ? at : st.matched.length + rest.indexOf(i);
  }
  const prevPos = st.pos || { ar: {}, he: {} };
  const hasPrev = !!(prevPos.ar && Object.keys(prevPos.ar).length);
  const placed = [];
  const tracks = [];
  function col(title, side, order, fancy) {
    const wrap = document.createElement("div");
    wrap.className = "match-col";
    const h = document.createElement("h4");
    h.textContent = title;
    wrap.appendChild(h);
    const track = document.createElement("div");
    track.className = "match-col-track";
    wrap.appendChild(track);
    tracks.push(track);
    pairs.forEach(function (_, i) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "match-card" + (fancy ? " is-ar" : "");
      btn.textContent = side === "ar" ? pairs[i].ar : pairs[i].he;
      const done = st.matched.indexOf(i) >= 0;
      if (done) btn.classList.add("is-right");
      if (st.selected && st.selected.side === side && st.selected.i === i) btn.classList.add("is-on");
      if (st.wrong && st.wrong.side === side && st.wrong.i === i) btn.classList.add("is-wrong");
      btn.disabled = done;
      const row = rowOf(order, i);
      placed.push({ btn: btn, side: side, i: i, row: row });
      btn.addEventListener("click", function () {
        if (done) return;
        if (!st.selected || st.selected.side === side) {
          st.selected = (st.selected && st.selected.side === side && st.selected.i === i) ? null : { side: side, i: i };
          st.wrong = null;
          rerender();
          return;
        }
        const ok = st.selected.i === i;
        if (ok) {
          st.matched.push(i);
          st.selected = null;
          st.wrong = null;
        } else {
          st.wrong = { side: side, i: i };
          setTimeout(function () {
            if (store[storeKey] === st) {
              st.selected = null;
              st.wrong = null;
              rerender();
            }
          }, 420);
        }
        rerender();
      });
      track.appendChild(btn);
    });
    board.appendChild(wrap);
  }
  col(item.leftLabel || "מושג", "ar", st.left, leftIsAr);
  col(item.rightLabel || "משמעות", "he", st.right, false);
  opts.appendChild(board);
  const step0 = MIN_H + GAP;
  tracks.forEach(function (track) {
    track.style.height = Math.max(0, pairs.length * step0 - GAP) + "px";
  });
  placed.forEach(function (item) {
    const dest = item.row * step0;
    const from = prevPos[item.side] ? prevPos[item.side][item.i] : undefined;
    item.btn.style.transition = "none";
    item.btn.style.top = (from != null ? from : dest) + "px";
  });
  requestAnimationFrame(function () {
    let maxH = MIN_H;
    placed.forEach(function (item) { maxH = Math.max(maxH, item.btn.offsetHeight || MIN_H); });
    const step = maxH + GAP;
    const nextPos = { ar: {}, he: {} };
    tracks.forEach(function (track) {
      track.style.height = Math.max(0, pairs.length * step - GAP) + "px";
    });
    placed.forEach(function (item) {
      const top = item.row * step;
      item.btn.style.minHeight = maxH + "px";
      item.btn.style.transition = hasPrev ? "" : "none";
      item.btn.style.top = top + "px";
      nextPos[item.side][item.i] = top;
    });
    if (store[storeKey] === st) st.pos = nextPos;
    if (!hasPrev) {
      requestAnimationFrame(function () {
        placed.forEach(function (item) { item.btn.style.transition = ""; });
      });
    }
  });
  showQuizNote(item, note, st.matched.length === pairs.length);
  return st;
}

function tableDropSlackPx() {
  const fine = window.matchMedia("(pointer: fine)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (fine && !coarse) return 48;
  if (fine) return 36;
  return 22;
}
function distToRect(x, y, r) {
  const cx = Math.min(Math.max(x, r.left), r.right);
  const cy = Math.min(Math.max(y, r.top), r.bottom);
  return Math.hypot(x - cx, y - cy);
}
function tableSlotParts(slot) {
  if (slot == null || slot === "") return null;
  const s = String(slot);
  if (s.indexOf(":") >= 0) {
    const p = s.split(":");
    return { r: Number(p[0]), c: Number(p[1]), key: s };
  }
  return { r: Number(s), c: 0, key: s };
}
function tableRowAnswers(row) {
  if (!row) return [];
  if (Array.isArray(row.answers) && row.answers.length) return row.answers;
  return [row.answer];
}
function tableFillKey(row, r, c) {
  if (c > 0 || (row && Array.isArray(row.answers) && row.answers.length > 1)) return r + ":" + c;
  return String(r);
}
function tableExpected(rows, slot) {
  const p = tableSlotParts(slot);
  if (!p || !rows[p.r]) return undefined;
  const answers = tableRowAnswers(rows[p.r]);
  return answers[p.c];
}
function tableSlotLocked(st, rows, slot) {
  const expected = tableExpected(rows, slot);
  const p = tableSlotParts(slot);
  if (!p) return false;
  const key = tableFillKey(rows[p.r], p.r, p.c);
  return expected != null && st.fill[key] === expected;
}
function tableAllRight(st, rows) {
  if (!st || !st.fill || !rows.length) return false;
  return rows.every(function (row, r) {
    return tableRowAnswers(row).every(function (ans, c) {
      return st.fill[tableFillKey(row, r, c)] === ans;
    });
  });
}
function tableSlotFromPoint(x, y) {
  const hit = document.elementFromPoint(x, y);
  const slotEl = hit && hit.closest ? hit.closest("[data-table-slot]") : null;
  if (slotEl && slotEl.dataset.tableSlot != null && slotEl.dataset.tableSlot !== "") {
    return slotEl.dataset.tableSlot;
  }
  const slack = tableDropSlackPx();
  const nodes = document.querySelectorAll("#quizOverlay [data-table-slot]");
  let best = null;
  let bestDist = slack;
  nodes.forEach(function (node) {
    const key = node.dataset.tableSlot;
    if (key == null || key === "") return;
    const r = node.getBoundingClientRect();
    const inflated = {
      left: r.left - slack * 0.35,
      top: r.top - slack * 0.55,
      right: r.right + slack * 0.35,
      bottom: r.bottom + slack * 0.55
    };
    const d = distToRect(x, y, inflated);
    if (d <= bestDist) {
      bestDist = d;
      best = key;
    }
  });
  return best;
}
function detachTableDragListeners() {
  if (!tableDrag) return;
  if (tableDrag.onMove) {
    window.removeEventListener("pointermove", tableDrag.onMove);
    window.removeEventListener("mousemove", tableDrag.onMove);
    window.removeEventListener("pointerup", tableDrag.onUp);
    window.removeEventListener("mouseup", tableDrag.onUp);
    window.removeEventListener("pointercancel", tableDrag.onCancel);
  }
}
function clearTableDrag() {
  detachTableDragListeners();
  if (tableDrag && tableDrag.ghost) tableDrag.ghost.remove();
  document.querySelectorAll("#quizOverlay ~ .bank-chip-ghost, .bank-chip-ghost").forEach(function (el) { el.remove(); });
  tableDrag = null;
  document.querySelectorAll("#quizOverlay .quiz-slot.is-hover, #quizOverlay .order-box.is-hover").forEach(function (el) {
    el.classList.remove("is-hover");
  });
}
function highlightTableHover(slot) {
  const key = slot == null ? null : String(slot);
  document.querySelectorAll("#quizOverlay [data-table-slot]").forEach(function (el) {
    const locked = el.classList.contains("is-right");
    el.classList.toggle("is-hover", key != null && String(el.dataset.tableSlot) === key && !locked);
  });
}
function placeTableWord(st, rows, slot, word) {
  const p = tableSlotParts(slot);
  if (!p || !rows[p.r]) return;
  const key = tableFillKey(rows[p.r], p.r, p.c);
  const expected = tableExpected(rows, key);
  if (st.fill[key] === expected) return;
  st.fill[key] = word;
  st.held = null;
  noteAttempt(word === expected);
  if (word !== expected) {
    const badAt = key;
    setTimeout(function () {
      if (quizPicked[quizKeyAt(quizIndex)] === st && st.fill[badAt] !== expected) {
        delete st.fill[badAt];
        renderPlay();
      }
    }, 500);
  }
  renderPlay();
}
function renderTableQuiz(item, opts, note) {
  const rows = item.rows || [];
  const headers = item.headers || ["", ""];
  const wide = headers.length > 2;
  const colCount = Math.max(1, headers.length - 1);
  let st = quizPicked[quizKeyAt(quizIndex)];
  if (!st || st.kind !== "table") {
    st = { kind: "table", fill: {}, held: null };
    quizPicked[quizKeyAt(quizIndex)] = st;
  }
  clearTableDrag();
  const hint = document.createElement("p");
  hint.className = "quiz-hint";
  hint.textContent = "גררו פתק אל המשבצת — או לחצו על פתק ואז על המשבצת. יש במאגר גם מילה שלא שייכת.";
  opts.appendChild(hint);
  const wrap = document.createElement("div");
  wrap.className = "quiz-table-wrap";
  const table = document.createElement("table");
  table.className = "quiz-table" + (wide ? " is-wide" : "");
  let cols = '<col class="quiz-col-label">';
  for (let c = 0; c < colCount; c++) cols += '<col class="quiz-col-slot">';
  table.innerHTML = "<colgroup>" + cols + "</colgroup>";
  const thead = document.createElement("thead");
  const head = document.createElement("tr");
  headers.forEach(function (h) {
    const th = document.createElement("th");
    th.textContent = h;
    head.appendChild(th);
  });
  thead.appendChild(head);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  const allRight = tableAllRight(st, rows);
  rows.forEach(function (row, r) {
    const tr = document.createElement("tr");
    const tdL = document.createElement("td");
    tdL.textContent = row.label;
    tr.appendChild(tdL);
    for (let c = 0; c < colCount; c++) {
      const key = tableFillKey(row, r, c);
      const expected = tableRowAnswers(row)[c];
      const td = document.createElement("td");
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "quiz-slot";
      slot.dataset.tableSlot = key;
      const filled = st.fill[key];
      if (filled) {
        slot.textContent = filled;
        if (filled === expected) slot.classList.add("is-right");
        else slot.classList.add("is-wrong");
      } else if (st.held != null) {
        slot.textContent = "הניחו כאן";
        slot.classList.add("is-on");
      } else {
        slot.textContent = "גררו לכאן";
        slot.classList.add("is-empty");
      }
      slot.disabled = filled === expected;
      slot.addEventListener("click", function () {
        if (filled === expected) return;
        if (filled && filled !== expected) {
          delete st.fill[key];
          renderPlay();
          return;
        }
        if (st.held == null) return;
        placeTableWord(st, rows, key, (item.bank || [])[st.held]);
      });
      td.appendChild(slot);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  opts.appendChild(wrap);
  appendWordBank(item, st, rows, opts);
  if (allRight && rows.length > 0) playWinOnce();
  showQuizNote(item, note, allRight && rows.length > 0);
}

// מאגר הפתקים הנגררים — משותף לטבלה ולתרשים הזרימה.
function appendWordBank(item, st, rows, opts) {
  const rightLeft = {};
  Object.keys(st.fill || {}).forEach(function (k) {
    const word = st.fill[k];
    if (word && tableSlotLocked(st, rows, k)) rightLeft[word] = (rightLeft[word] || 0) + 1;
  });
  const cap = document.createElement("p");
  cap.className = "bank-caption";
  cap.textContent = "מאגר הפתקים";
  opts.appendChild(cap);
  const bank = document.createElement("div");
  bank.className = "bank-row";
  const words = item.bank || [];
  ensureBankOrder(st, words.length).forEach(function (i) {
    const word = words[i];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "bank-chip";
    chip.draggable = false;
    chip.textContent = word;
    const taken = (rightLeft[word] || 0) > 0;
    if (taken) rightLeft[word] -= 1;
    const sittingWrong = Object.keys(st.fill || {}).some(function (k) {
      return st.fill[k] === word && !tableSlotLocked(st, rows, k);
    });
    if (taken && !sittingWrong) chip.classList.add("is-used");
    if (st.held === i) chip.classList.add("is-on");
    chip.disabled = taken && !sittingWrong;
    function moveTableChip(e) {
      if (!tableDrag || tableDrag.i !== i) return;
      const dx = e.clientX - tableDrag.startX;
      const dy = e.clientY - tableDrag.startY;
      if (!tableDrag.moved && Math.hypot(dx, dy) < 8) return;
      tableDrag.moved = true;
      chip.classList.add("is-dragging");
      if (!tableDrag.ghost) {
        const ghost = document.createElement("div");
        ghost.className = "bank-chip-ghost";
        ghost.textContent = word;
        ghost.setAttribute("aria-hidden", "true");
        document.body.appendChild(ghost);
        tableDrag.ghost = ghost;
      }
      tableDrag.ghost.style.left = (e.clientX - tableDrag.offsetX) + "px";
      tableDrag.ghost.style.top = (e.clientY - tableDrag.offsetY) + "px";
      const hover = tableSlotFromPoint(e.clientX, e.clientY);
      highlightTableHover(hover != null && !tableSlotLocked(st, rows, hover) ? hover : null);
    }
    function finishChipPointer(e) {
      if (!tableDrag || tableDrag.i !== i) return;
      const moved = tableDrag.moved;
      const dropX = e.clientX;
      const dropY = e.clientY;
      clearTableDrag();
      chip.classList.remove("is-dragging");
      if (moved) {
        const slot = tableSlotFromPoint(dropX, dropY);
        if (slot != null) placeTableWord(st, rows, slot, word);
        return;
      }
      st.held = st.held === i ? null : i;
      renderPlay();
    }
    function cancelChipPointer() {
      if (!tableDrag || tableDrag.i !== i) return;
      clearTableDrag();
      chip.classList.remove("is-dragging");
    }
    chip.addEventListener("pointerdown", function (e) {
      if (chip.disabled) return;
      e.preventDefault();
      const rect = chip.getBoundingClientRect();
      tableDrag = {
        i: i,
        word: word,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        moved: false,
        ghost: null,
        onMove: moveTableChip,
        onUp: finishChipPointer,
        onCancel: cancelChipPointer
      };
      try { chip.setPointerCapture(e.pointerId); } catch (err) {}
      window.addEventListener("pointermove", moveTableChip);
      window.addEventListener("mousemove", moveTableChip);
      window.addEventListener("pointerup", finishChipPointer);
      window.addEventListener("mouseup", finishChipPointer);
      window.addEventListener("pointercancel", cancelChipPointer);
    });
    bank.appendChild(chip);
  });
  opts.appendChild(bank);
}

// מהלך הסוגיא: תווית קטנה מעל ריבוע הגרירה — בלי קופסה כפולה.
function renderFlowQuiz(item, opts, note) {
  const rows = item.rows || [];
  let st = quizPicked[quizKeyAt(quizIndex)];
  if (!st || st.kind !== "flow") {
    st = { kind: "flow", fill: {}, held: null };
    quizPicked[quizKeyAt(quizIndex)] = st;
  }
  clearTableDrag();
  const board = document.createElement("div");
  board.className = "flow-board";
  const hint = document.createElement("p");
  hint.className = "quiz-hint";
  hint.textContent = item.hint || "גררו כל משפט לשלב שמתאים לו, מלמעלה למטה.";
  board.appendChild(hint);
  const flow = document.createElement("div");
  flow.className = "flow";
  const allRight = tableAllRight(st, rows);
  rows.forEach(function (row, r) {
    const card = document.createElement("div");
    card.className = "flow-card";
    const lab = document.createElement("p");
    lab.className = "flow-label";
    lab.textContent = row.label || ("שלב " + (r + 1));
    card.appendChild(lab);
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "quiz-slot";
    slot.dataset.tableSlot = String(r);
    const filled = st.fill[r];
    if (filled) {
      slot.textContent = filled;
      slot.classList.add(filled === row.answer ? "is-right" : "is-wrong");
    } else if (st.held != null) {
      slot.textContent = "הניחו כאן";
      slot.classList.add("is-on");
    } else {
      slot.textContent = "גררו לכאן";
      slot.classList.add("is-empty");
    }
    slot.disabled = filled === row.answer;
    slot.addEventListener("click", function () {
      if (filled === row.answer) return;
      if (filled) { delete st.fill[r]; renderPlay(); return; }
      if (st.held == null) return;
      placeTableWord(st, rows, r, (item.bank || [])[st.held]);
    });
    card.appendChild(slot);
    flow.appendChild(card);
  });
  board.appendChild(flow);
  opts.appendChild(board);
  appendWordBank(item, st, rows, board);
  if (allRight && rows.length > 0) playWinOnce();
  showQuizNote(item, note, allRight && rows.length > 0);
}

// סידור: גוררים פתקים לריבועים ממוספרים בשורה.
function orderAllRight(st, items) {
  const n = (items || []).length;
  return !!(st && Array.isArray(st.slots) && st.slots.length === n
    && n > 0 && st.slots.every(function (idx, i) { return idx === i; }));
}
function orderSlotFromPoint(x, y) {
  const hit = document.elementFromPoint(x, y);
  const slotEl = hit && hit.closest ? hit.closest("[data-order-slot]") : null;
  if (slotEl && slotEl.dataset.orderSlot != null && slotEl.dataset.orderSlot !== "") {
    return parseInt(slotEl.dataset.orderSlot, 10);
  }
  const slack = typeof tableDropSlackPx === "function" ? tableDropSlackPx() : 28;
  const nodes = document.querySelectorAll("#quizOverlay [data-order-slot]");
  let best = null;
  let bestDist = slack;
  nodes.forEach(function (node) {
    const key = node.dataset.orderSlot;
    if (key == null || key === "") return;
    const r = node.getBoundingClientRect();
    const inflated = {
      left: r.left - slack * 0.35,
      top: r.top - slack * 0.55,
      right: r.right + slack * 0.35,
      bottom: r.bottom + slack * 0.55
    };
    const d = distToRect(x, y, inflated);
    if (d <= bestDist) {
      bestDist = d;
      best = parseInt(key, 10);
    }
  });
  return best;
}
function highlightOrderHover(slot) {
  document.querySelectorAll("#quizOverlay [data-order-slot]").forEach(function (el) {
    const locked = el.classList.contains("is-right");
    const i = parseInt(el.dataset.orderSlot, 10);
    el.classList.toggle("is-hover", slot != null && i === slot && !locked);
  });
}
function placeOrderItem(st, items, slot, idx) {
  if (slot == null || slot < 0 || slot >= items.length) return;
  if (st.slots[slot] === slot) return;
  st.slots = st.slots.map(function (v) { return v === idx ? null : v; });
  st.held = null;
  if (idx === slot) {
    st.slots[slot] = idx;
    st.bad = null;
    noteAttempt(true);
  } else {
    st.slots[slot] = idx;
    st.bad = slot;
    noteAttempt(false);
    setTimeout(function () {
      if (quizPicked[quizKeyAt(quizIndex)] === st && st.slots[slot] === idx && idx !== slot) {
        st.slots[slot] = null;
        st.bad = null;
        renderPlay();
      }
    }, 520);
  }
  renderPlay();
}
function renderOrderQuiz(item, opts, note) {
  const items = item.items || [];
  let st = quizPicked[quizKeyAt(quizIndex)];
  if (!st || st.kind !== "order" || !Array.isArray(st.slots) || st.slots.length !== items.length
      || !st.pool || st.pool.length !== items.length) {
    st = { kind: "order", slots: items.map(function () { return null; }), pool: shuffleIdx(items.length), held: null, bad: null };
    quizPicked[quizKeyAt(quizIndex)] = st;
  }
  clearTableDrag();
  const hint = document.createElement("p");
  hint.className = "quiz-hint";
  hint.textContent = item.hint || "גררו כל פתק אל הריבוע הממוספר. 1 הוא הצעד הראשון.";
  opts.appendChild(hint);
  if (item.goal) {
    const goal = document.createElement("p");
    goal.className = "order-goal";
    goal.textContent = item.goal;
    opts.appendChild(goal);
  }
  const track = document.createElement("div");
  track.className = "order-track";
  const allRight = orderAllRight(st, items);
  items.forEach(function (_, slot) {
    const box = document.createElement("div");
    box.className = "order-box";
    box.dataset.orderSlot = String(slot);
    const num = document.createElement("b");
    num.textContent = String(slot + 1);
    box.appendChild(num);
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "order-drop";
    const filled = st.slots[slot];
    if (filled != null) {
      drop.textContent = items[filled];
      if (filled === slot) {
        box.classList.add("is-right");
        drop.classList.add("is-right");
      } else {
        box.classList.add("is-wrong");
        drop.classList.add("is-wrong");
      }
    } else if (st.held != null) {
      drop.textContent = "הניחו כאן";
      drop.classList.add("is-empty");
      box.classList.add("is-hover");
    } else {
      drop.textContent = "גררו לכאן";
      drop.classList.add("is-empty");
    }
    drop.disabled = filled === slot;
    drop.addEventListener("click", function () {
      if (filled === slot) return;
      if (filled != null && filled !== slot) {
        st.slots[slot] = null;
        st.bad = null;
        renderPlay();
        return;
      }
      if (st.held == null) return;
      placeOrderItem(st, items, slot, st.held);
    });
    box.appendChild(drop);
    track.appendChild(box);
  });
  opts.appendChild(track);
  const cap = document.createElement("p");
  cap.className = "bank-caption";
  cap.textContent = "מאגר הפתקים";
  opts.appendChild(cap);
  const pool = document.createElement("div");
  pool.className = "order-pool";
  const sitting = {};
  st.slots.forEach(function (idx) {
    if (idx != null) sitting[idx] = true;
  });
  st.pool.forEach(function (idx) {
    if (sitting[idx]) return;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "bank-chip";
    chip.textContent = items[idx];
    if (st.held === idx) chip.classList.add("is-on");
    function moveOrderChip(e) {
      if (!tableDrag || tableDrag.i !== idx) return;
      const dx = e.clientX - tableDrag.startX;
      const dy = e.clientY - tableDrag.startY;
      if (!tableDrag.moved && Math.hypot(dx, dy) < 8) return;
      tableDrag.moved = true;
      chip.classList.add("is-dragging");
      if (!tableDrag.ghost) {
        const ghost = document.createElement("div");
        ghost.className = "bank-chip-ghost";
        ghost.textContent = items[idx];
        ghost.setAttribute("aria-hidden", "true");
        document.body.appendChild(ghost);
        tableDrag.ghost = ghost;
      }
      tableDrag.ghost.style.left = (e.clientX - tableDrag.offsetX) + "px";
      tableDrag.ghost.style.top = (e.clientY - tableDrag.offsetY) + "px";
      const hover = orderSlotFromPoint(e.clientX, e.clientY);
      highlightOrderHover(hover != null && st.slots[hover] !== hover ? hover : null);
    }
    function finishOrderChip(e) {
      if (!tableDrag || tableDrag.i !== idx) return;
      const moved = tableDrag.moved;
      const dropX = e.clientX;
      const dropY = e.clientY;
      clearTableDrag();
      chip.classList.remove("is-dragging");
      if (moved) {
        const slot = orderSlotFromPoint(dropX, dropY);
        if (slot != null) placeOrderItem(st, items, slot, idx);
        return;
      }
      st.held = st.held === idx ? null : idx;
      renderPlay();
    }
    function cancelOrderChip() {
      if (!tableDrag || tableDrag.i !== idx) return;
      clearTableDrag();
      chip.classList.remove("is-dragging");
    }
    chip.addEventListener("pointerdown", function (e) {
      if (chip.disabled) return;
      e.preventDefault();
      const rect = chip.getBoundingClientRect();
      tableDrag = {
        i: idx,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        moved: false,
        ghost: null,
        onMove: moveOrderChip,
        onUp: finishOrderChip,
        onCancel: cancelOrderChip
      };
      try { chip.setPointerCapture(e.pointerId); } catch (err) {}
      window.addEventListener("pointermove", moveOrderChip);
      window.addEventListener("mousemove", moveOrderChip);
      window.addEventListener("pointerup", finishOrderChip);
      window.addEventListener("mouseup", finishOrderChip);
      window.addEventListener("pointercancel", cancelOrderChip);
    });
    pool.appendChild(chip);
  });
  opts.appendChild(pool);
  if (allRight) playWinOnce();
  showQuizNote(item, note, allRight);
}

// בחירה בתוך המשפט: כמו ״הקף״ בחוברת — שתי אפשרויות בתוך שורה.
function renderPickQuiz(item, opts, note) {
  const lines = item.lines || [];
  let st = quizPicked[quizKeyAt(quizIndex)];
  if (!st || st.kind !== "pick") {
    st = { kind: "pick", pick: {} };
    quizPicked[quizKeyAt(quizIndex)] = st;
  }
  const hint = document.createElement("p");
  hint.className = "quiz-hint";
  hint.textContent = item.hint || "בכל שורה — לחצו על האפשרות הנכונה.";
  opts.appendChild(hint);
  const list = document.createElement("div");
  list.className = "pick-list";
  lines.forEach(function (line, li) {
    const row = document.createElement("p");
    row.className = "pick-line";
    row.appendChild(document.createTextNode(line.before || ""));
    if (!st.lineOrd) st.lineOrd = {};
    const lineChoices = line.choices || [];
    if (!Array.isArray(st.lineOrd[li]) || st.lineOrd[li].length !== lineChoices.length) {
      st.lineOrd[li] = shuffleIdx(lineChoices.length);
    }
    st.lineOrd[li].forEach(function (orig, di) {
      if (di > 0) {
        const sep = document.createElement("span");
        sep.className = "pick-sep";
        sep.textContent = "/";
        row.appendChild(sep);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pick-opt";
      btn.textContent = lineChoices[orig];
      const chosen = st.pick[li];
      if (chosen !== undefined) {
        btn.disabled = true;
        if (orig === line.answer) btn.classList.add("is-right");
        else if (orig === chosen) btn.classList.add("is-wrong");
      }
      btn.addEventListener("click", function () {
        st.pick[li] = orig;
        noteAttempt(orig === line.answer);
        renderPlay();
      });
      row.appendChild(btn);
    });
    row.appendChild(document.createTextNode(line.after || ""));
    list.appendChild(row);
  });
  opts.appendChild(list);
  const done = lines.length > 0 && lines.every(function (_, i) { return st.pick[i] !== undefined; });
  if (done && lines.every(function (l, i) { return st.pick[i] === l.answer; })) playWinOnce();
  showQuizNote(item, note, done);
}

// סימון כל הנכונות: מסמנים ובודקים בלחיצה אחת.
function renderMultiQuiz(item, opts, note) {
  const rows = item.rows || [];
  let st = quizPicked[quizKeyAt(quizIndex)];
  if (!st || st.kind !== "multi") {
    st = { kind: "multi", on: {}, checked: false, wasRight: false };
    quizPicked[quizKeyAt(quizIndex)] = st;
  }
  const hint = document.createElement("p");
  hint.className = "quiz-hint";
  hint.textContent = item.hint || "סמנו את כל המשפטים הנכונים, ואז לחצו ״בדקו אותי״.";
  opts.appendChild(hint);
  const list = document.createElement("div");
  list.className = "multi-list";
  if (!Array.isArray(st.rowOrd) || st.rowOrd.length !== rows.length) st.rowOrd = shuffleIdx(rows.length);
  st.rowOrd.forEach(function (i) {
    const row = rows[i];
    const btn = document.createElement("button");
    btn.type = "button";
    let cls = "multi-row" + (st.on[i] ? " is-on" : "");
    if (st.checked) {
      if (st.on[i] && row.ok) cls += " is-right";
      else if (st.on[i] && !row.ok) cls += " is-wrong";
      else if (!st.on[i] && row.ok) cls += " is-miss";
    }
    btn.className = cls;
    const box = document.createElement("span");
    box.className = "box";
    box.textContent = st.checked && !st.on[i] && row.ok ? "✓" : "✓";
    btn.appendChild(box);
    btn.appendChild(document.createTextNode(row.text));
    btn.disabled = st.checked;
    btn.addEventListener("click", function () {
      st.on[i] = !st.on[i];
      playTap();
      renderPlay();
    });
    list.appendChild(btn);
  });
  opts.appendChild(list);
  if (!st.checked) {
    const check = document.createElement("button");
    check.type = "button";
    check.className = "quiz-check";
    check.textContent = "בדקו אותי";
    check.addEventListener("click", function () {
      st.checked = true;
      st.wasRight = rows.every(function (r, i) { return !!st.on[i] === !!r.ok; });
      noteAttempt(st.wasRight);
      if (st.wasRight) playWinOnce();
      renderPlay();
    });
    opts.appendChild(check);
  }
  showQuizNote(item, note, st.checked);
}

function normalizeAnswer(s) {
  return String(s || "")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[״"׳'.,!?()\[\]־–—]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
// כתיבת התשובה: השוואה מקילה — בלי ניקוד, פיסוק או רווחים כפולים.
function renderTypeinQuiz(item, opts, note) {
  let st = quizPicked[quizKeyAt(quizIndex)];
  if (!st || st.kind !== "typein") {
    st = { kind: "typein", value: "", checked: false, wasRight: false };
    quizPicked[quizKeyAt(quizIndex)] = st;
  }
  if (item.sentence) {
    const s = document.createElement("p");
    s.className = "quiz-sentence";
    const nWords = answerWordCount(item.answer);
    const filled = st.checked ? (st.wasRight ? st.value : item.answer) : "";
    const state = st.checked ? (st.wasRight ? "right" : "wrong") : "";
    fillSentenceBlanks(s, item.sentence, filled, state, nWords);
    opts.appendChild(s);
  }
  const hint = document.createElement("p");
  hint.className = "quiz-hint";
  const nHint = answerWordCount(item.answer);
  hint.textContent = item.hint || (nHint > 1
    ? "כתבו את התשובה ולחצו Enter. " + nHint + " קווים — כמספר המילים. אין צורך בניקוד."
    : "כתבו את התשובה ולחצו Enter. אין צורך בניקוד.");
  opts.appendChild(hint);
  const wrap = document.createElement("div");
  wrap.className = "type-wrap";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "type-in";
  input.value = st.value;
  input.placeholder = item.placeholder || "התשובה כאן";
  input.disabled = st.checked && st.wasRight;
  if (st.checked) input.classList.add(st.wasRight ? "is-right" : "is-wrong");
  const accepts = [item.answer].concat(item.accept || []).map(normalizeAnswer);
  function check() {
    st.value = input.value;
    st.checked = true;
    st.wasRight = accepts.indexOf(normalizeAnswer(input.value)) >= 0;
    noteAttempt(st.wasRight);
    if (st.wasRight) playWinOnce();
    renderPlay();
    if (!st.wasRight) {
      const again = document.querySelector("#quizOverlay .type-in");
      if (again) again.focus();
    }
  }
  input.addEventListener("input", function () { st.value = input.value; st.checked = false; });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); check(); }
  });
  wrap.appendChild(input);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "quiz-check";
  btn.textContent = "בדקו אותי";
  btn.disabled = st.checked && st.wasRight;
  btn.addEventListener("click", check);
  wrap.appendChild(btn);
  opts.appendChild(wrap);
  if (st.checked && !st.wasRight) {
    const ans = document.createElement("p");
    ans.className = "type-answer float-up";
    ans.textContent = "התשובה: " + item.answer;
    opts.appendChild(ans);
  }
  showQuizNote(item, note, st.checked);
}

function simpleField(label, value, onInput) {
  const wrap = document.createElement("label");
  wrap.className = "editor-field";
  const cap = document.createElement("span");
  cap.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.addEventListener("input", function () { onInput(input.value); persistCurrent(); });
  wrap.appendChild(cap);
  wrap.appendChild(input);
  return wrap;
}
function makeWordGrid(headers, rows, onSync, placeholders, headerEdit) {
  const table = document.createElement("table");
  table.className = "word-grid";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  headers.forEach(function (h, i) {
    const th = document.createElement("th");
    if (headerEdit !== false) {
      th.contentEditable = "true";
      th.addEventListener("input", function () { onSync(table); });
    }
    th.textContent = h || "";
    th.setAttribute("data-placeholder", "עמודה");
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  function addDataRow(vals, focus) {
    const tr = document.createElement("tr");
    (vals || headers.map(function () { return ""; })).forEach(function (val, i) {
      const td = document.createElement("td");
      td.contentEditable = "true";
      td.textContent = val || "";
      td.setAttribute("data-placeholder", (placeholders && placeholders[i]) || "");
      td.addEventListener("input", function () { onSync(table); });
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
    if (focus) {
      const cell = tr.querySelector("td");
      if (cell) cell.focus();
    }
  }
  (rows.length ? rows : [headers.map(function () { return ""; })]).forEach(function (r) { addDataRow(r, false); });
  table.addEventListener("keydown", function (event) {
    if (event.key !== "Tab" || event.shiftKey) return;
    const trs = tbody.querySelectorAll("tr");
    const last = trs[trs.length - 1];
    const cells = last ? last.querySelectorAll("td") : [];
    if (document.activeElement !== cells[cells.length - 1]) return;
    event.preventDefault();
    addDataRow(headers.map(function () { return ""; }), true);
    onSync(table);
  });
  table.appendChild(tbody);
  table._read = function () {
    const hs = Array.from(thead.querySelectorAll("th")).map(function (th) { return (th.textContent || "").trim(); });
    const rs = Array.from(tbody.querySelectorAll("tr")).map(function (tr) {
      return Array.from(tr.querySelectorAll("td")).map(function (td) { return (td.textContent || "").trim(); });
    }).filter(function (r) { return r.some(Boolean); });
    return { headers: hs, rows: rs };
  };
  return table;
}
function makeCheckList(rows, onSync) {
  const table = document.createElement("table");
  table.className = "word-grid";
  table.innerHTML = "<thead><tr><th class=\"ok-cell\">נכון</th><th>משפט</th></tr></thead>";
  const tbody = document.createElement("tbody");
  function addRow(text, ok, focus) {
    const tr = document.createElement("tr");
    const tdOk = document.createElement("td");
    tdOk.className = "ok-cell";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !!ok;
    box.addEventListener("change", function () { onSync(table); });
    tdOk.appendChild(box);
    const tdText = document.createElement("td");
    tdText.contentEditable = "true";
    tdText.textContent = text || "";
    tdText.setAttribute("data-placeholder", "לשון המשפט");
    tdText.addEventListener("input", function () { onSync(table); });
    tr.appendChild(tdOk);
    tr.appendChild(tdText);
    tbody.appendChild(tr);
    if (focus) tdText.focus();
  }
  (rows.length ? rows : [{ text: "", ok: false }]).forEach(function (r) { addRow(r.text, r.ok, false); });
  table.addEventListener("keydown", function (event) {
    if (event.key !== "Tab" || event.shiftKey) return;
    const trs = tbody.querySelectorAll("tr");
    const last = trs[trs.length - 1];
    const cell = last && last.querySelector("td[contenteditable]");
    if (document.activeElement !== cell) return;
    event.preventDefault();
    addRow("", false, true);
    onSync(table);
  });
  table.appendChild(tbody);
  table._read = function () {
    return Array.from(tbody.querySelectorAll("tr")).map(function (tr) {
      const box = tr.querySelector("input[type=checkbox]");
      const td = tr.querySelector("td[contenteditable]");
      return { text: ((td && td.textContent) || "").trim(), ok: !!(box && box.checked) };
    }).filter(function (r) { return r.text; });
  };
  return table;
}

var QUIZ_TYPE_DEFS = [
  { type: "mc", label: "רב־ברירה", make: function () { return { type: "mc", q: "", choices: ["", "", "", ""], answer: 0, note: "" }; } },
  { type: "tf", label: "נכון / לא נכון", make: function () { return { type: "tf", q: "", answer: true, note: "" }; } },
  { type: "match", label: "התאמת מושגים", make: function () { return { type: "match", kind: "concepts", q: "התאימו מושגים מהסוגיא", leftLabel: "מושג", rightLabel: "משמעות", arFont: false, pairs: [{ ar: "", he: "" }, { ar: "", he: "" }], note: "" }; } },
  { type: "cloze", label: "השלמת משפט", make: function () { return { type: "cloze", q: "השלימו את המשפט", sentence: "___", choices: ["", "", "", ""], answer: 0, note: "" }; } },
  { type: "table", label: "טבלה", make: function () { return { type: "table", q: "מלאו את הטבלה", headers: ["נתון", "מה למלא"], rows: [{ label: "", answer: "" }, { label: "", answer: "" }], bank: [""], note: "" }; } },
  { type: "flow", label: "מהלך הסוגיא", make: function () { return { type: "flow", q: "בנו את מהלך הסוגיא", rows: [{ label: "דין", answer: "" }, { label: "קושיה", answer: "" }, { label: "תירוץ", answer: "" }], bank: [""], note: "" }; } },
  { type: "order", label: "גרירת פתקים לסדר", make: function () { return { type: "order", q: "סדרו לפי הסדר", goal: "", items: ["", "", ""], note: "" }; } },
  { type: "pick", label: "בחירה בתוך המשפט", make: function () { return { type: "pick", q: "בחרו את המילה הנכונה", lines: [{ before: "", choices: ["", ""], answer: 0, after: "" }], note: "" }; } },
  { type: "multi", label: "סימון כל הנכונות", make: function () { return { type: "multi", q: "סמנו את כל הנכונים", rows: [{ text: "", ok: true }, { text: "", ok: false }], note: "" }; } },
  { type: "stage", label: "זיהוי שלב", make: function () { return { type: "stage", q: "זהו את שלב הסוגיא", phrase: "", choices: ["דין", "קושיה", "תירוץ"], answer: 1, note: "" }; } },
  { type: "typein", label: "כתיבת תשובה", make: function () { return { type: "typein", q: "כתבו את התשובה", sentence: "", answer: "", accept: [], note: "" }; } }
];


  function renderPlayDots(list) {
    var host = document.getElementById("quizDots");
    if (!host) return;
    host.innerHTML = "";
    list.forEach(function (item, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", "שאלה " + (i + 1));
      var out = quizOutcome(item, quizPicked[quizKeyAt(i)]);
      if (out) b.classList.add(out === "right" ? "is-right" : "is-wrong");
      if (i === quizIndex) b.classList.add("is-now");
      b.addEventListener("click", function () { quizIndex = i; renderPlay(); });
      host.appendChild(b);
    });
  }

  function renderPlay() {
    var list = ensureList();
    var progress = document.getElementById("quizProgress");
    var kind = document.getElementById("quizKind");
    var qEl = document.getElementById("quizQ");
    var optsEl = document.getElementById("quizOptions");
    var note = document.getElementById("quizNote");
    var prevBtn = document.getElementById("quizPrev");
    var nextBtn = document.getElementById("quizNext");
    if (!optsEl) return;
    if (!list.length) {
      if (progress) progress.textContent = "";
      if (kind) kind.textContent = "";
      if (qEl) qEl.textContent = "";
      optsEl.innerHTML = "";
      var empty = document.createElement("p");
      empty.className = "quiz-empty";
      empty.textContent = "אין עדיין שאלות למשנה זו. מורה מחובר יכול להוסיף בעריכה.";
      optsEl.appendChild(empty);
      if (note) { note.hidden = true; note.textContent = ""; }
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      renderPlayDots([]);
      return;
    }
    if (quizIndex >= list.length) quizIndex = list.length - 1;
    if (quizIndex < 0) quizIndex = 0;
    var item = list[quizIndex];
    if (progress) progress.textContent = "שאלה " + (quizIndex + 1) + " מתוך " + list.length;
    if (kind) kind.textContent = quizKindLabel(item);
    if (qEl) qEl.textContent = item.q || "";
    optsEl.innerHTML = "";
    if (note) { note.hidden = true; note.textContent = ""; }
    if (item.type === "match") renderMatchQuiz(item, optsEl, note);
    else if (item.type === "cloze") renderClozeQuiz(item, optsEl, note);
    else if (item.type === "table") renderTableQuiz(item, optsEl, note);
    else if (item.type === "flow") renderFlowQuiz(item, optsEl, note);
    else if (item.type === "order") renderOrderQuiz(item, optsEl, note);
    else if (item.type === "pick") renderPickQuiz(item, optsEl, note);
    else if (item.type === "multi") renderMultiQuiz(item, optsEl, note);
    else if (item.type === "typein") renderTypeinQuiz(item, optsEl, note);
    else if (item.type === "stage") renderStageQuiz(item, optsEl, note);
    else renderChoiceQuiz(item, optsEl, note);
    if (prevBtn) prevBtn.disabled = quizIndex <= 0;
    if (nextBtn) nextBtn.disabled = quizIndex >= list.length - 1;
    renderPlayDots(list);
  }

  function renderEditor() {
    var host = document.getElementById("quizEditor");
    if (!host) return;
    host.innerHTML = "";
    if (!username()) {
      var need = document.createElement("p");
      need.className = "quiz-empty";
      need.textContent = "צריך להתחבר כמורה כדי לערוך שאלות.";
      host.appendChild(need);
      return;
    }
    editList = ensureList();
    var all = editList;
    var intro = document.createElement("p");
    intro.className = "hint";
    intro.style.cssText = "margin:0 0 10px;color:#6b6460;font-weight:600";
    intro.textContent = "שאלות למשנה הנוכחית בלבד. טבלה נערכת כמו ב-Word: Tab בתא האחרון מוסיף שורה.";
    host.appendChild(intro);
    var addBar = document.createElement("div");
    addBar.className = "edit-add-row";
    var typeSel = document.createElement("select");
    QUIZ_TYPE_DEFS.forEach(function (def) {
      var opt = document.createElement("option");
      opt.value = def.type; opt.textContent = def.label; typeSel.appendChild(opt);
    });
    var addBtn = document.createElement("button");
    addBtn.type = "button"; addBtn.className = "edit-btn primary"; addBtn.textContent = "שאלה חדשה";
    addBtn.addEventListener("click", function () {
      var def = QUIZ_TYPE_DEFS.find(function (d) { return d.type === typeSel.value; }) || QUIZ_TYPE_DEFS[0];
      all.push(def.make());
      persistCurrent();
      renderEditor();
    });
    addBar.appendChild(typeSel); addBar.appendChild(addBtn); host.appendChild(addBar);
    if (!all.length) {
      var empty = document.createElement("p");
      empty.className = "editor-empty";
      empty.textContent = "אין עדיין שאלות. בחרו סוג למעלה ולחצו שאלה חדשה.";
      host.appendChild(empty);
      return;
    }
    all.forEach(function (item, index) {
      var card = document.createElement("div");
      card.className = "editor-card";
      var head = document.createElement("div");
      head.className = "editor-card-head";
      var title = document.createElement("strong");
      title.textContent = "שאלה " + (index + 1) + " · " + quizKindLabel(item);
      var actions = document.createElement("div");
      actions.className = "editor-actions";
      function move(dir) {
        var other = index + dir;
        if (other < 0 || other >= all.length) return;
        var tmp = all[index]; all[index] = all[other]; all[other] = tmp;
        persistCurrent(); renderEditor();
      }
      var up = document.createElement("button");
      up.type = "button"; up.className = "edit-btn"; up.textContent = "למעלה"; up.disabled = index === 0;
      up.addEventListener("click", function () { move(-1); });
      var down = document.createElement("button");
      down.type = "button"; down.className = "edit-btn"; down.textContent = "למטה"; down.disabled = index === all.length - 1;
      down.addEventListener("click", function () { move(1); });
      var del = document.createElement("button");
      del.type = "button"; del.className = "edit-btn danger"; del.textContent = "מחק";
      del.addEventListener("click", function () { all.splice(index, 1); persistCurrent(); renderEditor(); });
      actions.appendChild(up); actions.appendChild(down); actions.appendChild(del);
      head.appendChild(title); head.appendChild(actions); card.appendChild(head);

      var qField = document.createElement("label");
      qField.className = "editor-field";
      qField.innerHTML = "<span>לשון השאלה</span>";
      var qInput = document.createElement("textarea");
      qInput.value = item.q || "";
      qInput.addEventListener("input", function () { item.q = qInput.value; persistCurrent(); });
      qField.appendChild(qInput); card.appendChild(qField);

      if (item.type === "tf") {
        var tfField = document.createElement("div"); tfField.className = "editor-field";
        var cap = document.createElement("span"); cap.textContent = "התשובה הנכונה";
        var row = document.createElement("div"); row.className = "tf-row";
        [["true","נכון"],["false","לא נכון"]].forEach(function (pair) {
          var lab = document.createElement("label");
          var radio = document.createElement("input");
          radio.type = "radio"; radio.name = "tf-" + mishKey() + "-" + index;
          radio.checked = String(!!item.answer) === pair[0];
          radio.addEventListener("change", function () { item.answer = pair[0] === "true"; persistCurrent(); });
          lab.appendChild(radio); lab.appendChild(document.createTextNode(" " + pair[1])); row.appendChild(lab);
        });
        tfField.appendChild(cap); tfField.appendChild(row); card.appendChild(tfField);
      } else if (item.type === "match") {
        if (!Array.isArray(item.pairs) || !item.pairs.length) item.pairs = [{ ar: "", he: "" }, { ar: "", he: "" }];
        var mcap = document.createElement("span"); mcap.className = "edit-cap";
        mcap.textContent = "זוגות בטבלה — Tab בתא האחרון מוסיף שורה"; card.appendChild(mcap);
        card.appendChild(makeWordGrid(
          [item.leftLabel || "מושג", item.rightLabel || "משמעות"],
          item.pairs.map(function (p) { return [p.ar || "", p.he || ""]; }),
          function (table) {
            var data = table._read();
            item.leftLabel = data.headers[0] || "מושג";
            item.rightLabel = data.headers[1] || "משמעות";
            item.pairs = data.rows.map(function (r) { return { ar: r[0] || "", he: r[1] || "" }; });
            persistCurrent();
          }, ["מושג", "משמעות"]));
      } else if (item.type === "cloze") {
        var sField = document.createElement("label"); sField.className = "editor-field";
        sField.innerHTML = "<span>משפט בעברית — סמנו את החסר ב־___</span>";
        var sInput = document.createElement("textarea"); sInput.value = item.sentence || "";
        sInput.addEventListener("input", function () { item.sentence = sInput.value; persistCurrent(); });
        sField.appendChild(sInput); card.appendChild(sField);
        if (!Array.isArray(item.choices) || item.choices.length !== 4) {
          item.choices = (item.choices || []).slice(0, 4);
          while (item.choices.length < 4) item.choices.push("");
        }
        if (typeof item.answer !== "number" || item.answer < 0 || item.answer > 3) item.answer = 0;
        var ccap = document.createElement("span");
        ccap.textContent = "ארבע מילים במאגר — סמנו את הנכונה";
        ccap.style.cssText = "display:block;font-size:0.8rem;font-weight:800;color:#6b6460;margin-bottom:6px";
        card.appendChild(ccap);
        item.choices.forEach(function (choice, i) {
          var line = document.createElement("div"); line.className = "choice-row";
          var lab = document.createElement("label");
          var radio = document.createElement("input"); radio.type = "radio";
          radio.name = "cloze-" + mishKey() + "-" + index; radio.checked = item.answer === i;
          radio.addEventListener("change", function () { item.answer = i; persistCurrent(); });
          lab.appendChild(radio); lab.appendChild(document.createTextNode(" נכונה"));
          var inp = document.createElement("input"); inp.type = "text"; inp.value = choice || "";
          inp.addEventListener("input", function () { item.choices[i] = inp.value; persistCurrent(); });
          line.appendChild(lab); line.appendChild(inp); card.appendChild(line);
        });
      } else if (item.type === "table" || item.type === "flow") {
        if (!Array.isArray(item.rows) || !item.rows.length) item.rows = [{ label: "", answer: "" }];
        if (!Array.isArray(item.bank)) item.bank = [];
        if (item.type === "table" && (!Array.isArray(item.headers) || item.headers.length < 2)) item.headers = ["", ""];
        var tcap = document.createElement("span"); tcap.className = "edit-cap";
        tcap.textContent = item.type === "flow" ? "שלב (תווית קטנה) ומה למלא — Tab מוסיף שורה" : "הטבלה — ערכו תאים כמו ב-Word, Tab מוסיף שורה";
        card.appendChild(tcap);
        card.appendChild(makeWordGrid(
          item.type === "table" ? (item.headers || ["", ""]) : ["שלב", "מה למלא"],
          item.rows.map(function (r) {
            if (item.type !== "table") return [r.label || "", r.answer || ""];
            var hs = item.headers || ["", ""];
            var answers = tableRowAnswers(r);
            var cells = [r.label || ""];
            for (var i = 1; i < Math.max(2, hs.length); i++) cells.push(answers[i - 1] || "");
            return cells;
          }),
          function (table) {
            var data = table._read();
            if (item.type === "table") item.headers = data.headers;
            item.rows = data.rows.map(function (r) {
              if (item.type !== "table" || data.headers.length <= 2) return { label: r[0] || "", answer: r[1] || "" };
              return { label: r[0] || "", answers: r.slice(1), answer: r[1] || "" };
            });
            persistCurrent();
          }, ["נתון", "מה למלא מהמאגר"], item.type === "table"));
        var bField = document.createElement("label"); bField.className = "editor-field";
        bField.innerHTML = "<span>מאגר — שורה לכל מילה (אפשר מסיח)</span>";
        var bInput = document.createElement("textarea"); bInput.value = (item.bank || []).join("\n");
        bInput.addEventListener("input", function () {
          item.bank = bInput.value.split("\n").map(function (w) { return w.trim(); }).filter(Boolean);
          persistCurrent();
        });
        bField.appendChild(bInput); card.appendChild(bField);
      } else if (item.type === "order") {
        if (!Array.isArray(item.items)) item.items = ["", "", ""];
        var oField = document.createElement("label"); oField.className = "editor-field";
        oField.innerHTML = "<span>הפריטים — שורה לכל אחד, לפי הסדר הנכון</span>";
        var oInput = document.createElement("textarea"); oInput.value = item.items.join("\n");
        oInput.addEventListener("input", function () {
          item.items = oInput.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
          persistCurrent();
        });
        oField.appendChild(oInput); card.appendChild(oField);
        card.appendChild(simpleField("כותרת מטרה (רשות)", item.goal, function (v) { item.goal = v; }));
      } else if (item.type === "multi") {
        if (!Array.isArray(item.rows) || !item.rows.length) item.rows = [{ text: "", ok: true }, { text: "", ok: false }];
        var mucap = document.createElement("span"); mucap.className = "edit-cap";
        mucap.textContent = "סמנו ✓ ליד הנכונים. Tab בתא האחרון מוסיף שורה"; card.appendChild(mucap);
        card.appendChild(makeCheckList(item.rows, function (table) {
          var next = table._read(); if (next.length) item.rows = next; persistCurrent();
        }));
      } else if (item.type === "pick") {
        if (!Array.isArray(item.lines) || !item.lines.length) item.lines = [{ before: "", choices: ["", ""], answer: 0, after: "" }];
        var pcap = document.createElement("span"); pcap.className = "edit-cap";
        pcap.textContent = "כל שורה משפט: פתיחה, שתי אפשרויות, סיום. בעמודה האחרונה כתבו א או ב. Tab מוסיף שורה";
        card.appendChild(pcap);
        card.appendChild(makeWordGrid(
          ["פתיחה", "אפשרות א", "אפשרות ב", "סיום", "נכונה (א/ב)"],
          item.lines.map(function (line) {
            return [line.before || "", (line.choices && line.choices[0]) || "", (line.choices && line.choices[1]) || "", line.after || "", line.answer === 1 ? "ב" : "א"];
          }),
          function (table) {
            var data = table._read();
            item.lines = data.rows.map(function (r) {
              var mark = (r[4] || "א").replace(/\s+/g, "");
              return { before: r[0] || "", choices: [r[1] || "", r[2] || ""], answer: (mark === "ב" || mark === "2") ? 1 : 0, after: r[3] || "" };
            });
            persistCurrent();
          }, ["לפני הבחירה", "אפשרות א", "אפשרות ב", "אחרי הבחירה", "א"], false));
      } else if (item.type === "typein") {
        card.appendChild(simpleField("משפט מעל תיבת הכתיבה (רשות)", item.sentence, function (v) { item.sentence = v; }));
        card.appendChild(simpleField("התשובה הנכונה", item.answer, function (v) { item.answer = v; }));
        var aField = document.createElement("label"); aField.className = "editor-field";
        aField.innerHTML = "<span>ניסוחים נוספים שיתקבלו — שורה לכל אחד</span>";
        var aInput = document.createElement("textarea"); aInput.value = (item.accept || []).join("\n");
        aInput.addEventListener("input", function () {
          item.accept = aInput.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
          persistCurrent();
        });
        aField.appendChild(aInput); card.appendChild(aField);
      } else {
        if (item.type === "stage") {
          card.appendChild(simpleField("לשון שמציגים", item.phrase, function (v) { item.phrase = v; }));
        }
        var want = item.type === "stage" ? Math.max(2, (item.choices || []).length || 3) : 4;
        if (!Array.isArray(item.choices) || item.choices.length !== want) {
          item.choices = (item.choices || []).slice(0, want);
          while (item.choices.length < want) item.choices.push("");
        }
        if (typeof item.answer !== "number" || item.answer < 0 || item.answer >= want) item.answer = 0;
        var mccap = document.createElement("span");
        mccap.textContent = item.choices.length + " תשובות — סמנו את הנכונה";
        mccap.style.cssText = "display:block;font-size:0.8rem;font-weight:800;color:#6b6460;margin-bottom:6px";
        card.appendChild(mccap);
        item.choices.forEach(function (choice, i) {
          var line = document.createElement("div"); line.className = "choice-row";
          var lab = document.createElement("label");
          var radio = document.createElement("input"); radio.type = "radio";
          radio.name = "mc-" + mishKey() + "-" + index; radio.checked = item.answer === i;
          radio.addEventListener("change", function () { item.answer = i; persistCurrent(); });
          lab.appendChild(radio); lab.appendChild(document.createTextNode(" נכונה"));
          var inp = document.createElement("input"); inp.type = "text"; inp.value = choice || "";
          inp.placeholder = "תשובה " + (i + 1);
          inp.addEventListener("input", function () { item.choices[i] = inp.value; persistCurrent(); });
          line.appendChild(lab); line.appendChild(inp); card.appendChild(line);
        });
      }
      var noteField = document.createElement("label"); noteField.className = "editor-field";
      noteField.innerHTML = "<span>הסבר אחרי התשובה (רשות)</span>";
      var noteInput = document.createElement("textarea"); noteInput.value = item.note || "";
      noteInput.addEventListener("input", function () { item.note = noteInput.value; persistCurrent(); });
      noteField.appendChild(noteInput); card.appendChild(noteField);
      host.appendChild(card);
    });
  }

  function setMode(next) {
    mode = next === "edit" ? "edit" : "play";
    if (mode === "edit") {
      openEdit();
      renderEditor();
    } else {
      closeEdit();
      renderPlay();
    }
  }
  function updateTitle() {
    var title = document.getElementById("quizTitle");
    if (!title) return;
    var c = ctx();
    title.textContent = "שאלות · " + (c.label || ("פרק " + (c.perek || "") + " משנה " + (c.mish || "")));
  }
  function updateEditVisibility() {
    var fab = document.getElementById("quizEditFab");
    var logged = !!username();
    if (fab) fab.hidden = !logged || !quizOpen;
    if (!logged) closeEdit();
  }
  function updateBadge() {
    var badge = document.getElementById("quizBadge");
    if (!badge) return;
    var n = loadQuestions(username(), mishKey()).length;
    if (n > 0) { badge.hidden = false; badge.textContent = String(n); }
    else { badge.hidden = true; badge.textContent = ""; }
  }
  function openEdit() {
    if (!username()) {
      opts.toast("צריך להתחבר כמורה");
      return;
    }
    var editOv = document.getElementById("quizEditOverlay");
    if (editOv) editOv.classList.add("is-open");
    mode = "edit";
    editList = ensureList();
    renderEditor();
  }
  function closeEdit() {
    var editOv = document.getElementById("quizEditOverlay");
    if (editOv) editOv.classList.remove("is-open");
    if (mode === "edit") mode = "play";
    persistCurrent();
    editList = null;
    updateBadge();
    if (quizOpen) renderPlay();
  }
  function open() {
    if (!username()) {
      opts.toast("צריך להתחבר כמורה");
      return;
    }
    updateTitle();
    quizIndex = 0;
    quizPicked = {};
    winPlayed = {};
    var aids = document.getElementById("aidsOverlay");
    if (aids) aids.classList.remove("is-open");
    var aidShow = document.getElementById("aidShow");
    if (aidShow) aidShow.classList.remove("is-open");
    document.body.classList.remove("is-aid");
    document.body.classList.add("is-quiz");
    var show = document.getElementById("quizShow");
    if (show) {
      show.classList.add("is-open");
      show.setAttribute("aria-hidden", "false");
    }
    quizOpen = true;
    updateEditVisibility();
    updateBadge();
    setMode("play");
  }
  function close() {
    clearTableDrag();
    closeEdit();
    quizOpen = false;
    document.body.classList.remove("is-quiz");
    var show = document.getElementById("quizShow");
    if (show) {
      show.classList.remove("is-open");
      show.setAttribute("aria-hidden", "true");
    }
    updateEditVisibility();
  }
  function isOpen() {
    return quizOpen;
  }
  function bindUi() {
    var btn = document.getElementById("quizBtn");
    if (btn) btn.addEventListener("click", function () {
      if (isOpen()) close();
      else open();
    });
    var fab = document.getElementById("quizEditFab");
    if (fab) fab.addEventListener("click", openEdit);
    var editClose = document.getElementById("quizEditClose");
    if (editClose) editClose.addEventListener("click", closeEdit);
    var editOv = document.getElementById("quizEditOverlay");
    if (editOv) editOv.addEventListener("click", function (e) {
      if (e.target === editOv) closeEdit();
    });
    var prevBtn = document.getElementById("quizPrev");
    var nextBtn = document.getElementById("quizNext");
    if (prevBtn) prevBtn.addEventListener("click", function () { if (quizIndex > 0) { quizIndex--; renderPlay(); } });
    if (nextBtn) nextBtn.addEventListener("click", function () {
      var list = ensureList();
      if (quizIndex < list.length - 1) { quizIndex++; renderPlay(); }
    });
  }
  function init(config) {
    if (config) {
      if (typeof config.getContext === "function") opts.getContext = config.getContext;
      if (typeof config.toast === "function") opts.toast = config.toast;
    }
    bindUi(); updateBadge(); updateEditVisibility();
  }
  function onNavigate() {
    updateBadge();
    if (isOpen()) {
      updateTitle(); updateEditVisibility(); quizIndex = 0; quizPicked = {}; winPlayed = {};
      if (mode === "edit") { editList = ensureList(); renderEditor(); }
      renderPlay();
    }
  }
  function onAuthChange() {
    updateBadge(); updateEditVisibility();
    if (isOpen()) {
      if (mode === "edit" && username()) { editList = ensureList(); renderEditor(); }
      else closeEdit();
      renderPlay();
    }
  }
  global.BerakhotQuiz = {
    init: init, open: open, close: close,
    onNavigate: onNavigate, onAuthChange: onAuthChange, updateBadge: updateBadge,
    QUIZ_TYPE_DEFS: QUIZ_TYPE_DEFS
  };
})(typeof window !== "undefined" ? window : this);
