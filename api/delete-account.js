// Delete the signed-in person's account and everything attached to it.
//
// Apple requires an in-app way to delete an account for any app that lets you create one, and the pilot
// page promises parents we will delete a child's data on request. This is that promise, in code.
//
// The tables all reference auth.users(id) on delete cascade, so removing the auth user removes the member
// row and the pupil's document with it. Audio is the exception: it lives in a storage bucket under the
// studio's folder, so the files this person uploaded are collected from their own document and deleted
// first, by path.
//
// A teacher is refused while their studio still has members. Deleting a teacher cascades the studio, and
// the studio cascades every pupil in it, so one tap would erase other people's children's data. That is
// not a confirmation dialog's job to prevent.
import { whoAmI, readJson } from "./_auth.js";

const BUCKET = "melodigo-audio";

// Every storage path this person's own document points at.
function audioPaths(data, bucket) {
  const found = new Set();
  const marker = `/object/public/${bucket}/`;
  JSON.stringify(data ?? {}).replace(/https?:\/\/[^"\\ ]+/g, (u) => {
    const i = u.indexOf(marker);
    if (i !== -1) found.add(decodeURIComponent(u.slice(i + marker.length).split("?")[0]));
    return u;
  });
  return [...found];
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const who = await whoAmI(req);
  if (!who?.user || !who?.me) return res.status(401).json({ error: "unauthorised" });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(503).json({ error: "not_configured", message: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment." });

  const body = readJson(req);
  if (String(body.confirm || "").trim().toUpperCase() !== "DELETE") {
    return res.status(400).json({ error: "confirm_required", message: "Type DELETE to confirm." });
  }

  const h = { apikey: key, authorization: `Bearer ${key}` };
  const userId = who.user.id;

  // A teacher may not delete a studio other people are still in.
  if (who.me.role === "teacher") {
    const r = await fetch(`${url}/rest/v1/practicigo_members?studio_id=eq.${who.me.studio_id}&user_id=neq.${userId}&select=user_id`, { headers: h });
    const others = r.ok ? await r.json() : [];
    if (others.length) {
      return res.status(409).json({
        error: "studio_not_empty",
        message: `Your studio still has ${others.length} ${others.length === 1 ? "member" : "members"}. Deleting your account would delete their practice data too. Remove them first, or email hello@stuckato.app and we will do it with you.`
      });
    }
  }

  // Delete this person's own uploads before the rows that point at them disappear.
  let filesDeleted = 0;
  try {
    const r = await fetch(`${url}/rest/v1/practicigo_students?user_id=eq.${userId}&select=data`, { headers: h });
    const rows = r.ok ? await r.json() : [];
    const paths = rows.length ? audioPaths(rows[0].data, BUCKET) : [];
    if (paths.length) {
      const d = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
        method: "DELETE", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ prefixes: paths })
      });
      if (d.ok) filesDeleted = paths.length;
    }
  } catch { /* a missing recording must not block the deletion itself */ }

  // Removing the auth user cascades practicigo_members, practicigo_students and, for a teacher, the studio.
  const del = await fetch(`${url}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: h });
  if (!del.ok) {
    const detail = await del.text().catch(() => "");
    return res.status(502).json({ error: "delete_failed", message: "The account could not be deleted. Nothing has been removed. Email hello@stuckato.app and we will do it by hand.", detail: detail.slice(0, 300) });
  }

  return res.status(200).json({ deleted: true, filesDeleted });
}
