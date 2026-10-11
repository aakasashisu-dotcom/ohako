// オハコ帳 本体
(function () {
  "use strict";

  var CFG = window.OHAKO_CONFIG || {};
  var N = window.OhakoNotes;
  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------
  // 小さなDOMヘルパー(文字列はすべてtextContentで入れる)
  // ------------------------------------------------------------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  function toast(msg) {
    var t = $("toast");
    // 開いているシートの上に出す(ダイアログは最前面に表示されるため)
    var open = document.querySelector("dialog[open]");
    var host = open || document.body;
    if (t.parentNode !== host) host.appendChild(t);
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function lsGet(key, fallback) {
    try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 保存できない環境 */ }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ------------------------------------------------------------
  // データ保存先:Firebase(ログインした本人のデータ)または この端末(お試し)
  // ------------------------------------------------------------
  function hasFirebaseConfig() {
    var f = CFG.firebase || {};
    return !!(f.apiKey && f.projectId && window.firebase);
  }

  function createLocalStore() {
    var KEY = "ohako.local.v1";
    var data = lsGet(KEY, null);
    if (!data) {
      var now = Date.now();
      data = {
        songs: {
          ex1: { title: "(例)夜明けのテールランプ", artist: "サンプル歌手", maxNote: 69, minNote: 50, createdAt: now - 3000, createdByName: "お試し" },
          ex2: { title: "(例)ミッドナイト・コーラス", artist: "見本バンド", maxNote: 74, minNote: 55, createdAt: now - 2000, createdByName: "お試し" },
          ex3: { title: "(例)ゆっくり歩こう", artist: "テスト合唱団", maxNote: 64, minNote: 48, createdAt: now - 1000, createdByName: "お試し" }
        },
        scores: {
          s1: { songId: "ex1", score: 88.512, machine: "DAM", key: 0, date: today(), memo: "サビの高音が少し苦しい", createdAt: now },
          s2: { songId: "ex1", score: 90.104, machine: "DAM", key: -1, date: today(), memo: "", createdAt: now + 1 },
          s3: { songId: "ex3", score: 93.25, machine: "JOYSOUND", key: 0, date: today(), memo: "", createdAt: now + 2 }
        },
        favs: { ex3: { createdAt: now } },
        profile: { name: "", rangeMax: 70, rangeMin: 48 }
      };
      lsSet(KEY, data);
    }
    var subs = { songs: [], scores: [], favs: [], profile: [] };
    function emit(kind) {
      lsSet(KEY, data);
      subs[kind].forEach(function (cb) { cb(listOf(kind)); });
    }
    function listOf(kind) {
      if (kind === "profile") return data.profile;
      return Object.keys(data[kind]).map(function (id) { return Object.assign({ id: id }, data[kind][id]); });
    }
    function sub(kind, cb) { subs[kind].push(cb); cb(listOf(kind)); }
    return {
      mode: "local",
      start: function (onUser) { onUser({ uid: "local", name: data.profile.name || "" }); },
      signIn: function () { return Promise.resolve(); },
      signOut: function () { return Promise.resolve(); },
      onSongs: function (cb) { sub("songs", cb); },
      onScores: function (cb) { sub("scores", cb); },
      onFavs: function (cb) { sub("favs", cb); },
      onProfile: function (cb) { sub("profile", cb); },
      addSong: function (d) { var id = uid(); data.songs[id] = Object.assign({ createdAt: Date.now() }, d); emit("songs"); return Promise.resolve(id); },
      updateSong: function (id, d) { data.songs[id] = Object.assign({}, data.songs[id], d, { updatedAt: Date.now() }); emit("songs"); return Promise.resolve(); },
      deleteSong: function (id) {
        delete data.songs[id];
        Object.keys(data.scores).forEach(function (k) { if (data.scores[k].songId === id) delete data.scores[k]; });
        delete data.favs[id];
        emit("songs"); emit("scores"); emit("favs");
        return Promise.resolve();
      },
      addScore: function (d) { data.scores[uid()] = Object.assign({ createdAt: Date.now() }, d); emit("scores"); return Promise.resolve(); },
      deleteScore: function (id) { delete data.scores[id]; emit("scores"); return Promise.resolve(); },
      setFav: function (songId, on) { if (on) data.favs[songId] = { createdAt: Date.now() }; else delete data.favs[songId]; emit("favs"); return Promise.resolve(); },
      saveProfile: function (p) { data.profile = Object.assign({}, data.profile, p); emit("profile"); return Promise.resolve(); },
      clearAll: function () { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); }
    };
  }

  function createFirebaseStore() {
    firebase.initializeApp(CFG.firebase);
    var auth = firebase.auth();
    var db = firebase.firestore();
    try { db.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}
    var me = null;
    var unsubs = [];
    var FV = firebase.firestore.FieldValue;

    function userCol(name) { return db.collection("users").doc(me.uid).collection(name); }
    function snapList(snap) { return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); }
    function watch(ref, cb, mapper) {
      unsubs.push(ref.onSnapshot(function (s) { cb(mapper(s)); }, function (err) {
        console.error(err);
        toast(err.code === "permission-denied" ? "このアカウントには閲覧の許可がありません" : "データの読み込みに失敗しました");
      }));
    }

    return {
      mode: "firebase",
      start: function (onUser) {
        auth.getRedirectResult().catch(function (e) { showLoginError(e); });
        auth.onAuthStateChanged(function (u) {
          unsubs.forEach(function (f) { f(); });
          unsubs = [];
          me = u ? { uid: u.uid, name: u.displayName || "", photo: u.photoURL || "" } : null;
          onUser(me);
        });
      },
      signIn: function () {
        var p = new firebase.auth.GoogleAuthProvider();
        return auth.signInWithPopup(p).catch(function (e) {
          if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
            return auth.signInWithRedirect(p);
          }
          throw e;
        });
      },
      signOut: function () { return auth.signOut(); },
      onSongs: function (cb) { watch(userCol("songs"), cb, snapList); },
      onScores: function (cb) { watch(userCol("scores"), cb, snapList); },
      onFavs: function (cb) { watch(userCol("favs"), cb, snapList); },
      onProfile: function (cb) { watch(db.collection("users").doc(me.uid), cb, function (s) { return s.exists ? s.data() : {}; }); },
      // 曲リストも点数も、すべて自分のアカウントの中に保存する(友達とは共有しない)
      addSong: function (d) {
        return userCol("songs").add(Object.assign({}, d, { createdAt: Date.now() })).then(function (r) { return r.id; });
      },
      updateSong: function (id, d) { return userCol("songs").doc(id).update(Object.assign({}, d, { updatedAt: Date.now() })); },
      deleteSong: function (id) {
        // その曲の点数記録と十八番も一緒に消す
        var batch = db.batch();
        state.scores.filter(function (s) { return s.songId === id; }).forEach(function (s) { batch.delete(userCol("scores").doc(s.id)); });
        batch.delete(userCol("favs").doc(id));
        batch.delete(userCol("songs").doc(id));
        return batch.commit();
      },
      addScore: function (d) { return userCol("scores").add(Object.assign({ createdAt: Date.now() }, d)); },
      deleteScore: function (id) { return userCol("scores").doc(id).delete(); },
      setFav: function (songId, on) {
        var ref = userCol("favs").doc(songId);
        return on ? ref.set({ createdAt: Date.now() }) : ref.delete();
      },
      saveProfile: function (p) { return db.collection("users").doc(me.uid).set(Object.assign({}, p, { updatedAt: FV.serverTimestamp() }), { merge: true }); }
    };
  }

  // ------------------------------------------------------------
  // 状態
  // ------------------------------------------------------------
  var store = hasFirebaseConfig() ? createFirebaseStore() : createLocalStore();
  var state = {
    user: null,
    songs: [], scores: [], favs: {}, profile: {},
    view: lsGet("ohako.view", "songs"),
    sort: lsGet("ohako.sort", "new"),
    rangeOnly: lsGet("ohako.rangeOnly", false),
    query: "",
    openSongId: null
  };

  function currentName() {
    return (state.user && state.user.name) || "設定";
  }

  function statsFor(songId) {
    var list = state.scores.filter(function (s) { return s.songId === songId; });
    var best = null;
    list.forEach(function (s) { if (best == null || s.score > best) best = s.score; });
    return { count: list.length, best: best, list: list };
  }

  function myRange() {
    var p = state.profile || {};
    return { max: p.rangeMax == null ? null : Number(p.rangeMax), min: p.rangeMin == null ? null : Number(p.rangeMin) };
  }

  // ------------------------------------------------------------
  // 画面の切り替え
  // ------------------------------------------------------------
  function showView(name) {
    state.view = name;
    lsSet("ohako.view", name);
    ["songs", "favs", "settings"].forEach(function (v) {
      $("view-" + v).hidden = v !== name;
    });
    $("view-login").hidden = true;
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("is-active", t.dataset.view === name);
    });
    if (name === "settings") fillSettings();
    window.scrollTo(0, 0);
  }

  function showLogin() {
    ["songs", "favs", "settings"].forEach(function (v) { $("view-" + v).hidden = true; });
    $("view-login").hidden = false;
    $("tabbar").hidden = true;
    $("userChip").hidden = true;
  }

  function showLoginError(e) {
    var el = $("loginError");
    var code = e && e.code;
    var msg = "ログインに失敗しました。";
    if (code === "auth/unauthorized-domain") msg = "このURLはログインが許可されていません。Firebaseの「承認済みドメイン」にこのサイトのドメインを追加してください。";
    else if (code === "auth/popup-closed-by-user") msg = "ログイン画面が閉じられました。もう一度お試しください。";
    else if (code) msg += "(" + code + ")";
    el.textContent = msg;
    el.hidden = false;
  }

  // ------------------------------------------------------------
  // 曲リストの描画
  // ------------------------------------------------------------
  function visibleSongs() {
    var q = N.normalize(state.query);
    var list = state.songs.slice();
    if (q) {
      list = list.filter(function (s) {
        return N.normalize(s.title).indexOf(q) >= 0 || N.normalize(s.artist).indexOf(q) >= 0;
      });
    }
    var cache = {};
    function st(id) { return cache[id] || (cache[id] = statsFor(id)); }
    var byStr = function (a, b) { return String(a || "").localeCompare(String(b || ""), "ja"); };
    var nullLast = function (a, b, dir) {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return dir * (a - b);
    };
    list.sort(function (a, b) {
      switch (state.sort) {
        case "title": return byStr(a.title, b.title);
        case "artist": return byStr(a.artist, b.artist) || byStr(a.title, b.title);
        case "best": return nullLast(st(a.id).best, st(b.id).best, -1);
        case "count": return st(b.id).count - st(a.id).count;
        default: return (b.createdAt || 0) - (a.createdAt || 0);
      }
    });
    return list;
  }

  function thumbUrl(song) {
    return song.videoId ? "https://i.ytimg.com/vi/" + song.videoId + "/mqdefault.jpg" : null;
  }

  function songCard(song) {
    var s = statsFor(song.id);
    var fav = !!state.favs[song.id];
    var thumb = thumbUrl(song);
    return h("li", null,
      h("button", { class: "song-card", type: "button", onclick: function () { openDetail(song.id); } },
        h("div", { class: "thumb" + (thumb ? "" : " thumb-empty") },
          thumb ? h("img", { src: thumb, alt: "", loading: "lazy" }) : h("span", { class: "thumb-note", text: "♪" })
        ),
        h("div", { class: "song-main" },
          h("div", { class: "song-title" }, fav ? h("span", { class: "fav-star", "aria-label": "十八番", text: "★" }) : null, song.title || "(無題)"),
          h("div", { class: "song-artist", text: song.artist || "歌手名なし" })
        ),
        h("div", { class: "song-score" },
          h("span", { class: "score-num", text: s.best != null ? N.formatScore(s.best) : "—" }),
          h("span", { class: "score-label", text: s.count ? s.count + "回" : "未記録" })
        )
      )
    );
  }

  function renderSongs() {
    var list = visibleSongs();
    var ul = $("songList");
    ul.replaceChildren.apply(ul, list.map(songCard));
    var empty = $("songsEmpty");
    if (list.length) { empty.hidden = true; }
    else {
      empty.hidden = false;
      empty.replaceChildren();
      if (!state.songs.length) {
        empty.appendChild(h("p", { text: "まだ曲が登録されていません。" }));
        empty.appendChild(h("p", { class: "hint", text: "右下の「＋ 曲を追加」から、最初の1曲を登録しましょう。" }));
      } else {
        empty.appendChild(h("p", { text: "検索に合う曲がありません。" }));
      }
    }
    $("rangeNote").textContent = state.query
      ? state.songs.length + "曲中 " + list.length + "曲"
      : "全" + state.songs.length + "曲";
  }

  function renderFavs() {
    var list = state.songs.filter(function (s) { return state.favs[s.id]; });
    list.sort(function (a, b) {
      var A = statsFor(a.id).best, B = statsFor(b.id).best;
      if (A == null && B == null) return 0;
      if (A == null) return 1;
      if (B == null) return -1;
      return B - A;
    });
    var ul = $("favList");
    ul.replaceChildren.apply(ul, list.map(songCard));
    $("favsEmpty").hidden = list.length > 0;
  }

  function renderAll() {
    renderSongs();
    renderFavs();
    if (state.openSongId && $("detailDialog").open) renderDetail();
  }

  // ------------------------------------------------------------
  // 曲の詳細
  // ------------------------------------------------------------
  function linkUrl(tpl, song) {
    var q = encodeURIComponent([song.title, song.artist].filter(Boolean).join(" "));
    return tpl.replace("{q}", q).replace("{title}", encodeURIComponent(song.title || ""));
  }

  var detailUi = { playing: false, ytOpen: false, ytResults: null, ytError: "", ytLoading: false, confirmDelete: false, confirmScore: null };

  function openDetail(id) {
    state.openSongId = id;
    detailUi = { playing: false, ytOpen: false, ytResults: null, ytError: "", ytLoading: false, confirmDelete: false, confirmScore: null };
    renderDetail();
    var d = $("detailDialog");
    if (!d.open) d.showModal();
    $("detailBody").scrollTop = 0;
  }

  function renderDetail() {
    var song = state.songs.find(function (s) { return s.id === state.openSongId; });
    var body = $("detailBody");
    if (!song) { $("detailDialog").close(); return; }
    var stats = statsFor(song.id);
    var fav = !!state.favs[song.id];
    var L = CFG.links || {};

    // 動画エリア
    var media;
    if (song.videoId && detailUi.playing) {
      media = h("div", { class: "media" },
        h("iframe", {
          src: "https://www.youtube-nocookie.com/embed/" + song.videoId + "?autoplay=1&playsinline=1&rel=0",
          title: "公式動画", allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true
        }));
    } else if (song.videoId) {
      media = h("button", { class: "media media-thumb", type: "button", "aria-label": "動画を再生", onclick: function () { detailUi.playing = true; renderDetail(); } },
        h("img", { src: "https://i.ytimg.com/vi/" + song.videoId + "/hqdefault.jpg", alt: "" }),
        h("span", { class: "play", text: "▶" }));
    } else {
      media = h("div", { class: "media media-empty" },
        h("span", { text: "公式動画が未登録です" }));
    }

    var bestId = null;
    stats.list.forEach(function (s) { if (s.score === stats.best && bestId == null) bestId = s.id; });
    var history = stats.list.slice().sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || "")) || (b.createdAt || 0) - (a.createdAt || 0);
    });

    // 動画部分は変化があったときだけ作り直す(再生中の動画が止まらないように)
    var mediaKey = (song.videoId || "") + "|" + detailUi.playing;
    var mediaWrap = $("detailMedia"), restWrap = $("detailRest");
    if (!mediaWrap) {
      mediaWrap = h("div", { id: "detailMedia" });
      restWrap = h("div", { id: "detailRest" });
      body.replaceChildren(mediaWrap, restWrap);
    }
    if (mediaWrap.dataset.key !== mediaKey) {
      mediaWrap.dataset.key = mediaKey;
      mediaWrap.replaceChildren(media);
    }

    restWrap.replaceChildren(
      h("div", { class: "detail-head" },
        h("h2", { id: "detailTitle", class: "detail-title", text: song.title || "(無題)" }),
        h("p", { class: "detail-artist", text: song.artist || "歌手名なし" }),
        h("div", { class: "note-row note-row-2" },
          h("div", { class: "note-box" }, h("span", { class: "note-label", text: "自己ベスト" }), h("span", { class: "note-val", text: stats.best != null ? N.formatScore(stats.best) : "—" })),
          h("div", { class: "note-box" }, h("span", { class: "note-label", text: "歌った回数" }), h("span", { class: "note-val", text: stats.count + "回" }))
        ),
        h("button", { class: "btn btn-wide fav-btn" + (fav ? " is-on" : ""), type: "button", "aria-pressed": fav ? "true" : "false",
          onclick: function () { store.setFav(song.id, !fav).then(function () { toast(fav ? "十八番から外しました" : "十八番にしました"); }); } },
          fav ? "★ 十八番(外す)" : "☆ 十八番にする")
      ),

      h("div", { class: "links" },
        h("a", { class: "link-btn link-joy link-full", href: linkUrl(L.joysound, song), target: "_blank", rel: "noopener" }, "JOYSOUNDで探す"),
        h("a", { class: "link-btn", href: linkUrl(L.utanet, song), target: "_blank", rel: "noopener" }, "歌詞(歌ネット)"),
        h("a", { class: "link-btn", href: linkUrl(L.lyricsGoogle, song), target: "_blank", rel: "noopener" }, "歌詞(Google)")
      ),

      videoSection(song),
      scoreForm(song),

      h("section", { class: "detail-sec" },
        h("h3", { text: "点数の記録" }),
        history.length ? h("ul", { class: "history" }, history.map(function (s) {
          var confirming = detailUi.confirmScore === s.id;
          return h("li", { class: "hist" + (s.id === bestId ? " is-best" : "") },
            h("div", { class: "hist-main" },
              h("span", { class: "hist-score", text: N.formatScore(s.score) }),
              s.id === bestId ? h("span", { class: "chip chip-best", text: "ベスト" }) : null,
              h("span", { class: "hist-meta", text: [s.date, s.machine, s.key ? "キー" + (s.key > 0 ? "+" : "") + s.key : "原曲キー"].filter(Boolean).join(" ・ ") }),
              s.memo ? h("p", { class: "hist-memo", text: s.memo }) : null
            ),
            h("button", { class: "icon-btn hist-del" + (confirming ? " is-confirm" : ""), type: "button", "aria-label": "この記録を削除",
              onclick: function () {
                if (confirming) { store.deleteScore(s.id).then(function () { toast("記録を削除しました"); }); detailUi.confirmScore = null; }
                else { detailUi.confirmScore = s.id; renderDetail(); }
              } }, confirming ? "削除" : "✕")
          );
        })) : h("p", { class: "hint", text: "まだ記録がありません。歌ったら上のフォームから点数を残しましょう。" })
      ),

      h("section", { class: "detail-sec detail-foot" },
        h("div", { class: "foot-actions" },
          h("button", { class: "btn", type: "button", onclick: function () { openForm(song); } }, "曲の情報を編集"),
          detailUi.confirmDelete
            ? h("button", { class: "btn btn-danger", type: "button", onclick: function () {
                store.deleteSong(song.id).then(function () { $("detailDialog").close(); toast("曲を削除しました"); })
                  .catch(function () { toast("削除できませんでした"); });
              } }, "本当に削除する(点数記録も消えます)")
            : h("button", { class: "btn btn-ghost-danger", type: "button", onclick: function () { detailUi.confirmDelete = true; renderDetail(); } }, "曲を削除")
        )
      )
    );
  }

  function videoSection(song) {
    var sec = h("section", { class: "detail-sec" });
    var head = h("div", { class: "sec-head" },
      h("h3", { text: "公式動画" }),
      h("button", { class: "btn btn-sm", type: "button", "aria-expanded": detailUi.ytOpen ? "true" : "false",
        onclick: function () {
          detailUi.ytOpen = !detailUi.ytOpen;
          if (detailUi.ytOpen && CFG.youtubeApiKey && !detailUi.ytResults) searchYoutube(song, defaultQuery(song));
          renderDetail();
        } }, detailUi.ytOpen ? "閉じる" : (song.videoId ? "動画を変更" : "動画を探す"))
    );
    sec.appendChild(head);
    if (!detailUi.ytOpen) return sec;

    if (CFG.youtubeApiKey) {
      var qi = h("input", { type: "search", id: "ytQuery", value: defaultQuery(song), "aria-label": "動画の検索ワード" });
      sec.appendChild(h("form", { class: "yt-search", onsubmit: function (e) { e.preventDefault(); searchYoutube(song, qi.value); } },
        qi, h("button", { class: "btn btn-sm btn-primary", type: "submit" }, "検索")));
      if (detailUi.ytLoading) sec.appendChild(h("p", { class: "hint", text: "検索中…" }));
      if (detailUi.ytError) sec.appendChild(h("p", { class: "form-error", text: detailUi.ytError }));
      if (detailUi.ytResults) {
        sec.appendChild(h("ul", { class: "yt-results" }, detailUi.ytResults.map(function (v) {
          return ytResultItem(v, v.id === song.videoId, function () { setVideo(song, v.id, v.title); });
        })));
        if (!detailUi.ytResults.length) sec.appendChild(h("p", { class: "hint", text: "見つかりませんでした。検索ワードを変えてみてください。" }));
      }
    } else {
      sec.appendChild(h("p", { class: "hint", text: "YouTube APIキーが未設定なので、アプリ内検索は使えません。YouTubeで動画を探し、URLを下に貼り付けてください。" }));
    }

    var ui = h("input", { type: "url", id: "ytUrl", placeholder: "YouTubeの動画URLを貼り付け", inputmode: "url", "aria-label": "動画URL" });
    sec.appendChild(h("form", { class: "yt-search", onsubmit: function (e) {
      e.preventDefault();
      var id = N.parseVideoId(ui.value);
      if (!id) { toast("YouTubeの動画URLを読み取れませんでした"); return; }
      setVideo(song, id, "");
    } }, ui, h("button", { class: "btn btn-sm", type: "submit" }, "登録")));

    if (song.videoId) {
      sec.appendChild(h("button", { class: "btn btn-sm btn-ghost-danger", type: "button", onclick: function () {
        store.updateSong(song.id, { videoId: null, videoTitle: null }).then(function () { toast("動画の登録を外しました"); });
      } }, "動画の登録を外す"));
    }
    return sec;
  }

  function defaultQuery(song) {
    return [song.title, song.artist].filter(Boolean).join(" ") + " MV";
  }

  function setVideo(song, id, title) {
    store.updateSong(song.id, { videoId: id, videoTitle: title || null }).then(function () {
      detailUi.ytOpen = false;
      detailUi.playing = false;
      toast("公式動画を登録しました");
    }).catch(function () { toast("登録できませんでした"); });
  }

  function decodeEntities(s) {
    var t = document.createElement("textarea");
    t.innerHTML = s;
    return t.value;
  }

  // YouTube検索(成功で動画の配列、失敗でメッセージ付きのエラー)
  function ytSearch(q) {
    var url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&regionCode=JP&q=" +
      encodeURIComponent(q) + "&key=" + encodeURIComponent(CFG.youtubeApiKey);
    return fetch(url).catch(function () {
      throw new Error("通信に失敗しました。電波の良い場所で試してください。");
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (res) {
      if (!res.ok) {
        var reason = res.j && res.j.error && res.j.error.errors && res.j.error.errors[0] && res.j.error.errors[0].reason;
        var msg;
        if (reason === "quotaExceeded") msg = "今日の検索回数の上限(約100回)に達しました。明日になると戻ります。URL貼り付けは今でも使えます。";
        else if (reason === "keyInvalid" || reason === "badRequest") msg = "YouTube APIキーが正しくありません。config.js を確認してください。";
        else if (res.j && res.j.error && res.j.error.status === "PERMISSION_DENIED") msg = "APIキーの制限でこのサイトから使えません。キーの「ウェブサイトの制限」にこのサイトのURLを追加してください。";
        else msg = "検索に失敗しました。" + (reason ? "(" + reason + ")" : "");
        throw new Error(msg);
      }
      return (res.j.items || []).map(function (it) {
        var sn = it.snippet || {};
        return {
          id: it.id && it.id.videoId,
          title: decodeEntities(sn.title || ""),
          channel: decodeEntities(sn.channelTitle || ""),
          thumb: (sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default) || {}).url || ""
        };
      }).filter(function (v) { return v.id; });
    });
  }

  function ytResultItem(v, current, onPick) {
    return h("li", null, h("button", { class: "yt-item" + (current ? " is-current" : ""), type: "button", onclick: onPick },
      h("img", { src: v.thumb, alt: "", loading: "lazy" }),
      h("span", { class: "yt-text" }, h("span", { class: "yt-title", text: v.title }), h("span", { class: "yt-ch", text: v.channel }))
    ));
  }

  function searchYoutube(song, q) {
    detailUi.ytLoading = true;
    detailUi.ytError = "";
    renderDetail();
    ytSearch(q).then(function (items) {
      detailUi.ytResults = items;
    }).catch(function (e) {
      detailUi.ytResults = null;
      detailUi.ytError = e.message;
    }).then(function () {
      detailUi.ytLoading = false;
      if (state.openSongId === song.id) renderDetail();
    });
  }

  var lastScoreForm = lsGet("ohako.lastScore", { machine: "DAM" });

  function scoreForm(song) {
    var score = h("input", { type: "number", id: "sScore", inputmode: "decimal", step: "0.001", min: "0", max: "100", placeholder: "例:91.234", required: true });
    var machine = h("select", { id: "sMachine" }, ["DAM", "JOYSOUND", "その他"].map(function (m) {
      return h("option", { value: m, selected: lastScoreForm.machine === m }, m);
    }));
    var keys = [];
    for (var i = -7; i <= 7; i++) keys.push(i);
    var defKey = 0;
    var key = h("select", { id: "sKey" }, keys.map(function (v) {
      return h("option", { value: String(v), selected: v === defKey }, v === 0 ? "原曲キー" : (v > 0 ? "+" : "") + v);
    }));
    var date = h("input", { type: "date", id: "sDate", value: today() });
    var memo = h("input", { type: "text", id: "sMemo", maxlength: "100", placeholder: "メモ(任意)例:Aメロ低め" });

    return h("form", { class: "detail-sec score-form", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var v = parseFloat(score.value);
      if (isNaN(v) || v < 0 || v > 100) { toast("点数は0〜100の数字で入れてください"); score.focus(); return; }
      lastScoreForm = { machine: machine.value };
      lsSet("ohako.lastScore", lastScoreForm);
      var best = statsFor(song.id).best;
      store.addScore({ songId: song.id, score: v, machine: machine.value, key: parseInt(key.value, 10), date: date.value || today(), memo: memo.value.trim() })
        .then(function () { toast(best == null || v > best ? "自己ベスト更新!" : "記録しました"); })
        .catch(function () { toast("保存できませんでした"); });
    } },
      h("h3", { text: "点数を記録" }),
      h("div", { class: "score-grid" },
        h("label", { class: "sg-score" }, "点数", score),
        h("label", null, "機種", machine),
        h("label", null, "キー", key),
        h("label", null, "日付", date)
      ),
      memo,
      h("button", { class: "btn btn-primary btn-wide", type: "submit" }, "記録する")
    );
  }

  // ------------------------------------------------------------
  // 曲の追加・編集フォーム
  // ------------------------------------------------------------
  var editingId = null;

  // 追加画面の「YouTubeから探す」
  var formYt = { picked: null };

  function formYtStatus(msg, isError) {
    var el = $("fYtStatus");
    el.textContent = msg || "";
    el.className = isError ? "form-error" : "hint";
    el.hidden = !msg;
  }

  function runFormYtSearch() {
    var q = $("fYtQuery").value.trim();
    if (!q) { $("fYtQuery").focus(); return; }
    formYtStatus("検索中…");
    $("fYtResults").replaceChildren();
    ytSearch(q).then(function (items) {
      formYtStatus(items.length ? "動画を選ぶと、曲名・歌手名・動画が入ります。" : "見つかりませんでした。検索ワードを変えてみてください。");
      renderFormYtResults(items);
    }).catch(function (e) { formYtStatus(e.message, true); });
  }

  function renderFormYtResults(items) {
    var ul = $("fYtResults");
    ul.replaceChildren.apply(ul, items.map(function (v) {
      return ytResultItem(v, formYt.picked === v.id, function () {
        var guess = N.parseVideoTitle(v.title, v.channel);
        formYt.picked = v.id;
        $("fTitle").value = guess.title;
        $("fArtist").value = guess.artist;
        $("fVideo").value = "https://www.youtube.com/watch?v=" + v.id;
        $("formError").hidden = true;
        renderFormYtResults(items);
        formYtStatus("入力しました。曲名と歌手名を確認して「追加する」を押してください。");
        $("fTitle").scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }));
  }

  $("fYtBtn").addEventListener("click", runFormYtSearch);
  $("fYtQuery").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); runFormYtSearch(); }
  });

  function openForm(song) {
    editingId = song ? song.id : null;
    $("formTitle").textContent = song ? "曲の情報を編集" : "曲を追加";
    $("formSubmit").textContent = song ? "保存する" : "追加する";
    $("fTitle").value = song ? song.title || "" : "";
    $("fArtist").value = song ? song.artist || "" : "";
    $("fVideo").value = song && song.videoId ? "https://www.youtube.com/watch?v=" + song.videoId : "";
    $("formError").hidden = true;
    // YouTube検索は新しく追加するときだけ(APIキーがあるとき)
    var useYt = !song && !!CFG.youtubeApiKey;
    $("formYt").hidden = !useYt;
    formYt.picked = null;
    $("fYtQuery").value = "";
    $("fYtResults").replaceChildren();
    formYtStatus("");
    $("formDialog").showModal();
    if (!song) setTimeout(function () { (useYt ? $("fYtQuery") : $("fTitle")).focus(); }, 50);
  }

  function formError(msg) {
    var e = $("formError");
    e.textContent = msg;
    e.hidden = false;
  }

  $("songForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var title = $("fTitle").value.trim();
    var artist = $("fArtist").value.trim();
    var vRaw = $("fVideo").value.trim();
    var videoId = vRaw ? N.parseVideoId(vRaw) : null;
    if (!title) { formError("曲名を入れてください。"); $("fTitle").focus(); return; }
    if (vRaw && !videoId) { formError("YouTubeの動画URLを読み取れませんでした。"); return; }
    var dup = state.songs.find(function (s) {
      return s.id !== editingId && N.normalize(s.title) === N.normalize(title) && N.normalize(s.artist) === N.normalize(artist);
    });
    if (dup) { formError("同じ曲がすでに登録されています。"); return; }

    var data = { title: title, artist: artist };
    if (vRaw || editingId) data.videoId = videoId;
    var p = editingId ? store.updateSong(editingId, data) : store.addSong(data);
    var wasEditing = editingId;
    p.then(function (newId) {
      $("formDialog").close();
      toast(wasEditing ? "保存しました" : "追加しました");
      if (!wasEditing && newId) openDetail(newId);
    }).catch(function () { formError("保存できませんでした。通信状態を確認してください。"); });
  });

  // ------------------------------------------------------------
  // 設定
  // ------------------------------------------------------------
  function fillSettings() {
    var p = state.profile || {};
    $("modeInfo").textContent = store.mode === "firebase"
      ? "Firebaseに接続中:曲リスト・点数・十八番はすべて自分のアカウントだけに保存されます。どの端末からログインしても同じデータが見られます。"
      : "お試しモード:Firebaseが未設定のため、データはこの端末のブラウザだけに保存されます。";
    $("ytInfo").textContent = CFG.youtubeApiKey
      ? "YouTube動画検索:使えます(1日あたり約100回まで)"
      : "YouTube動画検索:APIキー未設定(URL貼り付けでの登録は使えます)";
    $("logoutBtn").hidden = store.mode !== "firebase";
    $("clearLocalBtn").hidden = store.mode !== "local";
  }

  $("logoutBtn").addEventListener("click", function () { store.signOut(); });

  var clearArmed = false;
  $("clearLocalBtn").addEventListener("click", function () {
    if (!clearArmed) {
      clearArmed = true;
      $("clearLocalBtn").textContent = "もう一度押すと消えます";
      setTimeout(function () { clearArmed = false; $("clearLocalBtn").textContent = "お試しデータをすべて消す"; }, 4000);
      return;
    }
    store.clearAll();
  });

  // ------------------------------------------------------------
  // イベント
  // ------------------------------------------------------------
  document.querySelectorAll(".tab").forEach(function (t) {
    t.addEventListener("click", function () { showView(t.dataset.view); });
  });

  document.querySelectorAll("dialog").forEach(function (d) {
    d.addEventListener("click", function (e) {
      if (e.target === d || e.target.closest("[data-close]")) d.close();
    });
  });
  $("detailDialog").addEventListener("close", function () {
    state.openSongId = null;
    $("detailBody").replaceChildren(); // 動画の再生を止める
  });

  $("searchInput").addEventListener("input", function (e) { state.query = e.target.value; renderSongs(); });
  if (["new", "title", "artist", "best", "count"].indexOf(state.sort) < 0) state.sort = "new";
  $("sortSelect").value = state.sort;
  $("sortSelect").addEventListener("change", function (e) { state.sort = e.target.value; lsSet("ohako.sort", state.sort); renderSongs(); });
  $("addSongBtn").addEventListener("click", function () { openForm(null); });
  $("loginBtn").addEventListener("click", function () {
    $("loginError").hidden = true;
    store.signIn().catch(showLoginError);
  });
  $("userChip").addEventListener("click", function () { showView("settings"); });

  // ------------------------------------------------------------
  // 起動
  // ------------------------------------------------------------
  $("modeBadge").hidden = store.mode !== "local";

  store.start(function (user) {
    state.user = user;
    state.songs = []; state.scores = []; state.favs = {}; state.profile = {};
    if (!user) { showLogin(); return; }
    $("tabbar").hidden = false;
    var chip = $("userChip");
    chip.hidden = store.mode === "local";
    chip.textContent = user.name || "設定";
    store.onSongs(function (list) { state.songs = list; renderAll(); });
    store.onScores(function (list) {
      state.scores = list.map(function (s) { return Object.assign({}, s, { score: Number(s.score) }); });
      renderAll();
    });
    store.onFavs(function (list) {
      var m = {};
      list.forEach(function (f) { m[f.id] = true; });
      state.favs = m;
      renderAll();
    });
    store.onProfile(function (p) {
      state.profile = p || {};
      renderAll();
    });
    showView(["songs", "favs", "settings"].indexOf(state.view) >= 0 ? state.view : "songs");
  });
})();
