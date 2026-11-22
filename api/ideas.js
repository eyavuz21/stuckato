// Stuckato: "Play together". The teacher describes a group in general terms (how many, which instruments, levels, ages,
// how long, what to focus on) and gets pieces, games and activities for that class, plus a running order.
// Nothing personal is sent: no names, and the page asks the teacher to leave personal details out of the free-text box.
import Anthropic from "@anthropic-ai/sdk";

const item = (extra) => ({ type: "object", properties: { name: { type: "string" }, minutes: { type: "integer" }, how: { type: "string" }, ...extra }, required: ["name", "minutes", "how", ...Object.keys(extra)], additionalProperties: false });
const SCHEMA = {
  type: "object",
  properties: {
    pieces: { type: "array", items: { type: "object", properties: { title: { type: "string" }, composer: { type: "string" }, why: { type: "string" }, parts: { type: "string" } }, required: ["title", "composer", "why", "parts"], additionalProperties: false } },
    games: { type: "array", items: item({ skill: { type: "string" } }) },
    activities: { type: "array", items: item({ create: { type: "boolean" } }) },
    plan: { type: "array", items: { type: "object", properties: { minutes: { type: "integer" }, what: { type: "string" } }, required: ["minutes", "what"], additionalProperties: false } },
  },
  required: ["pieces", "games", "activities", "plan"],
  additionalProperties: false,
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "method_not_allowed" }); }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "not_configured", message: "ANTHROPIC_API_KEY is not set on this deployment." });
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const s = (v, n) => String(v || "").slice(0, n).trim();
  const size = Math.max(2, Math.min(80, Number(b.size) || 6));
  const instruments = s(b.instruments, 300), levels = s(b.levels, 80), ages = s(b.ages, 60), occasion = s(b.occasion, 200), notes = s(b.notes, 600);
  const minutes = Math.max(10, Math.min(180, Number(b.minutes) || 45));
  const focus = Array.isArray(b.focus) ? b.focus.map((x) => s(x, 40)).filter(Boolean).slice(0, 8) : [];
  if (!instruments) return res.status(400).json({ error: "bad_request", message: "Say which instruments are in the group." });

  const prompt = `You help a music teacher plan a group session. British English, warm and practical, no em dashes.

The group: ${size} players. Instruments: ${instruments}. Levels: ${levels || "mixed"}. Ages: ${ages || "mixed"}. Session length: ${minutes} minutes.${focus.length ? ` Focus: ${focus.join(", ")}.` : ""}${occasion ? ` Working towards: ${occasion}.` : ""}${notes ? `\nThe teacher adds: ${notes}` : ""}

Suggest:
- 3 to 5 pieces this group could play together. Only real, well-known pieces or traditional tunes you are sure exist, by their usual title and composer (or "traditional"). Prefer music that is out of copyright or very widely arranged for mixed groups. Never invent an edition, publisher or arrangement; in "parts" say plainly how it could be shared out across these instruments and levels (melody, harmony, bass, an easy part on open strings or a single note), and say if the teacher will need to arrange it themselves. "why" is one sentence on why it suits this group.
- 3 to 5 games that build ensemble skills (rhythm, listening, starting and stopping together, dynamics, ear). Each needs only the instruments, voices, chairs or a speaker. "how" explains the rules in two or three sentences. "skill" names what it trains.
- 2 to 4 activities, at least one creative (improvising, composing a short piece together, a soundscape, call and response); mark those "create": true.
- A running order for the ${minutes} minutes ("plan"), using the ideas above, with minutes adding up to about ${minutes}.
Everything must work for these levels and ages. Respond with JSON only.`;

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 3000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") return res.status(502).json({ error: "refusal", message: "The model declined this request." });
    const text = response.content.filter((x) => x.type === "text").map((x) => x.text).join("");
    let p; try { p = JSON.parse(text); } catch { return res.status(502).json({ error: "bad_json", message: "The model returned something that was not JSON." }); }
    const plain = (t) => String(t || "").replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").trim();
    const clean = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? plain(v) : v]));
    return res.status(200).json({ pieces: (p.pieces || []).slice(0, 5).map(clean), games: (p.games || []).slice(0, 5).map(clean), activities: (p.activities || []).slice(0, 4).map(clean), plan: (p.plan || []).slice(0, 12).map(clean) });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "rate_limited", message: "Too many requests just now. Try again in a minute." });
    if (err instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "auth", message: "The API key on this deployment was rejected." });
    if (err instanceof Anthropic.APIConnectionError) return res.status(502).json({ error: "connection", message: "Could not reach the model." });
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: "upstream", message: `Upstream error ${err.status}.` });
    return res.status(500).json({ error: "unknown", message: "Something went wrong." });
  }
}
