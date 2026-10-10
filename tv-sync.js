/* Phone sync for the TV tracker. No token belongs in this file. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TvSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var SETTINGS_KEY = "tv-tracker-settings-v1";
  var CACHE_KEY = "tv-tracker-cache-v1";
  var DEBOUNCE_MS = 1500;

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function emptyDoc() {
    return { updated: "", note: "", shows: [] };
  }

  function stripSecrets(doc) {
    var source = doc && typeof doc === "object" ? doc : emptyDoc();
    var copy = clone(source) || emptyDoc();
    delete copy.token;
    delete copy.authorization;
    delete copy.settings;
    if (!Array.isArray(copy.shows)) copy.shows = [];
    return copy;
  }

  function itemTime(show) {
    if (!show) return "";
    if (show.updatedAt) return String(show.updatedAt);
    if (show.watchedAt) return String(show.watchedAt) + "T00:00:00.000Z";
    return "";
  }

  var NOT_FOR_ME_STATUS = "dnf";

  function showStatus(show) {
    if (!show || typeof show !== "object") return "";
    return typeof show.status === "string" ? show.status : "";
  }

  function textField(value) {
    return typeof value === "string" ? value : "";
  }

  function designatedStatus(status) {
    return status === "near" || status === "long" || status === "watched" || status === "dnf" || status === "dismissed";
  }

  function dismissStatus() {
    return NOT_FOR_ME_STATUS ? NOT_FOR_ME_STATUS : "dismissed";
  }

  function isPlannedStatus(status) {
    return status === "near" || status === "long";
  }

  function plannedCount(list) {
    var shows = Array.isArray(list) ? list : [];
    var count = 0;
    shows.forEach(function (show) {
      if (show && isPlannedStatus(showStatus(show))) count += 1;
    });
    return count;
  }

  function pickShow(local, remote) {
    var localStatus = showStatus(local);
    var remoteStatus = showStatus(remote);
    if (localStatus === "suggested" && designatedStatus(remoteStatus)) return remote;
    if (remoteStatus === "suggested" && designatedStatus(localStatus)) return local;
    return itemTime(local) >= itemTime(remote) ? local : remote;
  }

  function mergeShows(localShows, remoteShows) {
    var localList = Array.isArray(localShows) ? localShows : [];
    var remoteList = Array.isArray(remoteShows) ? remoteShows : [];
    var localById = new Map();
    localList.forEach(function (show) {
      if (show && show.id != null && show.id !== "") localById.set(String(show.id), show);
    });
    var seen = new Set();
    var out = [];
    remoteList.forEach(function (remote) {
      if (!remote) return;
      if (remote.id == null || remote.id === "") {
        out.push(clone(remote));
        return;
      }
      var id = String(remote.id);
      seen.add(id);
      var local = localById.get(id);
      if (!local) {
        out.push(clone(remote));
        return;
      }
      out.push(clone(pickShow(local, remote)));
    });
    localList.forEach(function (local) {
      if (!local) return;
      if (local.id == null || local.id === "") {
        out.push(clone(local));
        return;
      }
      if (!seen.has(String(local.id))) out.push(clone(local));
    });
    return out;
  }

  function mergeDocs(localDoc, remoteDoc) {
    var local = stripSecrets(localDoc || emptyDoc());
    var remote = stripSecrets(remoteDoc || emptyDoc());
    var shows = mergeShows(local.shows, remote.shows);
    var pickLocal = String(local.updatedAt || "") >= String(remote.updatedAt || "");
    var winner = pickLocal ? local : remote;
    var other = pickLocal ? remote : local;
    var base = Object.assign({}, other, winner, { shows: shows });
    delete base.token;
    delete base.authorization;
    delete base.settings;
    return base;
  }

  function material(doc) {
    var clean = stripSecrets(doc || emptyDoc());
    var shows = (clean.shows || []).map(function (show) { return Object.assign({}, show); });
    shows.sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
    return JSON.stringify({ note: clean.note || "", shows: shows });
  }

  function bytesToB64(text) {
    var bytes = new TextEncoder().encode(String(text));
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function b64ToUtf8(b64) {
    var clean = String(b64 || "").replace(/\s/g, "");
    var bin = atob(clean);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function encodeDoc(doc) {
    return bytesToB64(JSON.stringify(stripSecrets(doc), null, 2) + "\n");
  }

  function decodeContent(content) {
    return stripSecrets(JSON.parse(b64ToUtf8(content)));
  }

  function cleanPath(path) {
    var parts = String(path || "tv-graph.json").trim().split("/");
    var kept = [];
    parts.forEach(function (part) {
      if (!part || part === "." || part === "..") return;
      kept.push(part);
    });
    return kept.length ? kept.join("/") : "tv-graph.json";
  }

  function contentsUrls(settings) {
    var owner = encodeURIComponent(String(settings.owner || "").trim());
    var repo = encodeURIComponent(String(settings.repo || "").trim());
    var path = cleanPath(settings.path);
    var encodedPath = path.split("/").map(encodeURIComponent).join("/");
    var branchName = String(settings.branch || "main").trim() || "main";
    var branch = encodeURIComponent(branchName);
    var base = "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + encodedPath;
    return { get: base + "?ref=" + branch, put: base, branch: branchName };
  }

  function authHeaders(token, jsonBody) {
    var headers = {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (jsonBody) headers["Content-Type"] = "application/json";
    return headers;
  }

  function redact(text, token) {
    var raw = String(text || "");
    if (!token) return raw;
    return raw.split(token).join("[redacted]");
  }

  function commitMessage(title, status) {
    var name = String(title || "show").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim() || "show";
    var next = String(status || "update").replace(/[\r\n]+/g, " ").trim() || "update";
    return "tv: " + name + " -> " + next;
  }

  function stampShows(prevShows, nextShows, stamp) {
    var prevById = new Map();
    (prevShows || []).forEach(function (show) {
      if (show && show.id != null) prevById.set(String(show.id), show);
    });
    return (nextShows || []).map(function (show) {
      if (!show) return show;
      var copy = Object.assign({}, show);
      if (copy.id == null) return copy;
      var prev = prevById.get(String(copy.id));
      if (!prev) {
        copy.updatedAt = stamp;
        return copy;
      }
      var before = Object.assign({}, prev);
      var after = Object.assign({}, copy);
      delete before.updatedAt;
      delete after.updatedAt;
      if (JSON.stringify(before) !== JSON.stringify(after)) copy.updatedAt = stamp;
      return copy;
    });
  }

  function memoryStorage(initial) {
    var map = new Map(Object.entries(initial || {}));
    return {
      getItem: function (key) { return map.has(key) ? map.get(key) : null; },
      setItem: function (key, value) { map.set(key, String(value)); }
    };
  }

  function createTrackerSync(options) {
    var opts = options || {};
    var fetchImpl = opts.fetch;
    var storage = opts.storage;
    var now = opts.now || function () { return new Date(); };
    var setTimer = opts.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
    var clearTimer = opts.clearTimer || function (id) { clearTimeout(id); };
    var debounceMs = opts.debounceMs == null ? DEBOUNCE_MS : opts.debounceMs;
    var online = opts.online || function () {
      return typeof navigator === "undefined" ? true : navigator.onLine !== false;
    };
    var onChange = opts.onChange || function () {};
    if (!fetchImpl) throw new Error("fetch is required");
    if (!storage) throw new Error("storage is required");

    var settings = readSettings();
    var packed = readCache();
    var doc = packed.doc;
    var sha = packed.sha;
    var dirty = packed.dirty;
    var pendingMessage = packed.pendingMessage;
    var seenNote = packed.seenNote;
    var status = "Synced";
    var errorDetail = "";
    var timer = null;
    var flushing = false;
    var booting = false;
    var rerun = false;
    var version = 0;

    function readSettings() {
      try {
        var raw = storage.getItem(SETTINGS_KEY);
        var parsed = raw ? JSON.parse(raw) : {};
        return normalizeSettings(parsed);
      } catch (e) {
        return normalizeSettings({});
      }
    }

    function readCache() {
      try {
        var raw = storage.getItem(CACHE_KEY);
        if (!raw) return { doc: emptyDoc(), sha: "", dirty: false, pendingMessage: "tv: update", seenNote: "" };
        var parsed = JSON.parse(raw);
        var nextDoc = stripSecrets(parsed.doc || emptyDoc());
        return {
          doc: nextDoc,
          sha: typeof parsed.sha === "string" ? parsed.sha : "",
          dirty: !!parsed.dirty,
          pendingMessage: typeof parsed.pendingMessage === "string" ? parsed.pendingMessage : "tv: update",
          seenNote: typeof parsed.seenNote === "string" ? parsed.seenNote : (nextDoc.note || "")
        };
      } catch (e) {
        return { doc: emptyDoc(), sha: "", dirty: false, pendingMessage: "tv: update", seenNote: "" };
      }
    }

    function configured() {
      return !!(settings.token && String(settings.owner || "").trim() && String(settings.repo || "").trim());
    }

    function persist() {
      storage.setItem(CACHE_KEY, JSON.stringify({
        doc: stripSecrets(doc),
        sha: sha || "",
        dirty: !!dirty,
        pendingMessage: pendingMessage,
        seenNote: seenNote || ""
      }));
    }

    function view() {
      return {
        doc: stripSecrets(doc),
        status: status,
        errorDetail: redact(errorDetail, settings.token),
        dirty: !!dirty,
        configured: configured()
      };
    }

    function emit() { onChange(view()); }

    function setStatus(next, detail) {
      status = next;
      errorDetail = detail || "";
      emit();
    }

    function schedule(delay) {
      if (timer) clearTimer(timer);
      timer = setTimer(function () {
        timer = null;
        return flush();
      }, delay == null ? debounceMs : delay);
    }

    function reconcile(localDoc, remoteDoc) {
      var merged = mergeDocs(localDoc, remoteDoc);
      var remote = stripSecrets(remoteDoc || emptyDoc());
      if ((stripSecrets(localDoc).note || "") === (seenNote || "")) merged.note = remote.note || "";
      return stripSecrets(merged);
    }

    function applyFailure(err) {
      if (err && err.doc) {
        doc = reconcile(stripSecrets(doc), err.doc);
        if (err.sha) sha = err.sha;
        dirty = true;
        try { persist(); } catch (e) { /* storage errors surface below */ }
      }
      if (err && err.code === "offline") setStatus("Offline", "Showing the copy saved on this phone.");
      else setStatus("Error", redact((err && err.message) || "Error", settings.token));
    }

    async function request(url, requestOptions) {
      if (settings.token && String(url).indexOf(settings.token) !== -1) {
        var blocked = new Error("Refusing to put the token in a URL.");
        blocked.code = "error";
        throw blocked;
      }
      try {
        return await fetchImpl(url, requestOptions);
      } catch (e) {
        if (e && e.code === "error") throw e;
        var offline = new Error("Could not reach GitHub.");
        offline.code = "offline";
        throw offline;
      }
    }

    async function readJson(res) {
      try { return await res.json(); }
      catch (e) { return {}; }
    }

    function failStatus(code) {
      if (code === 401 || code === 403) return "GitHub refused the token. Check Contents read and write on that one repo.";
      if (code === 404) return "File not found. Check owner, repo, path, and branch.";
      if (code === 409) return "GitHub save conflict. Your changes are still on this phone.";
      return "GitHub request failed (" + code + "). Your changes are still on this phone.";
    }

    async function getRemote() {
      var urls = contentsUrls(settings);
      var res = await request(urls.get, {
        method: "GET",
        headers: authHeaders(settings.token, false),
        cache: "no-store",
        credentials: "omit",
        redirect: "error"
      });
      if (!res.ok) {
        var http = new Error(failStatus(res.status));
        http.code = "http";
        http.status = res.status;
        throw http;
      }
      var body = await readJson(res);
      if (!body || typeof body.content !== "string" || typeof body.sha !== "string") {
        var bad = new Error("GitHub did not return the file.");
        bad.code = "http";
        throw bad;
      }
      try {
        return { doc: decodeContent(body.content), sha: body.sha };
      } catch (e) {
        var invalid = new Error("The file in git is not valid JSON.");
        invalid.code = "http";
        throw invalid;
      }
    }

    async function putRemote(nextDoc, baseSha, message) {
      var urls = contentsUrls(settings);
      var safeDoc = stripSecrets(nextDoc);
      var payload = {
        message: redact(message || "tv: update", settings.token).slice(0, 200),
        content: encodeDoc(safeDoc),
        branch: urls.branch
      };
      if (baseSha) payload.sha = baseSha;
      var bodyText = JSON.stringify(payload);
      if (settings.token && bodyText.indexOf(settings.token) !== -1) {
        var blocked = new Error("Refusing to send the token in the file.");
        blocked.code = "error";
        throw blocked;
      }
      var res = await request(urls.put, {
        method: "PUT",
        headers: authHeaders(settings.token, true),
        body: bodyText,
        cache: "no-store",
        credentials: "omit",
        redirect: "error"
      });
      if (res.status === 409) return { ok: false, status: 409 };
      if (!res.ok) {
        var http = new Error(failStatus(res.status));
        http.code = "http";
        http.status = res.status;
        throw http;
      }
      var body = await readJson(res);
      var nextSha = body && body.content && body.content.sha;
      if (!nextSha) {
        var missing = new Error("GitHub did not return the new sha.");
        missing.code = "http";
        throw missing;
      }
      return { ok: true, sha: nextSha, doc: safeDoc };
    }

    async function putWithRetry(localDoc, baseSha, message) {
      var first = await putRemote(localDoc, baseSha, message);
      if (first.ok) return first;
      var remote = await getRemote();
      var merged = reconcile(localDoc, remote.doc);
      var second = await putRemote(merged, remote.sha, message);
      if (second.ok) return { ok: true, sha: second.sha, doc: merged };
      var err = new Error(failStatus(409));
      err.code = "conflict";
      err.doc = merged;
      err.sha = remote.sha;
      throw err;
    }

    async function flush() {
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      if (!configured()) {
        setStatus("Setup", "Add a token, owner, and repo in Settings.");
        return;
      }
      if (!dirty) {
        setStatus("Synced", "");
        return;
      }
      if (booting || flushing) {
        rerun = true;
        return;
      }
      if (!online()) {
        setStatus("Offline", "Showing the copy saved on this phone.");
        return;
      }

      flushing = true;
      var seen = version;
      setStatus("Saving", "");
      try {
        var snapshot = stripSecrets(doc);
        var baseSha = sha;
        if (!baseSha) {
          var remote = await getRemote();
          var localNow = version === seen ? snapshot : stripSecrets(doc);
          snapshot = reconcile(localNow, remote.doc);
          doc = snapshot;
          sha = remote.sha;
          baseSha = remote.sha;
          persist();
          emit();
        } else if (version !== seen) {
          snapshot = stripSecrets(doc);
        }
        var result = await putWithRetry(snapshot, baseSha, pendingMessage);
        if (version !== seen) {
          doc = reconcile(stripSecrets(doc), result.doc);
          sha = result.sha;
          dirty = true;
          persist();
          flushing = false;
          rerun = false;
          setStatus("Saving", "");
          schedule(debounceMs);
          return;
        }
        doc = result.doc;
        sha = result.sha;
        seenNote = doc.note || "";
        dirty = false;
        pendingMessage = "tv: update";
        persist();
        flushing = false;
        setStatus("Synced", "");
      } catch (err) {
        flushing = false;
        applyFailure(err);
      }
      if (rerun) {
        rerun = false;
        if (dirty) schedule(debounceMs);
      }
    }

    async function boot() {
      booting = true;
      try {
        if (!configured()) {
          setStatus("Setup", "Add a token, owner, and repo in Settings.");
          return;
        }
        if (!online()) {
          setStatus("Offline", "Showing the copy saved on this phone.");
          return;
        }
        var remote = await getRemote();
        if (dirty) {
          doc = reconcile(stripSecrets(doc), remote.doc);
          sha = remote.sha;
          dirty = material(doc) !== material(remote.doc);
          persist();
          if (dirty) {
            setStatus("Saving", "");
            schedule(debounceMs);
          } else {
            seenNote = doc.note || "";
            setStatus("Synced", "");
          }
        } else {
          doc = stripSecrets(remote.doc);
          sha = remote.sha;
          seenNote = doc.note || "";
          dirty = false;
          persist();
          setStatus("Synced", "");
        }
      } catch (err) {
        applyFailure(err);
      } finally {
        booting = false;
        if (rerun && dirty && online() && configured()) {
          rerun = false;
          schedule(debounceMs);
        }
      }
    }

    function markChanged(nextDoc, message) {
      version += 1;
      var stamp = now().toISOString();
      var clean = stripSecrets(nextDoc);
      clean.shows = stampShows(doc.shows, clean.shows, stamp);
      clean.updatedAt = stamp;
      clean.updated = stamp.slice(0, 10);
      doc = clean;
      dirty = true;
      if (message) pendingMessage = redact(message, settings.token).slice(0, 200);
      try { persist(); } catch (e) {
        setStatus("Error", "This browser blocked local storage. The last tap is still on screen.");
        return;
      }
      if (!configured()) {
        setStatus("Setup", "Add a token, owner, and repo in Settings.");
        return;
      }
      if (!online()) {
        setStatus("Offline", "Showing the copy saved on this phone.");
        return;
      }
      setStatus("Saving", "");
      schedule(debounceMs);
    }

    function saveSettings(next) {
      settings = normalizeSettings(next || {});
      storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return boot();
    }

    function getSettings() {
      return {
        token: settings.token,
        owner: settings.owner,
        repo: settings.repo,
        path: settings.path,
        branch: settings.branch
      };
    }

    function importDoc(raw) {
      var parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!parsed || !Array.isArray(parsed.shows)) {
        var err = new Error("That file has no shows list. Nothing was changed.");
        err.code = "error";
        throw err;
      }
      markChanged(parsed, "tv: import backup");
    }

    function retryIfDirty() {
      if (dirty && configured() && online()) schedule(debounceMs);
    }

    function noteOffline() {
      if (!configured()) return;
      setStatus("Offline", "Showing the copy saved on this phone.");
    }

    if (!configured()) {
      status = "Setup";
      errorDetail = "Add a token, owner, and repo in Settings.";
    } else if (!online()) {
      status = "Offline";
      errorDetail = "Showing the copy saved on this phone.";
    } else if (dirty) {
      status = "Saving";
    }
    emit();

    return {
      boot: boot,
      flush: flush,
      markChanged: markChanged,
      saveSettings: saveSettings,
      getSettings: getSettings,
      exportDoc: function () { return stripSecrets(doc); },
      importDoc: importDoc,
      retryIfDirty: retryIfDirty,
      noteOffline: noteOffline,
      getDoc: function () { return stripSecrets(doc); },
      getStatus: function () { return view(); }
    };
  }

  function imdbUrl(show) {
    var src = show && typeof show === "object" ? show : {};
    var id = typeof src.imdb === "string" ? src.imdb.trim() : "";
    if (/^tt\d{7,}$/.test(id)) return "https://www.imdb.com/title/" + id + "/";
    var title = String(src.title || "").replace(/\s+/g, " ").trim();
    var yearMatch = String(src.years || "").match(/\d{4}/);
    var year = yearMatch ? yearMatch[0] : "";
    var query = title && year ? title + " " + year : (title || year);
    return "https://www.imdb.com/find/?q=" + encodeURIComponent(query);
  }

  function localDate(date, timeZone) {
    var value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) return "";
    var options = { year: "numeric", month: "2-digit", day: "2-digit" };
    if (timeZone) options.timeZone = timeZone;
    var parts = new Intl.DateTimeFormat("en-US", options).formatToParts(value);
    var bag = { year: "", month: "", day: "" };
    parts.forEach(function (part) {
      if (part.type === "year" || part.type === "month" || part.type === "day") bag[part.type] = part.value;
    });
    if (!bag.year || !bag.month || !bag.day) return "";
    return bag.year + "-" + bag.month + "-" + bag.day;
  }

  function imdbLabel(show) {
    var src = show && typeof show === "object" ? show : {};
    if (typeof src.imdb === "number" && Number.isFinite(src.imdb)) return String(src.imdb);
    if (typeof src.imdb === "string" && /^\d+(\.\d+)?$/.test(src.imdb)) return src.imdb;
    return "IMDb";
  }

  function imdbScore(show) {
    if (!show || typeof show !== "object") return 0;
    if (typeof show.imdb === "number" && Number.isFinite(show.imdb)) return show.imdb;
    if (typeof show.imdb === "string" && /^\d+(\.\d+)?$/.test(show.imdb)) return Number(show.imdb);
    return 0;
  }

  function likedLaneScores(list) {
    var score = {};
    var shows = Array.isArray(list) ? list : [];
    shows.forEach(function (show) {
      if (!show || typeof show !== "object") return;
      if (show.status !== "watched") return;
      var verdict = show.verdict;
      if (verdict === "trash" || verdict === "dnf" || verdict === "ok") return;
      var bump = verdict === "fantastic" || verdict === "great" ? 2 : 1;
      score[show.lane] = (score[show.lane] || 0) + bump;
    });
    return score;
  }

  function showRank(show, scores) {
    var lanes = scores || {};
    var lane = show ? show.lane : undefined;
    var flag = show ? show.flag : undefined;
    var n = imdbScore(show) * 10 + (lanes[lane] || 0) * 4;
    if (lane === "fight") n -= 30;
    if (flag === "homework") n -= 8;
    if (flag === "marriage" || flag === "low") n -= 40;
    return n;
  }

  function matchesTab(show, tab) {
    var status = showStatus(show);
    if (tab === "dnf") return status === "dnf" || status === "dismissed";
    return status === tab;
  }

  function searchHay(show) {
    return [
      textField(show && show.title),
      textField(show && show.lane),
      textField(show && show.why),
      textField(show && show.basedOn)
    ].join(" ").toLowerCase();
  }

  function filterShows(list, options) {
    var opts = options || {};
    var tab = typeof opts.tab === "string" ? opts.tab : "";
    var lane = typeof opts.lane === "string" && opts.lane ? opts.lane : "all";
    var query = typeof opts.query === "string" ? opts.query.toLowerCase() : "";
    var source = Array.isArray(list) ? list : [];
    var scores = likedLaneScores(source);
    var rows = [];
    source.forEach(function (show) {
      if (!show || typeof show !== "object") return;
      if (!matchesTab(show, tab)) return;
      if (lane !== "all" && textField(show.lane) !== lane) return;
      if (query && searchHay(show).indexOf(query) === -1) return;
      rows.push(show);
    });
    rows.sort(function (a, b) {
      if (tab === "watched") return textField(b.watchedAt).localeCompare(textField(a.watchedAt));
      return showRank(b, scores) - showRank(a, scores);
    });
    return rows;
  }

  function cardFields(show) {
    var src = show && typeof show === "object" ? show : {};
    var status = showStatus(src);
    return {
      id: src.id == null ? "" : String(src.id),
      title: textField(src.title),
      years: textField(src.years),
      lane: textField(src.lane),
      why: textField(src.why),
      where: textField(src.where),
      flag: textField(src.flag),
      basedOn: textField(src.basedOn).trim(),
      status: status,
      known: status === "suggested" || designatedStatus(status),
      imdbHref: imdbUrl(src),
      imdbLabel: imdbLabel(src),
      watchedAt: textField(src.watchedAt),
      verdict: textField(src.verdict)
    };
  }

  function applyStatus(show, kind, day) {
    var next = Object.assign({}, show || {});
    if (kind === "watched") {
      next.status = "watched";
      if (!next.watchedAt) next.watchedAt = day || "";
      if (!next.verdict) next.verdict = "liked";
      return next;
    }
    if (kind === "dismiss") {
      next.status = dismissStatus();
      if (next.status === "dnf" && !next.verdict) next.verdict = "dnf";
      return next;
    }
    if (kind === "near" || kind === "long" || kind === "dnf") {
      next.status = kind;
      if (kind === "dnf" && !next.verdict) next.verdict = "dnf";
      return next;
    }
    return next;
  }

  function normalizeSettings(input) {
    var src = input || {};
    var token = typeof src.token === "string" ? src.token : "";
    token = token.trim().replace(/^Bearer\s+/i, "").replace(/[\r\n]/g, "").trim();
    return {
      token: token,
      owner: typeof src.owner === "string" ? src.owner.trim() : "",
      repo: typeof src.repo === "string" ? src.repo.trim() : "",
      path: cleanPath(typeof src.path === "string" && src.path.trim() ? src.path : "tv-graph.json"),
      branch: typeof src.branch === "string" && src.branch.trim() ? src.branch.trim() : "main"
    };
  }

  return {
    DEBOUNCE_MS: DEBOUNCE_MS,
    SETTINGS_KEY: SETTINGS_KEY,
    CACHE_KEY: CACHE_KEY,
    emptyDoc: emptyDoc,
    stripSecrets: stripSecrets,
    mergeShows: mergeShows,
    mergeDocs: mergeDocs,
    encodeDoc: encodeDoc,
    decodeContent: decodeContent,
    contentsUrls: contentsUrls,
    commitMessage: commitMessage,
    memoryStorage: memoryStorage,
    createTrackerSync: createTrackerSync,
    imdbUrl: imdbUrl,
    localDate: localDate,
    applyStatus: applyStatus,
    dismissStatus: dismissStatus,
    plannedCount: plannedCount,
    filterShows: filterShows,
    cardFields: cardFields
  };
});
