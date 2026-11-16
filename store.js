(function (global) {
  var GH = { owner: "YH-EDU", repo: "mishnayot-berakhot", branch: "main" };
  var LETTERS = "אבגדהוזחט";
  var TOKEN_KEY = "berakhot-gh-token";

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function setToken(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value.trim());
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }
  function canSave() { return !!token(); }
  function chapterName(perek) { return "פרק " + LETTERS.charAt(perek - 1); }
  function mishnahName(mish) { return "משנה " + LETTERS.charAt(mish - 1); }
  function apiUrl(path) {
    return "https://api.github.com/repos/" + GH.owner + "/" + GH.repo + "/contents/" +
      String(path).split("/").map(encodeURIComponent).join("/");
  }
  function headers() {
    return {
      Authorization: "Bearer " + token(),
      Accept: "application/vnd.github+json"
    };
  }
  function bytesToBase64(buffer) {
    var bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    var out = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(out);
  }
  function textToBase64(text) {
    return bytesToBase64(new TextEncoder().encode(text));
  }
  function getJson(path) {
    return fetch(apiUrl(path) + "?ref=" + GH.branch, { headers: headers() }).then(function (res) {
      if (res.status === 404) return { exists: false, sha: "", json: null, raw: null };
      if (!res.ok) throw new Error("github-get");
      return res.json().then(function (data) {
        var raw = "";
        if (data.encoding === "base64") {
          var bin = atob(data.content.replace(/\n/g, ""));
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          raw = new TextDecoder("utf-8").decode(bytes);
        }
        var json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch (e) { json = null; }
        return { exists: true, sha: data.sha, json: json, raw: raw };
      });
    });
  }
  function putFile(path, contentBase64, message, sha) {
    var body = { message: message, content: contentBase64, branch: GH.branch };
    if (sha) body.sha = sha;
    return fetch(apiUrl(path), {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, headers()),
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) return res.json().then(function (err) { throw new Error((err && err.message) || "github-put"); });
      return res.json();
    });
  }
  function deleteFile(path, message) {
    return fetch(apiUrl(path) + "?ref=" + GH.branch, { headers: headers() }).then(function (res) {
      if (res.status === 404) return;
      if (!res.ok) throw new Error("github-get");
      return res.json().then(function (data) {
        return fetch(apiUrl(path), {
          method: "DELETE",
          headers: Object.assign({ "Content-Type": "application/json" }, headers()),
          body: JSON.stringify({ message: message, sha: data.sha, branch: GH.branch })
        });
      });
    });
  }
  function loadRegistry() {
    return getJson("חומרים/רישום.json").then(function (info) {
      var items = (info.json && info.json.items) || [];
      return { sha: info.sha, items: items };
    });
  }
  function saveRegistry(items, sha, message) {
    return putFile("חומרים/רישום.json", textToBase64(JSON.stringify({ items: items }, null, 2)), message, sha);
  }
  function safeName(name) {
    return String(name || "קובץ").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "קובץ";
  }

  function isZipName(ext, file) {
    return ext === "zip" || String((file && file.type) || "").indexOf("zip") !== -1;
  }
  function isHtmlName(ext, file) {
    return ext === "html" || ext === "htm" || String((file && file.type) || "") === "text/html";
  }
  function safeZipPath(rel) {
    rel = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel || rel.indexOf("..") !== -1 || /(^|\/)(__MACOSX|\.)/.test(rel)) return "";
    return rel;
  }
  function pickIndexHtml(names) {
    var lower = names.map(function (n) { return n.toLowerCase(); });
    var exact = ["index.html", "index.htm"];
    for (var i = 0; i < exact.length; i++) {
      var at = lower.indexOf(exact[i]);
      if (at >= 0) return names[at];
    }
    var nested = names.filter(function (n) { return /\/index\.html?$/i.test(n); }).sort(function (a, b) { return a.length - b.length; });
    if (nested.length) return nested[0];
    var htmls = names.filter(function (n) { return /\.html?$/i.test(n); });
    return htmls[0] || "";
  }
  function unpackZipToRepo(folder, file) {
    if (!global.JSZip) return Promise.reject(new Error("jszip"));
    return global.JSZip.loadAsync(file).then(function (zip) {
      var names = [];
      var pending = [];
      zip.forEach(function (rel, entry) {
        if (entry.dir) return;
        var clean = safeZipPath(rel);
        if (!clean) return;
        names.push(clean);
        pending.push(entry.async("arraybuffer").then(function (buf) {
          return putFile(folder + "/" + clean, bytesToBase64(buf), "לומדה: " + clean);
        }));
      });
      if (!names.length) return Promise.reject(new Error("empty-zip"));
      return Promise.all(pending).then(function () { return pickIndexHtml(names) || names[0]; });
    });
  }
  function deleteTree(rel, message) {
    return fetch(apiUrl(rel) + "?ref=" + GH.branch, { headers: headers() }).then(function (res) {
      if (res.status === 404) return;
      if (!res.ok) throw new Error("github-get");
      return res.json().then(function (data) {
        if (Array.isArray(data)) {
          return data.reduce(function (chain, item) {
            return chain.then(function () {
              if (item.type === "dir") return deleteTree(rel + "/" + item.name, message);
              return deleteFile(rel + "/" + item.name, message || "מחיקה");
            });
          }, Promise.resolve());
        }
        return deleteFile(rel, message || "מחיקה");
      });
    });
  }

  function uploadFile(perek, role, file, mish, opts) {
    if (!canSave()) return Promise.reject(new Error("no-token"));
    if (file.size > 90 * 1024 * 1024) return Promise.reject(new Error("too-big"));
    var name = safeName(file.name);
    var ext = name.toLowerCase().replace(/^.*\./, "");
    var isVideo = /^(mp4|webm|mov|m4v)$/.test(ext) || (file.type || "").indexOf("video/") === 0;
    var isPdf = ext === "pdf" || (file.type || "").indexOf("pdf") !== -1;
    var isImage = /^(png|jpg|jpeg|webp|gif)$/.test(ext) || (file.type || "").indexOf("image/") === 0;
    opts = opts || {};
    var asLomda = opts.kind === "לומדה" || opts.type === "lomda";
    var folderRole = asLomda ? "לומדות" : (isVideo ? "סרטונים" : (role === "מבחנים" ? "מבחנים" : "עזרים"));
    var stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    var place = chapterName(perek) + (mish ? "/" + mishnahName(mish) : "");
    var folder = "חומרים/" + place + "/" + folderRole + "/" + stamp + "-" + name.replace(/\.[^.]+$/, "");
    var kind = asLomda ? "lomda" : (isVideo ? "video" : (isPdf ? "pdf" : (isImage ? "pages" : "file")));
    showProgress("שומר באתר: " + name);
    var pack = (asLomda && isZipName(ext, file) && global.JSZip)
      ? unpackZipToRepo(folder, file).then(function (entry) { return { pages: [], file: entry || name }; })
      : file.arrayBuffer().then(function (buf) {
        return putFile(folder + "/" + name, bytesToBase64(buf), "הוספת " + name + " ל" + place).then(function () {
          return { pages: (!asLomda && isImage) ? [name] : [], file: name };
        });
      });
    return pack.then(function (out) {
          var meta = {
            id: stamp + "-" + name.replace(/\.[^.]+$/, ""),
            name: name,
            role: folderRole,
            type: kind,
            pages: out.pages,
            file: out.file,
            path: folder,
            perek: perek,
            mish: mish || 0,
            mishnayot: mish ? [mish] : []
          };
          return putFile(folder + "/meta.json", textToBase64(JSON.stringify(meta, null, 2)), "רישום " + name).then(function () {
            return loadRegistry().then(function (reg) {
              var items = reg.items.filter(function (row) { return row.id !== meta.id; });
              items.push(publicItem(meta));
              return saveRegistry(items, reg.sha, "עדכון רישום חומרים").then(function () { return publicItem(meta); });
            });
          });
    });
  }

  function publicItem(meta) {
    var rel = meta.path;
    return {
      id: meta.id,
      name: meta.name,
      role: meta.role,
      type: meta.type,
      pages: (meta.pages || []).map(function (p) { return "/" + rel + "/" + p; }),
      file: meta.file ? "/" + rel + "/" + meta.file : "",
      path: rel,
      perek: meta.perek,
      mish: meta.mish || 0,
      mishnayot: meta.mishnayot || (meta.mish ? [meta.mish] : []),
      youtubeId: meta.youtubeId || "",
      url: meta.url || ""
    };
  }

  function addYoutube(perek, vid, title, mish) {
    if (!canSave()) return Promise.reject(new Error("no-token"));
    var item = {
      id: "yt-" + vid + "-" + perek + "-" + (mish || 0),
      name: title || "סרטון יוטיוב",
      role: "youtube",
      type: "youtube",
      youtubeId: vid,
      url: "https://www.youtube.com/watch?v=" + vid,
      perek: perek,
      mish: mish || 0,
      mishnayot: mish ? [mish] : []
    };
    var place = chapterName(perek) + (mish ? "/" + mishnahName(mish) : "");
    var linksPath = "חומרים/" + place + "/קישורים.json";
    return getJson(linksPath).then(function (info) {
      var links = (info.json || []).filter(function (row) { return row.youtubeId !== vid; });
      links.push(item);
      return putFile(linksPath, textToBase64(JSON.stringify(links, null, 2)), "קישור יוטיוב ל" + place, info.sha);
    }).then(function () {
      return loadRegistry().then(function (reg) {
        var items = reg.items.filter(function (row) {
          return row.youtubeId !== vid || Number(row.perek) !== perek || Number(row.mish) !== Number(mish || 0);
        });
        items.push(item);
        return saveRegistry(items, reg.sha, "רישום קישור יוטיוב").then(function () { return item; });
      });
    });
  }

  function addUrlItem(perek, url, title, mish, type) {
    if (!canSave()) return Promise.reject(new Error("no-token"));
    type = type === "lomda" ? "lomda" : "link";
    var item = {
      id: type + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      name: title || (type === "lomda" ? "לומדה" : "קישור"),
      role: type === "lomda" ? "לומדות" : "עזרים",
      type: type,
      url: url,
      perek: perek,
      mish: mish || 0,
      mishnayot: mish ? [mish] : []
    };
    var place = chapterName(perek) + (mish ? "/" + mishnahName(mish) : "");
    var linksPath = "חומרים/" + place + "/קישורים.json";
    return getJson(linksPath).then(function (info) {
      var links = (info.json || []).filter(function (row) { return !(row.url === url && row.type === type); });
      links.push(item);
      return putFile(linksPath, textToBase64(JSON.stringify(links, null, 2)), (type === "lomda" ? "לומדה" : "קישור לאתר") + " ל" + place, info.sha);
    }).then(function () {
      return loadRegistry().then(function (reg) {
        var items = reg.items.filter(function (row) { return row.id !== item.id; });
        items.push(item);
        return saveRegistry(items, reg.sha, "רישום " + (type === "lomda" ? "לומדה" : "קישור")).then(function () { return item; });
      });
    });
  }


  function removeItem(row) {
    if (!canSave()) return Promise.reject(new Error("no-token"));
    var jobs = [];
    if (row.youtubeId || ((row.type === "link" || row.type === "lomda") && row.url && !row.path)) {
      var place = chapterName(row.perek || 1) + (row.mish ? "/" + mishnahName(row.mish) : "");
      var linksPath = "חומרים/" + place + "/קישורים.json";
      jobs.push(getJson(linksPath).then(function (info) {
        var links = (info.json || []).filter(function (x) { return x.id !== row.id && !(row.youtubeId && x.youtubeId === row.youtubeId); });
        return putFile(linksPath, textToBase64(JSON.stringify(links, null, 2)), "מחיקת קישור", info.sha);
      }));
    } else if (row.path) {
      jobs.push(deleteTree(row.path.replace(/^\//, ""), "מחיקת חומר"));
    }
    return Promise.all(jobs).then(function () {
      return loadRegistry().then(function (reg) {
        var items = reg.items.filter(function (x) { return x.id !== row.id; });
        return saveRegistry(items, reg.sha, "עדכון רישום אחרי מחיקה");
      });
    });
  }

  function showProgress(text) {
    if (typeof global.showToast === "function") global.showToast(text);
  }

  function fetchSiteJson() {
    return fetch("חומרים/רישום.json", { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("registry");
      return res.json();
    }).then(function (data) { return data.items || []; }).catch(function () { return []; });
  }

  function zipAndDownload(files, zipName) {
    if (!global.JSZip) return Promise.reject(new Error("jszip"));
    var zip = new global.JSZip();
    var jobs = files.map(function (entry) {
      return fetch(entry.url).then(function (res) {
        if (!res.ok) return;
        return res.blob().then(function (blob) { zip.file(entry.name, blob); });
      }).catch(function () {});
    });
    return Promise.all(jobs).then(function () {
      return zip.generateAsync({ type: "blob" }).then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = zipName;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      });
    });
  }

  function notebookPagesFor(perek, allItems) {
    var files = [];
    allItems.forEach(function (item) {
      if (perek && item.perek !== perek) return;
      (item.pages || []).forEach(function (n) {
        var num = String(n).padStart(2, "0");
        files.push({
          name: "מחברת/" + chapterName(item.perek) + "/משנה " + LETTERS.charAt(item.mish - 1) + "/p" + num + ".jpg",
          url: "pages/p" + num + ".jpg"
        });
      });
    });
    return files;
  }

  function materialFiles(items, kind) {
    var files = [];
    items.forEach(function (row) {
      if (kind === "videos") {
        if (row.type !== "video" || !row.file) return;
        files.push({
          name: chapterName(row.perek) + "/סרטונים/" + (row.name || row.file.split("/").pop()),
          url: String(row.file).replace(/^\//, "")
        });
        return;
      }
      if (row.type === "video" || row.type === "youtube") return;
      if (row.file) {
        files.push({
          name: chapterName(row.perek) + "/" + (row.role || "עזרים") + "/" + (row.name || row.file.split("/").pop()),
          url: String(row.file).replace(/^\//, "")
        });
      }
      (row.pages || []).forEach(function (src, i) {
        files.push({
          name: chapterName(row.perek) + "/" + (row.role || "עזרים") + "/" + (row.name || "דף").replace(/\.[^.]+$/, "") + "-p" + String(i + 1).padStart(2, "0") + ".jpg",
          url: String(src).replace(/^\//, "")
        });
      });
    });
    return files;
  }

  function downloadPack(kind, perek, mishnahItems) {
    showProgress("מכין הורדה...");
    return fetchSiteJson().then(function (materials) {
      var scoped = materials.filter(function (row) { return !perek || Number(row.perek) === perek; });
      var files = [];
      var name = "ברכות";
      if (kind === "videos") {
        files = materialFiles(scoped, "videos");
        name += (perek ? "-" + chapterName(perek) : "") + "-סרטונים.zip";
      } else {
        files = notebookPagesFor(perek, mishnahItems).concat(materialFiles(scoped, "pages"));
        name += (perek ? "-" + chapterName(perek) : "-כל-המסכת") + "-דפים.zip";
      }
      if (!files.length) throw new Error("empty");
      return zipAndDownload(files, name);
    });
  }

  global.BerakhotStore = {
    canSave: canSave,
    token: token,
    setToken: setToken,
    uploadFile: uploadFile,
    addYoutube: addYoutube,
    addUrlItem: addUrlItem,
    removeItem: removeItem,
    downloadPack: downloadPack
  };
})(window);
