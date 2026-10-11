// 音名の変換と音程検出(画面に依存しない部分)
(function (root) {
  "use strict";

  var NAMES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
  // カラオケ表記はAの音から次の段に上がる(hiA = A4 = 440Hz)
  var BLOCKS = ["lowlow", "low", "mid1", "mid2", "hi", "hihi", "hihihi"];
  var SCI = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  // 選択肢に出す範囲:lowA(A1) 〜 hihiG#(G#5)
  var SELECT_MIN = 33;
  var SELECT_MAX = 92;

  function noteName(midi) {
    if (midi == null || isNaN(midi)) return "—";
    var i = Math.round(midi) - 21; // 21 = A0 = lowlowA
    if (i < 0) return "—";
    var b = Math.floor(i / 12);
    if (b >= BLOCKS.length) return "—";
    return BLOCKS[b] + NAMES[i % 12];
  }

  function sciName(midi) {
    if (midi == null || isNaN(midi)) return "";
    var m = Math.round(midi);
    return SCI[m % 12] + (Math.floor(m / 12) - 1);
  }

  function freqToMidi(f) {
    return 69 + 12 * Math.log2(f / 440);
  }

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  // 自己相関による基本周波数の推定。声が無ければ -1 を返す。
  function detectPitch(buf, sampleRate) {
    var size = buf.length;
    var rms = 0;
    for (var i = 0; i < size; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / size);
    if (rms < 0.012) return -1;

    // 前後の無音部分を切り落とす
    var thres = 0.2, r1 = 0, r2 = size - 1;
    for (i = 0; i < size / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
    for (i = 1; i < size / 2; i++) { if (Math.abs(buf[size - i]) < thres) { r2 = size - i; break; } }
    var b = buf.slice(r1, r2);
    var n = b.length;
    if (n < 64) return -1;

    var c = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var s = 0;
      for (var j = 0; j < n - i; j++) s += b[j] * b[j + i];
      c[i] = s;
    }
    var d = 0;
    while (d < n - 1 && c[d] > c[d + 1]) d++;
    // 人の声の範囲(約60〜1400Hz)だけ見る
    var minLag = Math.max(d, Math.floor(sampleRate / 1400));
    var maxLag = Math.min(n - 1, Math.ceil(sampleRate / 60));
    var maxval = -1, maxpos = -1;
    for (i = minLag; i < maxLag; i++) {
      if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    }
    if (maxpos <= 0 || maxval < c[0] * 0.5) return -1; // 周期性が弱い=雑音
    var T0 = maxpos;
    if (T0 > 0 && T0 < n - 1) {
      var x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
      var a = (x1 + x3 - 2 * x2) / 2;
      var bb = (x3 - x1) / 2;
      if (a) T0 = T0 - bb / (2 * a);
    }
    return sampleRate / T0;
  }

  // 何点満点の数字でも見やすく
  function formatScore(s) {
    if (s == null || isNaN(s)) return "—";
    var v = Number(s);
    return (Math.round(v * 1000) / 1000).toString();
  }

  // 検索用の正規化(全角半角・カタカナひらがな・大文字小文字を同一視)
  function normalize(str) {
    return String(str || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0x60); })
      .replace(/\s+/g, " ")
      .trim();
  }

  // YouTubeのURLから動画IDを取り出す
  function parseVideoId(input) {
    if (!input) return null;
    var s = String(input).trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    var m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  // おすすめキー:曲の最高音が自分の最高音を超える分だけ下げる
  function suggestKey(songMax, songMin, myMax, myMin) {
    if (songMax == null || myMax == null) return null;
    var down = songMax - myMax; // 正なら超えている
    if (down <= 0) {
      if (songMin != null && myMin != null && songMin < myMin) {
        var up = myMin - songMin;
        if (up <= -down) return { key: up, ok: true };
        return { key: null, ok: false, reason: "range" };
      }
      return { key: 0, ok: true };
    }
    if (down > 7) return { key: null, ok: false, reason: "high" };
    if (songMin != null && myMin != null && songMin - down < myMin) {
      return { key: null, ok: false, reason: "range" };
    }
    return { key: -down, ok: true };
  }

  var api = {
    noteName: noteName, sciName: sciName, freqToMidi: freqToMidi, midiToFreq: midiToFreq,
    detectPitch: detectPitch, formatScore: formatScore, normalize: normalize,
    parseVideoId: parseVideoId, suggestKey: suggestKey,
    SELECT_MIN: SELECT_MIN, SELECT_MAX: SELECT_MAX
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.OhakoNotes = api;
})(typeof window !== "undefined" ? window : globalThis);
