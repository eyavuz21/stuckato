// Stuckato: backing tracks. Pure music functions, no DOM, no Web Audio.
// The key comes from the notes passage.js hears; chords either follow the player (added after) or loop at a tempo (play along);
// arrange() turns chords into the notes and drum hits that backing-audio.js plays. Stuckato makes the music; nothing judges it.
// Loaded as a plain script in the page (window.Backing) and imported under Node (globalThis.Backing) for the unit tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Backing = factory();
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const pc = m => ((Math.round(m) % 12) + 12) % 12;
  const keyName = k => NAMES[k.tonic] + (k.mode === 'minor' ? ' minor' : ' major');
  const SHAPES = { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };
  const SUFFIX = { maj: '', min: 'm', dim: 'dim', '7': '7', maj7: 'maj7', m7: 'm7' };
  const chordName = c => NAMES[c.r] + SUFFIX[c.q];
  const chordPcs = c => SHAPES[c.q].map(x => (c.r + x) % 12);

  // ---------------------------------------------------------------- the key
  // Krumhansl-Kessler profiles, correlated against a duration-weighted pitch-class histogram; the last note leans towards its tonic.
  const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function corr(a, b) {
    const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }
  function detectKey(notes) {
    notes = (notes || []).filter(n => n && n.m > 0);
    const hist = new Array(12).fill(0); for (const n of notes) hist[pc(n.m)] += Math.max(0.05, Math.min(2, n.d || 0.3));
    const scores = [];
    for (let t = 0; t < 12; t++) for (const mode of ['major', 'minor']) {
      const prof = mode === 'major' ? KK_MAJ : KK_MIN; const rot = new Array(12); for (let i = 0; i < 12; i++) rot[i] = prof[(i - t + 12) % 12];
      let s = corr(hist, rot); const last = notes[notes.length - 1]; if (last && pc(last.m) === t) s += 0.06;
      scores.push({ tonic: t, mode, s });
    }
    scores.sort((a, b) => b.s - a.s); const best = scores[0], second = scores[1];
    const distinct = hist.filter(x => x > 0).length;
    // confidence: how clearly the best key beats the next, scaled down for short or narrow snippets
    let confidence = Math.max(0, Math.min(1, best.s * 0.6 + (best.s - second.s) * 4));
    if (notes.length < 8) confidence *= notes.length / 8; if (distinct < 4) confidence *= 0.5;
    return { tonic: best.tonic, mode: best.mode, confidence: Math.round(confidence * 100) / 100, name: keyName(best) };
  }

  // ---------------------------------------------------------------- chords that follow the player
  function diatonic(key) { // [{r,q,deg}] the chords a backing is allowed to use in this key
    const t = key.tonic, at = x => (t + x) % 12;
    return key.mode === 'minor'
      ? [{ r: at(0), q: 'min', deg: 1 }, { r: at(5), q: 'min', deg: 4 }, { r: at(7), q: 'maj', deg: 5 }, { r: at(7), q: '7', deg: 5 }, { r: at(8), q: 'maj', deg: 6 }, { r: at(3), q: 'maj', deg: 3 }, { r: at(10), q: 'maj', deg: 7 }]
      : [{ r: at(0), q: 'maj', deg: 1 }, { r: at(2), q: 'min', deg: 2 }, { r: at(4), q: 'min', deg: 3 }, { r: at(5), q: 'maj', deg: 4 }, { r: at(7), q: 'maj', deg: 5 }, { r: at(7), q: '7', deg: 5 }, { r: at(9), q: 'min', deg: 6 }];
  }
  const PRIOR = { 1: 0.15, 5: 0.1, 4: 0.08, 6: 0.05, 2: 0.02, 3: 0, 7: 0 };
  function scalePcs(key) { const s = key.mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11]; return s.map(x => (key.tonic + x) % 12); }
  function fit(win, c, scale) { // how well chord c sits under the notes of one window, -1 to about 1.2
    const cp = chordPcs(c); let s = 0, tot = 0;
    win.forEach((n, k) => {
      const w = Math.max(0.05, n.d) * (k === 0 ? 1.5 : 1) * (n.d >= 0.6 ? 1.3 : 1); tot += w; const p = pc(n.m);
      if (cp.includes(p)) s += w * (p === c.r ? 1.05 : 1); else if (scale.includes(p)) s -= 0.3 * w; else s -= 0.6 * w;
    });
    return tot ? s / tot : 0;
  }
  function move(a, b) { // the pull from one chord to the next: falling fifths are strongest (a dominant home most of all), staying put is a little dull
    if (a.r === b.r) return a.q === b.q ? -0.05 : 0.02; const iv = (b.r - a.r + 12) % 12;
    if (iv === 5) return a.deg === 5 && b.deg === 1 ? 0.3 : 0.1; if (iv === 7) return 0.06; if (iv === 2 || iv === 10) return 0.03; return 0;
  }
  // Where the chords change and which chords they are, chosen together (a semi-Markov Viterbi over note onsets):
  // a chord earns its fit times how long it lasts, every change costs a little, falling fifths are rewarded,
  // the tune leans to start and end on the tonic, and a chord never straddles a real pause (so it waits for the player).
  function followChords(notes, key) {
    notes = (notes || []).filter(n => n && n.m > 0).slice().sort((a, b) => a.t - b.t); const n = notes.length; if (!n) return [];
    const C = diatonic(key), scale = scalePcs(key), K = C.length; const last = notes[n - 1], end = last.t + last.d + 0.8;
    const brk = new Array(n).fill(false); for (let i = 1; i < n; i++) if (notes[i].t - (notes[i - 1].t + notes[i - 1].d) > 0.6) brk[i] = true;
    const at = i => (i < n ? notes[i].t : last.t + last.d);
    const best = Array.from({ length: n + 1 }, () => new Array(K).fill(-Infinity)), from = Array.from({ length: n + 1 }, () => new Array(K).fill(null));
    for (let j = 1; j <= n; j++) {
      for (let i = j - 1; i >= 0; i--) {
        // a span may start at a pause but never run across one
        let crosses = false; for (let k = i + 1; k < j; k++) if (brk[k]) { crosses = true; break; } if (crosses) break;
        const dur = at(j) - at(i); if (dur > 4.2 && j - i > 1) break;
        const win = notes.slice(i, j);
        for (let c = 0; c < K; c++) {
          const ch = C[c]; let s = Math.min(dur, 4) * (fit(win, ch, scale) + PRIOR[ch.deg]) - 0.35;
          if (dur < 0.8 && !(i === 0 || brk[i]) && j < n) s -= 0.3;
          if (i === 0 && ch.deg === 1) s += 0.3; if (j === n && ch.deg === 1) s += 0.6;
          if (i === 0) { if (s > best[j][c]) { best[j][c] = s; from[j][c] = [0, -1]; } continue; }
          for (let p = 0; p < K; p++) { if (best[i][p] === -Infinity) continue; const v = best[i][p] + s + move(C[p], ch); if (v > best[j][c]) { best[j][c] = v; from[j][c] = [i, p]; } }
        }
      }
    }
    let c = 0; for (let k = 1; k < K; k++) if (best[n][k] > best[n][c]) c = k;
    const segs = []; let j = n; while (j > 0 && from[j][c]) { const [i, p] = from[j][c]; segs.unshift({ i, j, c }); j = i; c = p; }
    const out = segs.map((s, k) => { const t = k === 0 ? Math.max(0, notes[s.i].t - 0.05) : notes[s.i].t; const te = k + 1 < segs.length ? notes[segs[k + 1].i].t : end; const ch = C[s.c]; return { t: r3(t), d: r3(te - t), r: ch.r, q: ch.q }; });
    // two neighbours on the same chord become one
    return out.reduce((a, x) => { const p = a[a.length - 1]; if (p && p.r === x.r && p.q === x.q) p.d = r3(x.t + x.d - p.t); else a.push(x); return a; }, []);
  }
  const r3 = x => Math.round(x * 1000) / 1000;

  // ---------------------------------------------------------------- chords that loop at a tempo
  const LOOPS = { // degrees from the tonic, with qualities; one chord per bar
    major: { ballad: [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']], strings: [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'maj']], acoustic: [[0, 'maj'], [5, 'maj'], [9, 'min'], [7, 'maj']], lofi: [[2, 'm7'], [7, '7'], [0, 'maj7'], [9, 'm7']] },
    minor: { ballad: [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']], strings: [[0, 'min'], [5, 'min'], [8, 'maj'], [7, 'maj']], acoustic: [[0, 'min'], [10, 'maj'], [8, 'maj'], [7, 'maj']], lofi: [[0, 'm7'], [5, 'm7'], [0, 'm7'], [7, '7']] }
  };
  function loopChords(key, style, tempo, seconds) {
    const prog = (LOOPS[key.mode === 'minor' ? 'minor' : 'major'][style]) || LOOPS.major.ballad; const bar = 240 / tempo;
    const bars = Math.max(1, Math.ceil((seconds || 60) / bar)); const out = [];
    for (let b = 0; b < bars; b++) { const [deg, q] = prog[b % prog.length]; out.push({ t: r3(b * bar), d: r3(bar), r: (key.tonic + deg) % 12, q, bar: b }); }
    return out;
  }
  function transpose(chords, semis) { return chords.map(c => Object.assign({}, c, { r: ((c.r + semis) % 12 + 12) % 12 })); }

  // ---------------------------------------------------------------- voicing
  // Upper notes in close position between G3 and E5, moving as little as possible from the last chord.
  function voice(c, prev, lo, hi) {
    lo = lo || 55; hi = hi || 76; const pcs = chordPcs(c); const cands = [];
    for (let rot = 0; rot < pcs.length; rot++) {
      const order = pcs.slice(rot).concat(pcs.slice(0, rot)); let m = lo; while (pc(m) !== order[0]) m++;
      for (let base = m; base < lo + 12; base += 12) { const v = [base]; for (let i = 1; i < order.length; i++) { let n = v[i - 1] + 1; while (pc(n) !== order[i]) n++; v.push(n); } if (v[v.length - 1] <= hi) cands.push(v); }
    }
    let best = cands[0], bv = Infinity;
    for (const v of cands) { let cost; if (prev && prev.length) { cost = 0; for (let i = 0; i < v.length; i++) cost += Math.abs(v[i] - prev[Math.min(i, prev.length - 1)]); } else cost = Math.abs(v.reduce((a, x) => a + x, 0) / v.length - 64); if (cost < bv) { bv = cost; best = v; } }
    return best;
  }
  const bassOf = (r, lo) => { lo = lo || 36; return lo + ((r - pc(lo)) % 12 + 12) % 12; };

  // ---------------------------------------------------------------- arrangement
  // A recipe: {mode:'after'|'along', style, key, chords:[{t,d,r,q}], tempo?}. Out: notes [{t,m,d,v,inst}], drums [{t,k,v}], end.
  const STYLES = { after: ['piano', 'strings', 'guitar', 'pad'], along: ['ballad', 'strings', 'acoustic', 'lofi'] };
  const STYLE_LABEL = { piano: 'Piano', strings: 'Strings', guitar: 'Guitar', pad: 'Warm pad', ballad: 'Piano ballad', acoustic: 'Acoustic', lofi: 'Lo-fi beat' };
  function arrange(recipe) {
    const notes = [], drums = []; const ch = recipe.chords || []; let prev = null;
    const N = (t, m, d, v, inst) => notes.push({ t: r3(t), m, d: r3(Math.max(0.05, d)), v, inst });
    const up = m => (m >= 55 ? 'violin' : 'cello');
    const style = recipe.style;
    if (recipe.mode === 'along') {
      const beat = 60 / (recipe.tempo || 80);
      for (const c of ch) {
        const v = voice(c, prev); prev = v; const t = c.t, bar = c.d, b = bassOf(c.r);
        if (style === 'strings') { N(t, b, bar + 0.2, 0.45, 'cello'); v.forEach(m => N(t, m, bar + 0.2, 0.3, up(m))); }
        else if (style === 'acoustic') {
          const gb = bassOf(c.r, 40); const strums = [[0, 'D', 0.6], [1, 'D', 0.45], [1.5, 'U', 0.3], [2.5, 'U', 0.3], [3, 'D', 0.45], [3.5, 'U', 0.3]];
          strums.forEach(([at, dir, vel], k) => { const st = t + at * beat; const nx = k + 1 < strums.length ? strums[k + 1][0] * beat : bar; const len = nx - at * beat + 0.15;
            const set = dir === 'D' ? [gb].concat(v) : v.slice(-3).reverse(); set.forEach((m, i) => N(st + i * 0.022, m, len, vel * (dir === 'D' && i === 0 ? 1 : 0.85), 'guitar')); });
        } else if (style === 'lofi') {
          N(t, b, 2.4 * beat, 0.45, 'epiano'); N(t + 2.5 * beat, b, 1.4 * beat, 0.35, 'epiano');
          v.forEach((m, i) => { N(t + i * 0.01, m, 1.4 * beat, 0.38, 'epiano'); N(t + 1.5 * beat + i * 0.01, m, 2.3 * beat, 0.28, 'epiano'); });
          for (let e = 0; e < 8; e++) { const sw = e % 2 ? 0.12 * beat : 0; drums.push({ t: r3(t + e * 0.5 * beat + sw), k: 'hat', v: e % 2 ? 0.22 : 0.32 }); }
          drums.push({ t: r3(t), k: 'kick', v: 0.9 }, { t: r3(t + 2.5 * beat), k: 'kick', v: 0.75 }, { t: r3(t + beat), k: 'snare', v: 0.6 }, { t: r3(t + 3 * beat), k: 'snare', v: 0.6 });
        } else { // ballad
          N(t, b, 2 * beat, 0.55, 'piano'); N(t + 2 * beat, b, 2 * beat, 0.4, 'piano');
          v.forEach((m, i) => N(t + i * 0.012, m, bar, 0.4, 'piano'));
          for (let k = 1; k < 4; k++) N(t + k * beat, v[(k - 1) % v.length] + 12, beat * 1.1, 0.26, 'piano');
        }
      }
    } else {
      for (const c of ch) {
        const v = voice(c, prev); prev = v; const t = c.t, d = c.d, b = bassOf(c.r);
        if (style === 'strings') { for (let s = 0; s < d - 0.05; s += 3.2) { const len = Math.min(3.2, d - s) + 0.4; N(t + s, b, len, s ? 0.36 : 0.45, 'cello'); v.forEach(m => N(t + s, m, len, s ? 0.25 : 0.3, up(m))); } }
        else if (style === 'guitar') { const gb = bassOf(c.r, 40); for (let s = 0, k = 0; s < d - 0.6 || k === 0; s += 1.6, k++) { const set = k % 2 ? v.slice(-3).reverse() : [gb].concat(v); const len = Math.min(1.6, d - s) + 0.3; set.forEach((m, i) => N(t + s + i * 0.03, m, len, k ? 0.33 : 0.5, 'guitar')); } }
        else if (style === 'pad') { N(t, b + 12, d + 0.6, 0.22, 'pad'); v.forEach(m => N(t, m, d + 0.6, 0.18, 'pad')); }
        else { // piano
          N(t, b, Math.min(d, 3.5), 0.55, 'piano'); v.forEach((m, i) => N(t + i * 0.012, m, Math.min(d, 3.5), 0.42, 'piano'));
          for (let s = 2; s < d - 1.2; s += 2) v.forEach((m, i) => N(t + s + i * 0.012, m, Math.min(2.2, d - s), 0.3, 'piano'));
        }
      }
    }
    const end = ch.length ? ch[ch.length - 1].t + ch[ch.length - 1].d : 0;
    return { notes, drums, end: r3(end) };
  }
  function instruments(style) { return { piano: ['piano'], strings: ['cello', 'violin'], guitar: ['guitar'], pad: [], ballad: ['piano'], acoustic: ['guitar'], lofi: ['piano'] }[style] || []; }

  // ---------------------------------------------------------------- lining up and time
  // Delay of rec behind ref (seconds), by cross-correlating loudness envelopes at 1 kHz. Used to measure the phone's round trip.
  function envelope(x, sr) { const hop = Math.max(1, Math.round(sr / 1000)); const n = Math.floor(x.length / hop); const e = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < hop; j++) s += Math.abs(x[i * hop + j]); e[i] = s / hop; } return e; }
  function lineUp(ref, rec, sr, maxSec) {
    const a = envelope(ref, sr), b = envelope(rec, sr); const maxLag = Math.min(b.length - 1, Math.round((maxSec || 0.6) * 1000));
    let best = 0, bv = -Infinity; for (let lag = 0; lag <= maxLag; lag++) { let s = 0; const n = Math.min(a.length, b.length - lag); for (let i = 0; i < n; i++) s += a[i] * b[i + lag]; if (s > bv) { bv = s; best = lag; } }
    return best / 1000;
  }
  // WSOLA time-stretch: slower or faster at the same pitch (the accompaniment at 75 or 90 percent). rate < 1 is slower.
  function stretch(x, sr, rate) {
    if (!rate || Math.abs(rate - 1) < 1e-3) return x;
    const N = Math.round(sr * 0.046) & ~1, Hs = N >> 1, tol = Math.round(sr * 0.012); const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const outLen = Math.round(x.length / rate); const y = new Float32Array(outLen + N), norm = new Float32Array(outLen + N);
    let prev = 0; const c = (p, q, step) => { let s = 0; for (let i = 0; i < Hs; i += step) s += x[p + i] * x[q + i]; return s; };
    for (let k = 0; ; k++) {
      const out = k * Hs; const nominal = Math.round(out * rate); if (nominal + N + tol >= x.length || out + N > y.length) break;
      let best = nominal;
      if (k > 0) { const nat = prev + Hs; let bv = -Infinity;
        for (let d = -tol; d <= tol; d += 4) { const p = nominal + d; if (p < 0) continue; const v = c(p, nat, 4); if (v > bv) { bv = v; best = p; } }
        const coarse = best; for (let d = -3; d <= 3; d++) { const p = coarse + d; if (p < 0 || p + N >= x.length) continue; const v = c(p, nat, 1); if (v > bv) { bv = v; best = p; } } }
      for (let i = 0; i < N; i++) { y[out + i] += x[best + i] * win[i]; norm[out + i] += win[i]; }
      prev = best;
    }
    const o = new Float32Array(outLen); for (let i = 0; i < outLen; i++) o[i] = norm[i] > 1e-3 ? y[i] / norm[i] : 0;
    return o;
  }

  // ---------------------------------------------------------------- the download
  function wavEncode(samples, sr) { // mono 16-bit PCM
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf); const S = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    S(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); S(8, 'WAVE'); S(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); S(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return buf;
  }

  return { NAMES, keyName, chordName, chordPcs, detectKey, diatonic, followChords, loopChords, transpose, voice, bassOf, arrange, instruments, STYLES, STYLE_LABEL, envelope, lineUp, stretch, wavEncode };
});
