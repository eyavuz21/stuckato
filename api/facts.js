// Stuckato: drafts fact cards and quiz questions about a pupil's piece and its composer, for the TEACHER to check.
// Nothing reaches a pupil until the teacher has approved each card. Only the piece's title, its composer and the
// instrument are sent: never the pupil's name or anything else about them.
import Anthropic from "@anthropic-ai/sdk";

const SCHEMA = {
  type: "object",
  properties: {
    cards: { type: "array", items: { type: "string" } },
    quiz: {
      type: "array",
      items: {
        type: "object",
        properties: {
          q: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer: { type: "integer" },
          card: { type: "integer" },
        },
        required: ["q", "options", "answer", "card"],
        additionalProperties: false,
      },
    },
    unsure: { type: "string" },
  },
  required: ["cards", "quiz", "unsure"],
  additionalProperties: false,
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "method_not_allowed" }); }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "not_configured", message: "ANTHROPIC_API_KEY is not set on this deployment." });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const piece = String(body.piece || "").slice(0, 160).trim();
  const composer = String(body.composer || "").slice(0, 120).trim();
  const instrument = String(body.instrument || "").slice(0, 60).trim();
  if (!piece) return res.status(400).json({ error: "bad_request", message: "Add the piece's title." });

  const prompt = `You write short fact cards for a child learning an instrument, about the piece they are practising and its composer. A music teacher will read every card before the child sees it, so accuracy matters more than anything.

Piece: ${piece}.${composer ? ` Composer: ${composer}.` : ""}${instrument ? ` Instrument: ${instrument}.` : ""}

Write up to 6 cards. Each is one or two sentences a 9 to 13 year old enjoys: surprising, concrete, about the piece, the composer's life, when and why it was written, or how it is built. British English. No em dashes.
Only include facts that are well established and that you are confident about. Do not invent anecdotes, quotes, dates or numbers. If a well-known story is doubtful or a legend, say so plainly ("The story goes that...") or leave it out. If you know little about this piece or composer, write fewer cards (even none) rather than guess, and say what you were unsure about in "unsure".
Then write 3 quiz questions, each answerable from one of your cards ("card" is that card's index, from 0). Each has exactly 3 short options and "answer" is the index of the right one. Make the wrong options plausible but clearly wrong.

Respond with JSON only.`;

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") return res.status(502).json({ error: "refusal", message: "The model declined this request." });
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed;
    try { parsed = JSON.parse(text); } catch { return res.status(502).json({ error: "bad_json", message: "The model returned something that was not JSON." }); }
    const plain = (t) => String(t || "").replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").trim();
    const cards = (parsed.cards || []).map(plain).filter(Boolean).slice(0, 6);
    const quiz = (parsed.quiz || []).filter((x) => Array.isArray(x.options) && x.options.length === 3 && x.answer >= 0 && x.answer < 3 && x.card >= 0 && x.card < cards.length)
      .slice(0, 3).map((x) => ({ q: plain(x.q), options: x.options.map(plain), answer: x.answer, card: x.card }));
    return res.status(200).json({ cards, quiz, unsure: plain(parsed.unsure) });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "rate_limited", message: "Too many requests just now. Try again in a minute." });
    if (err instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "auth", message: "The API key on this deployment was rejected." });
    if (err instanceof Anthropic.APIConnectionError) return res.status(502).json({ error: "connection", message: "Could not reach the model." });
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: "upstream", message: `Upstream error ${err.status}.` });
    return res.status(500).json({ error: "unknown", message: "Something went wrong." });
  }
}
