// Unit tests for backing.js: the key, the chords, the arrangement, lining up, time-stretch and the download file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../passage.js';
import '../backing.js';
const P = globalThis.Passage, B = globalThis.Backing;

const SR = 16000;
const mk = (midis, d = 0.5) => midis.map((m, k) => ({ m, t: k * d, d: d * 0.9, cents: 0 }));
const TWINKLE_D = [62, 62, 69, 69, 71, 71, 69, 67, 67, 66, 66, 64, 64, 62];
const heard = (midis, d = 0.4) => P.notesFrom(P.pitchTrack(P.synthNotes(midis.map(m => ({ m, d })), SR), SR));

test('key: Twinkle in D major', () => {
  const k = B.detectKey(mk(TWINKLE_D));
  assert.equal(B.keyName(k), 'D major');
  assert.ok(k.confidence >= 0.6, 'confident, got ' + k.confidence);
});

test('key: a C major scale up and down', () => {
  const k = B.detectKey(mk([60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]));
  assert.equal(B.keyName(k), 'C major');
});

test('key: an A minor tune with the raised seventh', () => {
  const k = B.detectKey(mk([69, 71, 72, 74, 76, 74, 72, 71, 69, 68, 69, 76, 72, 69]));
  assert.equal(B.keyName(k), 'A minor');
});

test('key: from notes the pitch tracker actually heard (G major arpeggio and scale)', () => {
  const k = B.detectKey(heard([67, 71, 74, 79, 78, 76, 74, 72, 71, 69, 67]));
  assert.equal(B.keyName(k), 'G major');
});

test('key: three notes is not enough to be sure', () => {
  const k = B.detectKey(mk([60, 62, 64]));
  assert.ok(k.confidence < 0.6, 'low confidence, got ' + k.confidence);
});

test('follow chords: Twinkle in D starts and ends on D, with A (or A7) before the end', () => {
  const ch = B.followChords(mk(TWINKLE_D), { tonic: 2, mode: 'major' });
  assert.ok(ch.length >= 3, 'several chords, got ' + ch.length);
  assert.equal(B.chordName(ch[0]), 'D');
  assert.equal(B.chordName(ch[ch.length - 1]), 'D');
  assert.ok(['A', 'A7'].includes(B.chordName(ch[ch.length - 2])), 'dominant before the end, got ' + B.chordName(ch[ch.length - 2]));
  for (let i = 1; i < ch.length; i++) assert.ok(Math.abs(ch[i - 1].t + ch[i - 1].d - ch[i].t) < 1e-6, 'spans touch');
  ch.forEach(c => assert.ok(c.d > 0));
});

test('follow chords: every chord comes from the key', () => {
  const key = { tonic: 9, mode: 'minor' }; const allowed = new Set(B.diatonic(key).map(B.chordName));
  const ch = B.followChords(mk([69, 71, 72, 74, 76, 74, 72, 71, 69, 68, 69, 76, 72, 69], 0.6), key);
  ch.forEach(c => assert.ok(allowed.has(B.chordName(c)), B.chordName(c) + ' is in A minor'));
});

test('follow chords: a rubato player (speeding up, a long pause) still gets chords where the notes are', () => {
  const ts = [0, 0.7, 1.3, 1.8, 2.2, 2.55, 2.85, 5.5, 5.9, 6.3, 6.8, 7.4];
  const notes = [62, 64, 66, 67, 69, 71, 73, 74, 73, 71, 69, 62].map((m, k) => ({ m, t: ts[k], d: 0.3 }));
  const ch = B.followChords(notes, { tonic: 2, mode: 'major' });
  assert.ok(ch.some(c => Math.abs(c.t - 5.5) < 0.01), 'a chord starts with the phrase after the pause');
  const last = ch[ch.length - 1]; assert.ok(last.t + last.d > 7.7, 'the last chord rings past the last note');
});

test('loop chords: four bars of a ballad in G at 80 bpm, one chord per bar', () => {
  const ch = B.loopChords({ tonic: 7, mode: 'major' }, 'ballad', 80, 12);
  assert.equal(ch.length, 4);
  assert.deepEqual(ch.map(B.chordName), ['G', 'D', 'Em', 'C']);
  assert.equal(ch[1].t, 3); assert.equal(ch[1].d, 3);
});

test('loop chords: covers sixty seconds and loops the progression', () => {
  const ch = B.loopChords({ tonic: 0, mode: 'minor' }, 'lofi', 90, 60);
  const end = ch[ch.length - 1].t + ch[ch.length - 1].d; assert.ok(end >= 60);
  assert.equal(B.chordName(ch[0]), B.chordName(ch[4]));
});

test('transpose moves roots and keeps qualities', () => {
  const ch = B.transpose([{ t: 0, d: 1, r: 11, q: 'min' }], 2); assert.equal(B.chordName(ch[0]), 'C#m');
});

test('voicing: close position, in range, and moves little between chords', () => {
  const C = B.voice({ r: 0, q: 'maj' }); assert.ok(C.every(m => m >= 55 && m <= 76));
  assert.deepEqual(C.map(m => m % 12).sort(), [0, 4, 7]);
  const F = B.voice({ r: 5, q: 'maj' }, C); const moved = F.reduce((a, m, i) => a + Math.abs(m - C[i]), 0);
  assert.ok(moved <= 4, 'C to F moves by at most four semitones in total, got ' + moved);
  assert.equal(B.bassOf(7), 43); // G2
});

test('arrange: every style makes notes inside the chords, and lo-fi has drums', () => {
  const key = { tonic: 2, mode: 'major' };
  const after = B.followChords(mk(TWINKLE_D), key);
  for (const style of B.STYLES.after) {
    const a = B.arrange({ mode: 'after', style, key, chords: after }); assert.ok(a.notes.length > 4, style);
    a.notes.forEach(n => { const c = after.find(c => n.t >= c.t - 1e-6 && n.t < c.t + c.d); assert.ok(c, style + ' note at ' + n.t + ' sits under a chord'); assert.ok(B.chordPcs(c).includes(n.m % 12), style + ' note is a chord tone'); });
    assert.equal(a.drums.length, 0, 'no drums when added after');
  }
  const loop = B.loopChords(key, 'lofi', 80, 12);
  for (const style of B.STYLES.along) { const a = B.arrange({ mode: 'along', style, key, chords: B.loopChords(key, style, 80, 12), tempo: 80 }); assert.ok(a.notes.length > 8, style); }
  const lf = B.arrange({ mode: 'along', style: 'lofi', key, chords: loop, tempo: 80 });
  assert.ok(lf.drums.some(d => d.k === 'kick') && lf.drums.some(d => d.k === 'snare') && lf.drums.some(d => d.k === 'hat'));
});

test('lineUp finds a known delay', () => {
  const sr = 8000, ref = new Float32Array(sr), rec = new Float32Array(sr);
  for (const at of [0.1, 0.35, 0.6]) for (let i = 0; i < 160; i++) ref[Math.round(at * sr) + i] = Math.sin(i) * (1 - i / 160);
  const delay = 0.137; for (let i = 0; i < sr - Math.round(delay * sr); i++) rec[i + Math.round(delay * sr)] = 0.4 * ref[i] + 0.01 * Math.sin(i * 0.37);
  const got = B.lineUp(ref, rec, sr, 0.5); assert.ok(Math.abs(got - delay) <= 0.002, 'got ' + got);
});

test('stretch: 75 percent speed is a third longer at the same pitch', () => {
  const sr = 16000, f = 440, x = new Float32Array(sr); for (let i = 0; i < sr; i++) x[i] = Math.sin(2 * Math.PI * f * i / sr);
  const y = B.stretch(x, sr, 0.75); assert.equal(y.length, Math.round(sr / 0.75));
  const zc = a => { let n = 0; for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) n++; return n; };
  const mid = y.subarray(2000, y.length - 2000); const fy = zc(mid) / (mid.length / sr);
  assert.ok(Math.abs(fy - f) / f < 0.02, 'pitch kept, got ' + fy.toFixed(1) + ' Hz');
  assert.equal(B.stretch(x, sr, 1), x);
});

test('wav: a valid mono 16-bit header and length', () => {
  const buf = B.wavEncode(new Float32Array([0, 0.5, -0.5, 1, -1]), 44100); const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(str(0, 4), 'RIFF'); assert.equal(str(8, 4), 'WAVE'); assert.equal(str(36, 4), 'data');
  assert.equal(v.getUint16(22, true), 1); assert.equal(v.getUint32(24, true), 44100); assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 10); assert.equal(buf.byteLength, 54);
  assert.equal(v.getInt16(44 + 6, true), 32767); assert.equal(v.getInt16(44 + 8, true), -32768);
});
