// Stuckato: the games layer (22 Nov 2026). Pure functions, no DOM, no Web Audio.
// The week's mystery tune (one note per practised day), the guess and what it pays, the echo game's marking,
// the beat game's scoring, readiness for the lesson and the "notes" points. Nothing here marks a note "wrong":
// the echo is "spot on", "close" or "unsure", and unsure goes to the teacher.
// Loaded as a plain script in the page (window.Games) and imported under Node (globalThis.Games) for the unit tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Games = factory();
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  // ------------------------------------------------------------ the mystery tunes
  // The first seven notes of well-known, out-of-copyright melodies, as MIDI numbers between C4 and A4 (the stave's
  // reach without high ledger lines). pos = steps above the bottom line of the treble stave (E4 = 0); sharp = draw a sharp.
  const STEP = { 60: -2, 62: -1, 64: 0, 65: 1, 66: 1, 67: 2, 69: 3, 71: 4 };
  const TUNES = [
    { id: 'ode', name: 'Ode to Joy', by: 'Beethoven', notes: [66, 66, 67, 69, 69, 67, 66] },
    { id: 'twinkle', name: 'Twinkle Twinkle', by: 'traditional', notes: [60, 60, 67, 67, 69, 69, 67] },
    { id: 'jacques', name: 'Frère Jacques', by: 'traditional', notes: [60, 62, 64, 60, 60, 62, 64] },
    { id: 'mary', name: 'Mary Had a Little Lamb', by: 'traditional', notes: [64, 62, 60, 62, 64, 64, 64] },
    { id: 'london', name: 'London Bridge', by: 'traditional', notes: [67, 69, 67, 65, 64, 65, 67] },
    { id: 'macdonald', name: 'Old MacDonald', by: 'traditional', notes: [67, 67, 67, 62, 64, 64, 62] },
    { id: 'row', name: 'Row, Row, Row Your Boat', by: 'traditional', notes: [60, 60, 60, 62, 64, 64, 62] },
    { id: 'buns', name: 'Hot Cross Buns', by: 'traditional', notes: [64, 62, 60, 64, 62, 60, 60] }
  ];
  const staffNote = m => ({ m, pos: STEP[m] != null ? STEP[m] : 0, sharp: m === 66, ledger: m === 60 });
  const hash = s => { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
  // The week's tune is fixed by the week (its id or start date), so it never changes under the pupil; options are the tune plus two others.
  function tuneFor(weekKey) { return TUNES[hash(weekKey) % TUNES.length]; }
  function optionsFor(weekKey) {
    const t = tuneFor(weekKey), h = hash(weekKey + ':opts'); const others = TUNES.filter(x => x.id !== t.id);
    const a = others[h % others.length], b = others.filter(x => x.id !== a.id)[(h >>> 8) % (others.length - 1)];
    const opts = [t, a, b]; const r = (h >>> 16) % 3; return opts.slice(r).concat(opts.slice(0, r)).map(x => x.name);
  }
  // A guess pays more the fewer notes were showing: up to 3 notes = 3 times, up to 5 = 2 times, later = once.
  const payoutFor = shown => shown <= 3 ? 3 : shown <= 5 ? 2 : 1;
  const revealed = (shown, lessonDay, today) => shown >= 7 || (!!lessonDay && !!today && today >= lessonDay);

  // ------------------------------------------------------------ echo it: three notes, sung, played or tapped
  // Marking ignores the key and the octave the pupil picks: only the steps between the notes count (an aural test
  // accepts any comfortable octave). Played back, a step a whole octave out is folded back (pitch trackers slip octaves).
  // Within 0.6 of a semitone is spot on; 1.5 or more out on any step is close-but-different; anything between, or a take
  // where fewer than three clear notes were heard, is unsure.
  const PHRASES = [[62, 64, 66], [62, 66, 69], [69, 67, 66], [62, 69, 66], [66, 64, 62], [67, 69, 71]];
  const PHRASES4 = [[62, 64, 66, 67], [69, 66, 64, 62], [62, 66, 69, 71], [67, 66, 64, 66], [62, 69, 67, 66]];
  const phraseFor = (seed, round, four) => { const L = four ? PHRASES4 : PHRASES; return L[(hash(seed) + round) % L.length]; };
  function markEcho(target, heard, mode) {
    const notes = (heard || []).filter(n => n && n.d >= 0.12 && isFinite(n.m)).map(n => n.m + (n.cents || 0) / 100);
    if (notes.length < target.length) return { result: 'unsure', why: notes.length ? 'too_few' : 'silent', heard: notes.length };
    // more notes than asked for: take the run of the right length whose steps fit best
    let best = null;
    for (let s = 0; s + target.length <= notes.length; s++) {
      const run = notes.slice(s, s + target.length); let worst = 0;
      for (let i = 1; i < target.length; i++) {
        let d = (run[i] - run[i - 1]) - (target[i] - target[i - 1]);
        if (mode === 'play') while (Math.abs(d) > 6) d -= 12 * Math.sign(d);
        worst = Math.max(worst, Math.abs(d));
      }
      if (!best || worst < best.worst) best = { worst, run };
    }
    const extra = notes.length - target.length;
    if (best.worst <= 0.6 && extra <= 1) return { result: 'match', worst: best.worst };
    if (best.worst >= 1.5) return { result: 'close', worst: best.worst };
    return { result: 'unsure', why: 'borderline', worst: best.worst };
  }

  // ------------------------------------------------------------ catch the beat
  const rateTap = errMs => errMs < 70 ? 'perfect' : errMs < 150 ? 'good' : 'off';
  function beatStars(rates) { const p = rates.filter(x => x === 'perfect').length, g = rates.filter(x => x === 'good').length; const s = p * 2 + g; return { perfect: p, good: g, stars: s >= 13 ? 3 : s >= 8 ? 2 : 1 }; }

  // ------------------------------------------------------------ readiness and points
  // Ready for the lesson: half days practised of days set, half minutes practised of minutes set, 0 to 100.
  function readiness(daysDone, daysSet, minDone, minSet) {
    const a = daysSet ? Math.min(1, daysDone / daysSet) : 0, b = minSet ? Math.min(1, minDone / minSet) : a;
    return Math.round(50 * a + 50 * b);
  }
  // "Notes" are points for the playful side only (tokens stay tied to the written sentence). 150 make a level.
  const POINTS = { session: 40, perfect: 2, good: 1, echo: 10, quiz: 20, mystery: 50 };
  const levelOf = pts => ({ level: 1 + Math.floor(pts / 150), into: pts % 150, of: 150 });

  // ------------------------------------------------------------ unlocks: features arrive as the pupil practises
  // Counted in practised days (sessions with the sentence written). Two come quickly to hook the first week, then about
  // one a month at four or five days a week. The teacher can switch them all on for a pupil (profile.unlockAll).
  const UNLOCKS = [
    { id: 'beat', at: 0, name: 'Catch the beat', what: 'A rhythm warm-up game' },
    { id: 'echo', at: 3, name: 'Echo it', what: 'Ear training: sing or play back three notes' },
    { id: 'quiz', at: 6, name: 'The lesson-day quiz', what: 'Questions from your fact cards; win a gold record' },
    { id: 'echo4', at: 20, name: 'Echo it: four notes', what: 'Longer echoes, like the harder aural tests' },
    { id: 'beatfast', at: 38, name: 'Catch the beat: faster', what: 'The beat game at a quicker tempo' },
    { id: 'collector', at: 56, name: 'Sticker album', what: 'See every sticker you have won, and the ones still to find' }
  ];
  function unlocks(practised, all) {
    const have = UNLOCKS.filter(u => all || practised >= u.at).map(u => u.id);
    const nx = all ? null : UNLOCKS.find(u => practised < u.at);
    return { have, has: id => have.includes(id), next: nx ? { id: nx.id, name: nx.name, what: nx.what, left: nx.at - practised } : null };
  }

  // ------------------------------------------------------------ spaced review: bring back something from earlier weeks
  // items: [{name, last:'YYYY-MM-DD', n (sessions worked on), rating:'easy'|'ok'|'hard'|undefined}]. The gap before an item
  // comes back grows with how often it has been worked on (2, 5, then 10 days), doubles after "easy" and halves after "hard".
  // Returns the most overdue item, or null. Anything worked on in the last day never comes back yet.
  const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
  function reviewGap(it) { let g = it.n >= 7 ? 10 : it.n >= 3 ? 5 : 2; if (it.rating === 'easy') g *= 2; if (it.rating === 'hard') g = Math.max(1, Math.round(g / 2)); return g; }
  function reviewPick(items, today) {
    let best = null;
    for (const it of items || []) { if (!it || !it.name || !it.last) continue; const since = dayDiff(it.last, today); if (since < 2) continue;
      const over = since / reviewGap(it); if (over >= 1 && (!best || over > best.over)) best = { ...it, over, since }; }
    return best;
  }

  // ------------------------------------------------------------ weekly quests (the idea from Tonic's challenges, done our way)
  // Three small goals a week, tracked from what the pupil already does: no leagues, no rankings, nothing to lose.
  // s: {days, guessed, ladderTop, echoBest, beatBest, hasEcho}. Each quest: {id, name, have, need, done}.
  const QUEST_NOTES = 30;
  function questsFor(s) {
    s = s || {};
    const q = [
      { id: 'days', name: 'Practise on 3 different days', have: Math.min(3, s.days || 0), need: 3 },
      { id: 'ladder', name: 'Climb the tempo ladder once', have: s.ladderTop ? 1 : 0, need: 1 },
      s.hasEcho ? { id: 'echo', name: 'Echo three notes spot on', have: Math.min(1, s.echoBest || 0), need: 1 } : { id: 'beat', name: 'Get two stars in Catch the beat', have: (s.beatBest || 0) >= 2 ? 1 : 0, need: 1 },
      { id: 'guess', name: 'Guess the mystery tune', have: s.guessed ? 1 : 0, need: 1 }
    ];
    return q.map(x => ({ ...x, done: x.have >= x.need }));
  }
  // ------------------------------------------------------------ the tempo ladder (slow practice, as in Modacity, Flowkey, Yousician; self-rated)
  // Rungs from a slow start to performance speed. The pupil plays the tricky bit at each rung and says "got it" or "not yet".
  function ladderRungs(target, start) { target = Math.max(60, Math.min(200, Math.round(target || 100))); start = Math.max(40, Math.round(start || target * 0.6));
    const out = []; for (let b = start; b < target; b += Math.max(4, Math.round((target - start) / 5))) out.push(b); out.push(target); return [...new Set(out)]; }

  return { UNLOCKS, unlocks, reviewPick, reviewGap, questsFor, QUEST_NOTES, ladderRungs, TUNES, staffNote, tuneFor, optionsFor, payoutFor, revealed, PHRASES, phraseFor, markEcho, rateTap, beatStars, readiness, POINTS, levelOf, hash };
});
