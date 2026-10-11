// ============================================================
//  オハコ帳 設定ファイル
//  README.md の手順に沿って、下の値を書き換えてください。
// ============================================================

window.OHAKO_CONFIG = {
  // ---- Firebase(友達とデータを共有するのに必要)----
  // 空のままだと「お試しモード」で動きます(データはこの端末だけに保存)。
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  },

  // ---- YouTube Data API キー(アプリ内の動画検索に必要)----
  // 空のままでも、動画URLを貼り付ければサムネ表示と再生はできます。
  youtubeApiKey: "",

  // ---- 外部サイトの検索リンク ----
  // {q} の部分に「曲名 歌手名」が入ります。サイト側の仕様が変わって
  // 開けなくなったら、ここを書き換えれば直せます。
  links: {
    dam: "https://www.clubdam.com/search/?keyword={q}&type=keyword",
    joysound: "https://www.joysound.com/web/search/cross?match=1&keyword={q}",
    utanet: "https://www.uta-net.com/search/?Aselect=2&Bselect=3&Keyword={title}",
    lyricsGoogle: "https://www.google.com/search?q={q}+%E6%AD%8C%E8%A9%9E",
    youtube: "https://www.youtube.com/results?search_query={q}"
  }
};
