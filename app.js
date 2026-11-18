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
  // データ保存先:この端末のブラウザ(ログイン不要)
  // ------------------------------------------------------------
  var STORE_KEY = "ohako.local.v1";

  function emptyData() { return { songs: {}, scores: {}, favs: {}, profile: {} }; }

  // 読み込んだデータの形を整える(壊れた値や古い形でも動くように)
  function normalizeData(d) {
    var out = emptyData();
    if (!d || typeof d !== "object") return out;
    ["songs", "scores", "favs"].forEach(function (k) {
      var src = d[k];
      if (src && typeof src === "object" && !Array.isArray(src)) {
        Object.keys(src).forEach(function (id) { if (src[id] && typeof src[id] === "object") out[k][id] = src[id]; });
      }
    });
    if (d.profile && typeof d.profile === "object") out.profile = d.profile;
    // 存在しない曲への記録・お気に入りは捨てる
    Object.keys(out.scores).forEach(function (id) { if (!out.songs[out.scores[id].songId]) delete out.scores[id]; });
    Object.keys(out.favs).forEach(function (id) { if (!out.songs[id]) delete out.favs[id]; });
    return out;
  }

  function createLocalStore() {
    var data = normalizeData(lsGet(STORE_KEY, null));
    var subs = { songs: [], scores: [], favs: [], profile: [] };
    var warned = false;

    function save() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(data));
      } catch (e) {
        if (!warned) { toast("この端末に保存できませんでした。ブラウザの設定(プライベートモードなど)を確認してください"); warned = true; }
      }
    }
    function listOf(kind) {
      if (kind === "profile") return data.profile;
      return Object.keys(data[kind]).map(function (id) { return Object.assign({ id: id }, data[kind][id]); });
    }
    function notify(kind) { subs[kind].forEach(function (cb) { cb(listOf(kind)); }); }
    function emit(kind) { save(); notify(kind); }
    function emitAll() { save(); ["songs", "scores", "favs", "profile"].forEach(notify); }
    function sub(kind, cb) { subs[kind].push(cb); cb(listOf(kind)); }

    // 別のタブで変更されたら取り込む
    window.addEventListener("storage", function (e) {
      if (e.key !== STORE_KEY) return;
      data = normalizeData(lsGet(STORE_KEY, null));
      ["songs", "scores", "favs", "profile"].forEach(notify);
    });

    // ブラウザに「このデータは消さないで」と頼む(対応ブラウザのみ)
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

    return {
      start: function (onReady) { onReady(); },
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
        emitAll();
        return Promise.resolve();
      },
      addScore: function (d) { data.scores[uid()] = Object.assign({ createdAt: Date.now() }, d); emit("scores"); return Promise.resolve(); },
      deleteScore: function (id) { delete data.scores[id]; emit("scores"); return Promise.resolve(); },
      updateScore: function (id, d) { data.scores[id] = Object.assign({}, data.scores[id], d, { updatedAt: Date.now() }); emit("scores"); return Promise.resolve(); },
      setFav: function (songId, on) { if (on) data.favs[songId] = { createdAt: Date.now() }; else delete data.favs[songId]; emit("favs"); return Promise.resolve(); },
      saveProfile: function (p) { data.profile = Object.assign({}, data.profile, p); emit("profile"); return Promise.resolve(); },
      exportData: function () { return { app: "ohako", version: 1, exportedAt: new Date().toISOString(), data: data }; },
      importData: function (obj) {
        var src = obj && obj.app === "ohako" && obj.data ? obj.data : obj;
        var next = normalizeData(src);
        if (!Object.keys(next.songs).length) return Promise.reject(new Error("empty"));
        data = next;
        emitAll();
        return Promise.resolve({ songs: Object.keys(data.songs).length, scores: Object.keys(data.scores).length });
      },
      clearAll: function () { data = emptyData(); emitAll(); return Promise.resolve(); }
    };
  }

  // ------------------------------------------------------------
  // 状態
  // ------------------------------------------------------------
  var store = createLocalStore();
  var state = {
    songs: [], favs: {}, profile: {},
    view: lsGet("ohako.view", "songs"),
    sort: lsGet("ohako.sort", "new"),
    query: "",
    openSongId: null
  };

  // "2026-10-12" → 今年なら "10/12"、それ以外は "2025/3/4"
  function shortDate(d, withYear) {
    if (!d) return "";
    var p = d.split("-");
    if (p.length !== 3) return d;
    var y = p[0], m = String(parseInt(p[1], 10)), day = String(parseInt(p[2], 10));
    if (!withYear && y === String(new Date().getFullYear())) return m + "/" + day;
    return y + "/" + m + "/" + day;
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
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("is-active", t.dataset.view === name);
    });
    if (name === "settings") fillSettings();
    window.scrollTo(0, 0);
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
    list.sort(function (a, b) {
      switch (state.sort) {
        case "title": return byStr(a.title, b.title);
        case "artist": return byStr(a.artist, b.artist) || byStr(a.title, b.title);
        default: return (b.createdAt || 0) - (a.createdAt || 0);
      }
    });
    return list;
  }

  function byStr(a, b) { return String(a || "").localeCompare(String(b || ""), "ja"); }

  function thumbUrl(song) {
    return song.videoId ? "https://i.ytimg.com/vi/" + song.videoId + "/mqdefault.jpg" : null;
  }

  function songCard(song) {
    var fav = !!state.favs[song.id];
    var thumb = thumbUrl(song);
    return h("li", null,
      h("button", { class: "song-card", type: "button", onclick: function () { openDetail(song.id); } },
        h("div", { class: "thumb" + (thumb ? "" : " thumb-empty") },
          thumb ? h("img", { src: thumb, alt: "", loading: "lazy" }) : h("span", { class: "thumb-note", text: "♪" })
        ),
        h("div", { class: "song-main" },
          h("div", { class: "song-title" }, fav ? h("span", { class: "fav-star", "aria-label": "お気に入り", text: "★" }) : null, song.title || "(無題)"),
          h("div", { class: "song-artist", text: song.artist || "歌手名なし" })
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
    list.sort(function (a, b) { return byStr(a.title, b.title); });
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

  var detailUi = { playing: false, ytOpen: false, ytResults: null, ytError: "", ytLoading: false, confirmDelete: false };

  function openDetail(id) {
    state.openSongId = id;
    detailUi = { playing: false, ytOpen: false, ytResults: null, ytError: "", ytLoading: false, confirmDelete: false };
    renderDetail();
    var d = $("detailDialog");
    if (!d.open) d.showModal();
    $("detailBody").scrollTop = 0;
  }

  function renderDetail() {
    var song = state.songs.find(function (s) { return s.id === state.openSongId; });
    var body = $("detailBody");
    if (!song) { $("detailDialog").close(); return; }
    var fav = !!state.favs[song.id];
    var L = CFG.links || {};

    // 動画エリア
    var media;
    if (song.videoId && detailUi.playing) {
      media = h("div", { class: "media" },
        h("iframe", {
          src: "https://www.youtube-nocookie.com/embed/" + song.videoId + "?autoplay=1&playsinline=1&rel=0",
          title: "動画", allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true
        }));
    } else if (song.videoId) {
      media = h("button", { class: "media media-thumb", type: "button", "aria-label": "動画を再生", onclick: function () { detailUi.playing = true; renderDetail(); } },
        h("img", { src: "https://i.ytimg.com/vi/" + song.videoId + "/hqdefault.jpg", alt: "" }),
        h("span", { class: "play", text: "▶" }));
    } else {
      media = h("div", { class: "media media-empty" },
        h("span", { text: "動画が未登録です" }));
    }

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
        h("button", { class: "btn btn-wide fav-btn" + (fav ? " is-on" : ""), type: "button", "aria-pressed": fav ? "true" : "false",
          onclick: function () { store.setFav(song.id, !fav).then(function () { toast(fav ? "お気に入りから外しました" : "お気に入りに追加しました"); }); } },
          fav ? "★ お気に入り(外す)" : "☆ お気に入りに追加")
      ),

      h("div", { class: "links" },
        h("a", { class: "link-btn link-full", href: linkUrl(L.lyricsGoogle, song), target: "_blank", rel: "noopener" }, "歌詞を探す")
      ),

      videoSection(song),

      h("section", { class: "detail-sec detail-foot" },
        h("div", { class: "foot-actions" },
          h("button", { class: "btn", type: "button", onclick: function () { openForm(song); } }, "曲の情報を編集"),
          detailUi.confirmDelete
            ? h("button", { class: "btn btn-danger", type: "button", onclick: function () {
                store.deleteSong(song.id).then(function () { $("detailDialog").close(); toast("曲を削除しました"); })
                  .catch(function () { toast("削除できませんでした"); });
              } }, "本当に削除する")
            : h("button", { class: "btn btn-ghost-danger", type: "button", onclick: function () { detailUi.confirmDelete = true; renderDetail(); } }, "曲を削除")
        )
      )
    );
  }

  function videoSection(song) {
    var sec = h("section", { class: "detail-sec" });
    var head = h("div", { class: "sec-head" },
      h("h3", { text: "動画" }),
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
      toast("動画を登録しました");
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
    $("dataInfo").textContent = "この端末に " + state.songs.length + "曲 が保存されています。";
    var last = lsGet("ohako.lastExport", null);
    $("backupInfo").textContent = last ? "最後にバックアップした日:" + shortDate(last, true) : "まだバックアップしていません。";
    $("ytInfo").textContent = CFG.youtubeApiKey
      ? "YouTubeの動画検索:使えます。検索回数の上限(1日約100回)は利用者全員の合計です。上限に達した日は、動画URLの貼り付けで登録してください。"
      : "YouTubeの動画検索:使えません。動画URLの貼り付けで登録できます。";
    $("importStatus").hidden = true;
    resetClear();
    pendingImport = null;
    $("importConfirm").hidden = true;
  }

  // ---- バックアップを書き出す ----
  $("exportBtn").addEventListener("click", function () {
    var json = JSON.stringify(store.exportData(), null, 1);
    var blob = new Blob([json], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ohako-backup-" + today() + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    lsSet("ohako.lastExport", today());
    fillSettings();
    toast("バックアップファイルを書き出しました");
  });

  // ---- バックアップを読み込む(今のデータと置き換え) ----
  var pendingImport = null;
  function importMsg(msg, isError) {
    var el = $("importStatus");
    el.textContent = msg;
    el.className = isError ? "form-error" : "hint";
    el.hidden = false;
  }
  $("importBtn").addEventListener("click", function () { $("importFile").click(); });
  $("importFile").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(reader.result); } catch (err) { importMsg("このファイルは読み込めませんでした。オハコ帳で書き出したファイルを選んでください。", true); return; }
      var d = obj && obj.app === "ohako" ? obj.data : obj;
      var n = d && d.songs ? Object.keys(d.songs).length : 0;
      if (!n) { importMsg("このファイルには曲のデータが入っていません。", true); return; }
      pendingImport = obj;
      $("importSummary").textContent = n + "曲 を読み込みます。今この端末にあるデータは消えて、ファイルの内容に置き換わります。";
      $("importConfirm").hidden = false;
      $("importStatus").hidden = true;
    };
    reader.onerror = function () { importMsg("ファイルを開けませんでした。", true); };
    reader.readAsText(file);
  });
  $("importOk").addEventListener("click", function () {
    if (!pendingImport) return;
    store.importData(pendingImport).then(function (r) {
      pendingImport = null;
      fillSettings();
      toast(r.songs + "曲を読み込みました");
    }).catch(function () { importMsg("読み込めませんでした。", true); });
  });
  $("importCancel").addEventListener("click", function () { pendingImport = null; $("importConfirm").hidden = true; });

  // ---- すべて消す(2回押し) ----
  var clearArmed = false, clearTimer = 0;
  function resetClear() {
    clearArmed = false;
    clearTimeout(clearTimer);
    $("clearLocalBtn").textContent = "この端末のデータをすべて消す";
  }
  $("clearLocalBtn").addEventListener("click", function () {
    if (!clearArmed) {
      clearArmed = true;
      $("clearLocalBtn").textContent = "もう一度押すと消えます(元に戻せません)";
      clearTimer = setTimeout(resetClear, 4000);
      return;
    }
    store.clearAll().then(function () { resetClear(); fillSettings(); toast("すべてのデータを消しました"); });
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
  if (["new", "title", "artist"].indexOf(state.sort) < 0) state.sort = "new";
  $("sortSelect").value = state.sort;
  $("sortSelect").addEventListener("change", function (e) { state.sort = e.target.value; lsSet("ohako.sort", state.sort); renderSongs(); });
  $("addSongBtn").addEventListener("click", function () { openForm(null); });

  // ------------------------------------------------------------
  // 起動
  // ------------------------------------------------------------
  store.start(function () {
    $("tabbar").hidden = false;
    store.onSongs(function (list) {
      state.songs = list;
      renderAll();
      if (!$("view-settings").hidden) fillSettings();
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
