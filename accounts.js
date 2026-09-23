(function (global) {
  var DEFAULT_ADMIN_USER = "yosefyotam";
  var DEFAULT_ADMIN_PIN = "1029";
  var USERS_KEY = "berakhot-users";
  var ADMIN_AUTH_KEY = "berakhot-admin-auth";
  var REMEMBER_KEY = "berakhot-remember";
  var ADMIN_REMEMBER_KEY = "berakhot-admin-remember";
  var SESSION_KEY = "berakhot-session";
  var DB_NAME = "berakhot-teachers";
  var STORE = "files";
  var QUESTIONS = [
    "שם בית הספר שלי",
    "שם העיר שלי",
    "שם משפחת אמא",
    "צבע אהוב עליי"
  ];

  function readUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY) || "[]"); } catch (e) { return []; }
  }
  function writeUsers(list) {
    localStorage.setItem(USERS_KEY, JSON.stringify(list));
  }
  function adminAuth() {
    try {
      var saved = JSON.parse(localStorage.getItem(ADMIN_AUTH_KEY) || "null");
      if (saved && saved.username && saved.pin) return saved;
    } catch (e) {}
    return { username: DEFAULT_ADMIN_USER, pin: DEFAULT_ADMIN_PIN };
  }
  function setAdminAuth(username, pin) {
    username = String(username || "").trim();
    pin = String(pin || "").trim();
    if (!validUser(username)) throw new Error("user");
    if (!validPin(pin)) throw new Error("pin");
    localStorage.setItem(ADMIN_AUTH_KEY, JSON.stringify({ username: username, pin: pin }));
  }
  function adminUser() {
    return adminAuth().username;
  }
  function allUsers() {
    var auth = adminAuth();
    var list = readUsers().filter(function (u) { return u.username !== auth.username; });
    list.unshift({
      username: auth.username,
      pin: auth.pin,
      name: "מנהל",
      admin: true,
      question: "",
      answer: ""
    });
    return list;
  }
  function getUser(name) {
    name = String(name || "").trim();
    return allUsers().find(function (u) { return u.username === name; }) || null;
  }
  function validUser(name) { return /^[a-zA-Z][a-zA-Z0-9._-]{1,20}$/.test(name || ""); }
  function validPin(pin) { return /^\d{4}$/.test(pin || ""); }
  function validName(name) { return String(name || "").trim().length >= 2; }
  function normalizeAnswer(ans) {
    return String(ans || "").trim().toLowerCase().replace(/\s+/g, " ");
  }
  function findUser(name, pin) {
    name = String(name || "").trim();
    pin = String(pin || "").trim();
    return allUsers().find(function (u) { return u.username === name && u.pin === pin; }) || null;
  }
  function session() {
    try { return localStorage.getItem(SESSION_KEY) || ""; } catch (e) { return ""; }
  }
  function setSession(name) {
    if (name) localStorage.setItem(SESSION_KEY, name);
    else localStorage.removeItem(SESSION_KEY);
  }
  function remember() {
    try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || "null"); } catch (e) { return null; }
  }
  function setRemember(name, pin) {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ username: name, pin: pin }));
  }
  function adminRemember() {
    try { return JSON.parse(localStorage.getItem(ADMIN_REMEMBER_KEY) || "null"); } catch (e) { return null; }
  }
  function setAdminRemember(name, pin) {
    localStorage.setItem(ADMIN_REMEMBER_KEY, JSON.stringify({ username: name, pin: pin }));
  }
  function isAdmin(name) {
    return String(name || session()) === adminUser();
  }
  function registerUser(opts) {
    var username = String(opts.username || "").trim();
    var pin = String(opts.pin || "").trim();
    var name = String(opts.name || "").trim();
    var question = String(opts.question || "").trim();
    var answer = normalizeAnswer(opts.answer);
    if (!validName(name)) throw new Error("name");
    if (!validUser(username)) throw new Error("user");
    if (!validPin(pin)) throw new Error("pin");
    if (!question || !answer) throw new Error("recovery");
    if (username === adminUser()) throw new Error("admin");
    if (getUser(username) && !getUser(username).admin) throw new Error("taken");
    if (readUsers().some(function (u) { return u.username === username; })) throw new Error("taken");
    var list = readUsers().filter(function (u) { return u.username !== username; });
    list.push({ username: username, pin: pin, name: name, question: question, answer: answer });
    writeUsers(list);
    return getUser(username);
  }
  function addUser(name, pin, displayName) {
    return registerUser({
      username: name,
      pin: pin,
      name: displayName || name,
      question: "צבע אהוב עליי",
      answer: "gold"
    });
  }
  function removeUser(name) {
    if (name === adminUser()) return;
    writeUsers(readUsers().filter(function (u) { return u.username !== name; }));
  }
  function resetPin(username, newPin) {
    username = String(username || "").trim();
    newPin = String(newPin || "").trim();
    if (!validPin(newPin)) throw new Error("pin");
    if (username === adminUser()) {
      setAdminAuth(adminUser(), newPin);
      return;
    }
    var list = readUsers();
    var found = false;
    list = list.map(function (u) {
      if (u.username !== username) return u;
      found = true;
      return Object.assign({}, u, { pin: newPin });
    });
    if (!found) throw new Error("missing");
    writeUsers(list);
  }
  function recoverUsername(displayName, answer) {
    displayName = String(displayName || "").trim().toLowerCase();
    answer = normalizeAnswer(answer);
    var matches = readUsers().filter(function (u) {
      var nameOk = displayName && String(u.name || "").trim().toLowerCase() === displayName;
      var ansOk = answer && normalizeAnswer(u.answer) === answer;
      return nameOk || ansOk;
    });
    return matches.map(function (u) { return { username: u.username, name: u.name }; });
  }
  function recoverQuestion(username) {
    var user = getUser(username);
    if (!user || user.admin || !user.question) return "";
    return user.question;
  }
  function recoverPin(username, answer, newPin) {
    username = String(username || "").trim();
    answer = normalizeAnswer(answer);
    newPin = String(newPin || "").trim();
    if (!validPin(newPin)) throw new Error("pin");
    var list = readUsers();
    var found = null;
    list = list.map(function (u) {
      if (u.username !== username) return u;
      if (normalizeAnswer(u.answer) !== answer) return u;
      found = u;
      return Object.assign({}, u, { pin: newPin });
    });
    if (!found) throw new Error("answer");
    writeUsers(list);
    return found.username;
  }
  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("username", "username", { unique: false });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function withStore(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var store = tx.objectStore(STORE);
        Promise.resolve(fn(store)).then(function (value) {
          tx.oncomplete = function () { db.close(); resolve(value); };
          tx.onerror = function () { db.close(); reject(tx.error); };
        }).catch(function (err) { db.close(); reject(err); });
      });
    });
  }
  function userFiles(name) {
    return withStore("readonly", function (store) {
      return new Promise(function (resolve, reject) {
        var idx = store.index("username");
        var req = idx.getAll(name);
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  function saveFile(row) {
    return withStore("readwrite", function (store) { store.put(row); return row; });
  }
  function deleteFile(id) {
    return withStore("readwrite", function (store) { store.delete(id); });
  }
  function fileToPages(file) {
    var type = (file.type || "").toLowerCase();
    var name = (file.name || "").toLowerCase();
    if (type.indexOf("image/") === 0) {
      return file.arrayBuffer().then(function (buf) {
        return { type: "pages", pages: [new Blob([buf], { type: file.type || "image/jpeg" })], fileBlob: new Blob([buf], { type: file.type }) };
      });
    }
    if (type.indexOf("video/") === 0 || /\.(mp4|webm|mov|m4v)$/.test(name)) {
      return file.arrayBuffer().then(function (buf) {
        return { type: "video", pages: [], fileBlob: new Blob([buf], { type: file.type || "video/mp4" }) };
      });
    }
    if (type.indexOf("pdf") !== -1 || name.slice(-4) === ".pdf") {
      if (!global.pdfjsLib) {
        return file.arrayBuffer().then(function (buf) {
          return { type: "file", pages: [], fileBlob: new Blob([buf], { type: "application/pdf" }) };
        });
      }
      return file.arrayBuffer().then(function (buf) {
        var copy = buf.slice(0);
        return global.pdfjsLib.getDocument({ data: buf }).promise.then(function (doc) {
          var jobs = [];
          for (var i = 1; i <= Math.min(doc.numPages, 20); i++) {
            jobs.push(doc.getPage(i).then(function (page) {
              var viewport = page.getViewport({ scale: 1.6 });
              var canvas = document.createElement("canvas");
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              return page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise.then(function () {
                return new Promise(function (resolve) {
                  canvas.toBlob(function (blob) { resolve(blob); }, "image/jpeg", 0.86);
                });
              });
            }));
          }
          return Promise.all(jobs).then(function (pages) {
            return { type: "pages", pages: pages.filter(Boolean), fileBlob: new Blob([copy], { type: "application/pdf" }) };
          });
        });
      });
    }
    return Promise.reject(new Error("type"));
  }

  global.BerakhotAccounts = {
    QUESTIONS: QUESTIONS,
    get ADMIN_USER() { return adminUser(); },
    validUser: validUser,
    validPin: validPin,
    validName: validName,
    allUsers: allUsers,
    getUser: getUser,
    findUser: findUser,
    session: session,
    setSession: setSession,
    remember: remember,
    setRemember: setRemember,
    adminRemember: adminRemember,
    setAdminRemember: setAdminRemember,
    isAdmin: isAdmin,
    registerUser: registerUser,
    addUser: addUser,
    removeUser: removeUser,
    resetPin: resetPin,
    setAdminAuth: setAdminAuth,
    recoverUsername: recoverUsername,
    recoverQuestion: recoverQuestion,
    recoverPin: recoverPin,
    userFiles: userFiles,
    saveFile: saveFile,
    deleteFile: deleteFile,
    fileToPages: fileToPages
  };
})(window);
