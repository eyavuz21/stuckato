// Stuckato: backing tracks, the sound. Plays what backing.js arranges, records the player in the same clock, and renders the mix.
// Everything happens on this device: bundled samples (Salamander piano; cello, violin and guitar from tonejs-instruments, CC-BY 3.0),
// synthesised pad, drums and clicks. Needs window.Backing.
(function (root) {
  'use strict';
  const B = root.Backing;
  const SETS = { // sample name -> MIDI note; files in samples/<dir>/
    piano: { dir: 'piano', notes: { C2: 36, Fs2: 42, C3: 48, Fs3: 54, C4: 60, Fs4: 66, C5: 72 }, gain: 0.9, attack: 0.002, release: 0.35 },
    cello: { dir: 'strings', prefix: 'c', notes: { C2: 36, F2: 41, A2: 45, D3: 50, G3: 55, C4: 60 }, gain: 0.55, attack: 0.18, release: 0.5 },
    violin: { dir: 'strings', prefix: 'v', notes: { G3: 55, C4: 60, E4: 64, G4: 67, C5: 72 }, gain: 0.45, attack: 0.2, release: 0.55 },
    guitar: { dir: 'guitar', notes: { E2: 40, A2: 45, D3: 50, G3: 55, B3: 59, E4: 64 }, gain: 0.75, attack: 0.002, release: 0.25 }
  };
  const VER = 'v=11';
  const bufs = {}; // set -> [{m, buf}]
  let shared = null; // one realtime context, kept for decoding
  const AC = () => root.AudioContext || root.webkitAudioContext;
  function ctx() { if (!shared || shared.state === 'closed') shared = new (AC())(); return shared; }
  function session(type) { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) {} } // iOS 17+: ignore the silent switch, keep playback loud while recording

  const loaded = {}; // set -> [{m, buf}] once decoded
  function load(set) {
    if (bufs[set]) return bufs[set]; const s = SETS[set];
    bufs[set] = Promise.all(Object.entries(s.notes).map(async ([name, m]) => {
      const r = await fetch(`samples/${s.dir}/${s.prefix || ''}${name}.mp3?${VER}`); if (!r.ok) throw new Error('Could not load the ' + set + ' sounds.');
      const ab = await r.arrayBuffer(); const buf = await new Promise((res, rej) => ctx().decodeAudioData(ab, res, rej)); // callback form for older Safari
      return { m, buf };
    })).then(l => (loaded[set] = l)).catch(e => { delete bufs[set]; throw e; });
    return bufs[set];
  }
  async function decode(blob) { const ab = await blob.arrayBuffer(); return await ctx().decodeAudioData(ab); }

  // ---------------------------------------------------------------- voices
  const noise = c => { if (c._noise) return c._noise; const b = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return (c._noise = b); };
  function sampleNote(c, dest, n, set, filter) {
    const list = loaded[set]; if (!list) return; const s = SETS[set];
    let pick = list[0]; for (const x of list) if (Math.abs(x.m - n.m) < Math.abs(pick.m - n.m)) pick = x;
    const src = c.createBufferSource(); src.buffer = pick.buf; src.playbackRate.value = Math.pow(2, (n.m - pick.m) / 12);
    const g = c.createGain(); const v = n.v * s.gain; const t = n.when, end = t + n.d;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + s.attack); g.gain.setValueAtTime(v, Math.max(t + s.attack, end - 0.01)); g.gain.linearRampToValueAtTime(0, end + s.release);
    let out = g; if (filter) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1700; f.Q.value = 0.3; g.connect(f); out = f; }
    src.connect(g); out.connect(dest); src.start(t); src.stop(end + s.release + 0.05);
  }
  function padNote(c, dest, n) {
    const t = n.when, end = t + n.d; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.5;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(n.v * 0.5, t + 0.6); g.gain.setValueAtTime(n.v * 0.5, Math.max(t + 0.6, end - 0.01)); g.gain.linearRampToValueAtTime(0, end + 1);
    const hz = 440 * Math.pow(2, (n.m - 69) / 12);
    for (const det of [-7, 7]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = det; o.connect(f); o.start(t); o.stop(end + 1.1); }
    f.connect(g); g.connect(dest);
  }
  function drum(c, dest, d) {
    const t = d.when, g = c.createGain(); g.connect(dest);
    if (d.k === 'kick') { const o = c.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); g.gain.setValueAtTime(d.v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32); o.connect(g); o.start(t); o.stop(t + 0.35); return; }
    const src = c.createBufferSource(); src.buffer = noise(c); const f = c.createBiquadFilter();
    if (d.k === 'snare') { f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7; g.gain.setValueAtTime(d.v * 0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      const o = c.createOscillator(); o.frequency.value = 185; const og = c.createGain(); og.gain.setValueAtTime(d.v * 0.4, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1); o.connect(og); og.connect(dest); o.start(t); o.stop(t + 0.12); }
    else { f.type = 'highpass'; f.frequency.value = 7000; g.gain.setValueAtTime(d.v * 0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); }
    src.connect(f); f.connect(g); src.start(t, Math.random() * 0.5); src.stop(t + 0.25);
  }
  function click(c, dest, t, accent) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = accent ? 1900 : 1300; g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.06); }

  // ---------------------------------------------------------------- one graph for preview, play-along and the download
  // what: {take?: AudioBuffer, recipe, accomp?: AudioBuffer (already at the chosen speed)}; offset: take time + offset = backing time.
  function build(c, what, opts) {
    opts = opts || {}; const r = what.recipe || {}; const when = opts.when, from = opts.from || 0, until = opts.until == null ? Infinity : opts.until;
    const master = c.createDynamicsCompressor(); master.threshold.value = -10; master.ratio.value = 3; master.connect(opts.dest || c.destination);
    const back = c.createGain(); back.gain.value = r.volume == null ? 0.7 : r.volume; back.connect(master);
    if (what.take && !opts.noTake) { const s = c.createBufferSource(); s.buffer = what.take; const g = c.createGain(); g.gain.value = 1; s.connect(g); g.connect(master);
      const off = (r.offset || 0); const at = off - from; // backing time at which the take starts, relative to `from`
      if (at >= 0) s.start(when + at); else if (-at < what.take.duration) s.start(when, -at); }
    if (what.accomp) { const s = c.createBufferSource(); s.buffer = what.accomp; s.connect(back); if (from < what.accomp.duration) s.start(when, from); }
    if (r.chords && r.chords.length) {
      const a = B.arrange(r);
      for (const n of a.notes) { if (n.t < from - 4 || n.t > until) continue; const rel = n.t - from; const x = Object.assign({}, n, { when: when + Math.max(0, rel), d: rel < 0 ? n.d + rel : n.d }); if (x.d <= 0.02) continue;
        if (n.inst === 'pad') padNote(c, back, x); else if (n.inst === 'epiano') sampleNote(c, back, x, 'piano', true); else sampleNote(c, back, x, n.inst); }
      for (const d of a.drums) { if (d.t < from || d.t > until) continue; drum(c, back, Object.assign({}, d, { when: when + d.t - from })); }
    }
    return master;
  }
  async function ready(recipe) { const sets = recipe && recipe.style ? B.instruments(recipe.style) : []; for (const s of sets) await load(s); }
  function lengthOf(what) { // seconds of mix: the take (in backing time) plus a little ring, or the accompaniment
    const r = what.recipe || {}; let end = 0;
    if (what.take) end = Math.max(end, (r.offset || 0) + what.take.duration); if (what.accomp) end = Math.max(end, what.accomp.duration);
    if (!what.take && !what.accomp && r.chords && r.chords.length) end = r.chords[r.chords.length - 1].t + r.chords[r.chords.length - 1].d;
    return Math.max(1, end + 1.2);
  }

  // live preview: returns {stop, ended}
  async function preview(what) {
    session('playback'); const c = new (AC())(); const resumed = c.resume().catch(() => {}); await ready(what.recipe); await resumed; // made inside the tap, so iOS lets it play
    const when = c.currentTime + 0.12; build(c, what, { when }); const len = lengthOf(what);
    let done; const ended = new Promise(r => (done = r)); const tm = setTimeout(() => stop(), (len + 0.3) * 1000);
    function stop() { clearTimeout(tm); try { c.close(); } catch (e) {} done(); }
    return { stop, ended, length: len, started: () => Math.max(0, c.currentTime - when) };
  }
  // the download: rendered offline, mono 44.1 kHz WAV
  async function render(what) {
    await ready(what.recipe); const sr = 44100, len = lengthOf(what); const OC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    const c = new OC(1, Math.ceil(len * sr), sr); build(c, what, { when: 0 }); const out = await c.startRendering();
    return new Blob([B.wavEncode(out.getChannelData(0), sr)], { type: 'audio/wav' });
  }

  // ---------------------------------------------------------------- recording in the same clock as the backing
  async function mic() {
    session('play-and-record');
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  }
  function recorder(c, stream) { // raw samples with the context time of the first one; ScriptProcessor because Safari has it everywhere
    const src = c.createMediaStreamSource(stream); const sp = c.createScriptProcessor(4096, 1, 1); const chunks = []; let t0 = null;
    const mute = c.createGain(); mute.gain.value = 0; sp.onaudioprocess = e => { if (t0 === null) t0 = e.playbackTime - 4096 / c.sampleRate; chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    src.connect(sp); sp.connect(mute); mute.connect(c.destination);
    return { stop() { try { sp.disconnect(); src.disconnect(); } catch (e) {} let n = 0; chunks.forEach(x => (n += x.length)); const pcm = new Float32Array(n); let o = 0; chunks.forEach(x => { pcm.set(x, o); o += x.length; }); return { pcm, sr: c.sampleRate, t0: t0 == null ? 0 : t0 }; }, level() { const x = chunks[chunks.length - 1]; if (!x) return 0; let s = 0; for (let i = 0; i < x.length; i += 8) s += x[i] * x[i]; return Math.sqrt(s / (x.length / 8)); } };
  }
  function toBuffer(pcm, sr) { const b = ctx().createBuffer(1, Math.max(1, pcm.length), sr); b.getChannelData(0).set(pcm); return b; }
  function toWav(pcm, sr, target) { // stored takes: mono 16-bit at 24 kHz
    target = target || 24000; if (sr === target) return new Blob([B.wavEncode(pcm, sr)], { type: 'audio/wav' });
    const n = Math.floor(pcm.length * target / sr), out = new Float32Array(n), r = sr / target; for (let i = 0; i < n; i++) { const p = i * r, k = Math.floor(p), a = p - k; out[i] = (pcm[k] || 0) * (1 - a) + (pcm[k + 1] || 0) * a; }
    return new Blob([B.wavEncode(out, target)], { type: 'audio/wav' });
  }
  // the phone's own delay, sound out to sound back in: an estimate when it says nothing (iPhones often don't)
  function latency(c) { const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); const out = (c.outputLatency || 0) + (c.baseLatency || 0); return out > 0 ? out + 0.012 : (ios ? 0.1 : 0.05); }

  // record alone (the "add it after" take)
  async function recordAlone(o) {
    o = o || {}; const c = new (AC())(); const resumed = c.resume().catch(() => {}); let stream; try { stream = await mic(); } catch (e) { c.close(); throw e; } await resumed;
    const rec = recorder(c, stream); const cap = setTimeout(() => o.onCap && o.onCap(), (o.maxSec || 60) * 1000);
    return { level: () => rec.level(), stop() { clearTimeout(cap); const r = rec.stop(); stream.getTracks().forEach(t => t.stop()); try { c.close(); } catch (e) {} return r; } };
  }
  // play along: a bar of clicks, then the backing (or the accompaniment) and the recording together.
  // Returns {stop() -> {pcm, sr, offset}}; offset puts the take on the backing's clock (take time + offset = backing time).
  async function playAlong(what, o) {
    o = o || {}; session('play-and-record'); const c = new (AC())(); const resumed = c.resume().catch(() => {}); let stream; try { await ready(what.recipe); stream = await mic(); } catch (e) { c.close(); throw e; } await resumed;
    const rec = recorder(c, stream); const beat = what.recipe && what.recipe.tempo ? 60 / what.recipe.tempo : 0.75; const count = o.count || 4;
    const start = c.currentTime + 0.25 + count * beat; for (let k = 0; k < count; k++) click(c, c.destination, start - (count - k) * beat, k === 0);
    build(c, what, { when: start, noTake: true }); const len = what.accomp ? what.accomp.duration + 0.5 : (o.maxSec || 60);
    const cap = setTimeout(() => o.onCap && o.onCap(), (start - c.currentTime + len) * 1000);
    const lat = latency(c);
    return { level: () => rec.level(), countIn: count * beat + 0.25, stop() { clearTimeout(cap); const r = rec.stop(); stream.getTracks().forEach(t => t.stop()); try { c.close(); } catch (e) {} return { pcm: r.pcm, sr: r.sr, offset: r.t0 - start - lat, latency: lat }; } };
  }
  // measure the round trip once: four clicks out loud, heard back by the mic (headphones out)
  async function measure() {
    const c = new (AC())(); const resumed = c.resume().catch(() => {}); let stream; try { stream = await mic(); } catch (e) { c.close(); throw e; } await resumed;
    const rec = recorder(c, stream); const t = c.currentTime + 0.4; const sr = c.sampleRate; const ref = new Float32Array(Math.ceil(sr * 2.6));
    [0, 0.5, 1, 1.5].forEach(k => { click(c, c.destination, t + k, true); for (let i = 0; i < sr * 0.03; i++) ref[Math.round((0.4 + k) * sr) + i] = Math.sin(i) * (1 - i / (sr * 0.03)); });
    await new Promise(r => setTimeout(r, 2600)); const r = rec.stop(); stream.getTracks().forEach(x => x.stop()); try { c.close(); } catch (e) {}
    const shift = Math.round((t - 0.4 - r.t0) * r.sr); const aligned = new Float32Array(ref.length); for (let i = 0; i < ref.length; i++) aligned[i] = r.pcm[i + shift] || 0;
    return B.lineUp(ref, aligned, r.sr, 0.5);
  }
  async function stretched(buf, rate) { if (!rate || rate === 1) return buf; const x = buf.getChannelData(0); const y = B.stretch(x, buf.sampleRate, rate); const out = ctx().createBuffer(1, y.length, buf.sampleRate); out.getChannelData(0).set(y); return out; }
  async function mono(buf) { if (buf.numberOfChannels === 1) return buf; const n = buf.length, m = ctx().createBuffer(1, n, buf.sampleRate), d = m.getChannelData(0); for (let ch = 0; ch < buf.numberOfChannels; ch++) { const s = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] += s[i] / buf.numberOfChannels; } return m; }

  root.BackingAudio = { load, loadStyle: async s => { await ready({ style: s }); }, decode, preview, render, recordAlone, playAlong, measure, toBuffer, toWav, stretched, mono, latency };
})(typeof self !== 'undefined' ? self : globalThis);
