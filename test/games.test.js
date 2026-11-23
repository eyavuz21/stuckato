// Unit tests for games.js: the mystery tune, the guess, echo marking (including on notes the pitch tracker really heard), scoring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../passage.js';
import '../games.js';
const P = globalThis.Passage, G = globalThis.Games;
const SR = 16000;
const heard = (midis, d = 0.45, gap = 0.15) => P.notesFrom(P.pitchTrack(P.synthNotes(midis.flatMap(m => [{ m, d }, { m: 0, d: gap }]), SR), SR));

test('mystery tune: same week, same tune and options; options include the answer', () => {
  const t = G.tuneFor('2026-11-19'); assert.equal(G.tuneFor('2026-11-19').id, t.id);
  const o = G.optionsFor('2026-11-19'); assert.equal(o.length, 3); assert.ok(o.includes(t.name)); assert.equal(new Set(o).size, 3);
  for (const x of G.TUNES) { assert.equal(x.notes.length, 7); x.notes.forEach(m => assert.ok(m >= 60 && m <= 71, x.id)); }
});

test('mystery tune: payout falls as notes appear; revealed at 7 notes or on lesson day', () => {
  assert.deepEqual([1, 3, 4, 5, 6, 7].map(G.payoutFor), [3, 3, 2, 2, 1, 1]);
  assert.equal(G.revealed(7, '', ''), true); assert.equal(G.revealed(3, '2026-11-26', '2026-11-25'), false); assert.equal(G.revealed(3, '2026-11-26', '2026-11-26'), true);
});

test('echo: an exact echo, in another octave, is spot on', () => {
  assert.equal(G.markEcho([62, 64, 66], [{ m: 74, d: 0.4 }, { m: 76, d: 0.4 }, { m: 78, d: 0.4 }], 'sing').result, 'match');
});

test('echo: slightly flat singing still matches; a wrong middle note is close, never wrong', () => {
  assert.equal(G.markEcho([62, 66, 69], [{ m: 61, cents: 70, d: 0.4 }, { m: 66, cents: -30, d: 0.4 }, { m: 69, cents: 20, d: 0.4 }], 'sing').result, 'match');
  assert.equal(G.markEcho([62, 66, 69], [{ m: 62, d: 0.4 }, { m: 64, d: 0.4 }, { m: 69, d: 0.4 }], 'sing').result, 'close');
});

test('echo: too few notes or silence is unsure, not wrong', () => {
  assert.equal(G.markEcho([62, 64, 66], [], 'sing').result, 'unsure');
  assert.equal(G.markEcho([62, 64, 66], [{ m: 62, d: 0.4 }, { m: 64, d: 0.05 }], 'sing').result, 'unsure');
});

test('echo: played back with an octave slip on one note still matches', () => {
  assert.equal(G.markEcho([62, 64, 66], [{ m: 62, d: 0.4 }, { m: 76, d: 0.4 }, { m: 66, d: 0.4 }], 'play').result, 'match');
  assert.equal(G.markEcho([62, 64, 66], [{ m: 62, d: 0.4 }, { m: 76, d: 0.4 }, { m: 66, d: 0.4 }], 'sing').result, 'close');
});

test('echo: on notes the pitch tracker actually heard (synthesised, with gaps)', () => {
  assert.equal(G.markEcho([62, 66, 69], heard([62, 66, 69]), 'sing').result, 'match');
  assert.equal(G.markEcho([62, 66, 69], heard([74, 78, 81]), 'sing').result, 'match');
  assert.equal(G.markEcho([62, 66, 69], heard([62, 64, 69]), 'sing').result, 'close');
});

test('beat: taps rated and starred', () => {
  assert.deepEqual([20, 100, 200].map(G.rateTap), ['perfect', 'good', 'off']);
  assert.equal(G.beatStars(Array(8).fill('perfect')).stars, 3);
  assert.equal(G.beatStars(['good', 'good', 'off', 'off', 'off', 'off', 'off', 'off']).stars, 1);
});

test('unlocks: two early, then spaced out; the teacher can open them all', () => {
  assert.deepEqual(G.unlocks(0).have, ['beat']); assert.equal(G.unlocks(0).next.id, 'echo'); assert.equal(G.unlocks(0).next.left, 3);
  assert.ok(G.unlocks(6).has('quiz')); assert.ok(!G.unlocks(6).has('echo4')); assert.equal(G.unlocks(6).next.left, 14);
  assert.equal(G.unlocks(0, true).have.length, G.UNLOCKS.length); assert.equal(G.unlocks(0, true).next, null);
  assert.equal(G.phraseFor('x', 0, true).length, 4); assert.equal(G.phraseFor('x', 0).length, 3);
  assert.equal(G.markEcho([62, 64, 66, 67], [62, 64, 66, 67].map(m => ({ m, d: 0.4 })), 'sing').result, 'match');
});

test('spaced review: gaps grow with practice and ratings; picks the most overdue', () => {
  assert.equal(G.reviewGap({ n: 1 }), 2); assert.equal(G.reviewGap({ n: 4 }), 5); assert.equal(G.reviewGap({ n: 9 }), 10);
  assert.equal(G.reviewGap({ n: 4, rating: 'easy' }), 10); assert.equal(G.reviewGap({ n: 4, rating: 'hard' }), 3);
  const items = [{ name: 'Scale', last: '2026-11-10', n: 9 }, { name: 'Minuet', last: '2026-11-18', n: 1 }, { name: 'Bowing', last: '2026-11-21', n: 1 }];
  assert.equal(G.reviewPick(items, '2026-11-22').name, 'Minuet'); // 4 days / gap 2 beats 12 / 10
  assert.equal(G.reviewPick([{ name: 'X', last: '2026-11-21', n: 1 }], '2026-11-22'), null);
  assert.equal(G.reviewPick([], '2026-11-22'), null);
});

test('quests: three-plus small goals tracked from the week; nothing lost', () => {
  const q = G.questsFor({ days: 2, guessed: true, hasEcho: true, echoBest: 1 });
  assert.deepEqual(q.map(x => x.id), ['days', 'ladder', 'echo', 'guess']);
  assert.deepEqual(q.map(x => x.done), [false, false, true, true]);
  assert.equal(G.questsFor({ beatBest: 2 })[2].id, 'beat'); assert.equal(G.questsFor({ beatBest: 2 })[2].done, true);
});

test('tempo ladder: rungs climb from slow to the target and end on it', () => {
  const r = G.ladderRungs(100); assert.equal(r[0], 60); assert.equal(r[r.length - 1], 100); assert.ok(r.every((x, i) => i === 0 || x > r[i - 1]));
  assert.ok(r.length >= 4 && r.length <= 7);
  assert.equal(G.ladderRungs(500).slice(-1)[0], 200);
});

test('readiness and levels', () => {
  assert.equal(G.readiness(3, 7, 60, 140), 43); assert.equal(G.readiness(7, 7, 200, 140), 100);
  assert.deepEqual(G.levelOf(340), { level: 3, into: 40, of: 150 });
});
