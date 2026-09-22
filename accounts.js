(function (global) {
  var ADMIN_USER = "yosefyotam";
  var ADMIN_PIN = "1029";
  var USERS_KEY = "berakhot-users";
  var REMEMBER_KEY = "berakhot-remember";
  var ADMIN_REMEMBER_KEY = "berakhot-admin-remember";
  var SESSION_KEY = "berakhot-session";
  var DB_NAME = "berakhot-teachers";
  var STORE = "files";

  function readUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY) || "[]"); } catch (e) { return []; }
  }
  function writeUsers(list) {
    localStorage.setItem(USERS_KEY, JSON.stringify(list));
  }
  function allUsers() {
    var list = readUsers().filter(function (u) { return u.username !== ADMIN_USER; });
    list.unshift({ username: ADMIN_USER, pin: ADMIN_PIN, admin: true });
    return list;
  }
  function validUser(name) { return /^[a-zA-Z][a-zA-Z0-9._-]{1,20}$/.test(name || ""); }
  function validPin(pin) { return /^\d{4}$/.test(pin || ""); }
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
    return String(name || session()) === ADMIN_USER;
  }
  function addUser(name, pin) {
    name = String(name || "").trim();
    pin = String(pin || "").trim();
    if (!validUser(name)) throw new Error("user");
    if (!validPin(pin)) throw new Error("pin");
    if (name === ADMIN_USER) throw new Error("admin");
    var list = readUsers().filter(function (u) { return u.username !== name; });
    list.push({ username: name, pin: pin });
    writeUsers(list);
  }
  function removeUser(name) {
    if (name === ADMIN_USER) return;
    writeUsers(readUsers().filter(function (u) { return u.username !== name; }));
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
    ADMIN_USER: ADMIN_USER,
    validUser: validUser,
    validPin: validPin,
    allUsers: allUsers,
    findUser: findUser,
    session: session,
    setSession: setSession,
    remember: remember,
    setRemember: setRemember,
    adminRemember: adminRemember,
    setAdminRemember: setAdminRemember,
    isAdmin: isAdmin,
    addUser: addUser,
    removeUser: removeUser,
    userFiles: userFiles,
    saveFile: saveFile,
    deleteFile: deleteFile,
    fileToPages: fileToPages
  };
})(window);
