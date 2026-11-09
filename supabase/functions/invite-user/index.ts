// @ts-nocheck
// =====================================================================
// Edge Function „invite-user“ – nur für Admins
//   { action: "invite", email, name }      → Einladung per E-Mail
//   { action: "deactivate", user_id }      → Zugang sperren
//   { action: "activate",   user_id }      → Zugang wieder freigeben
// =====================================================================
const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://nordbeck-todo.github.io/";
const ADMIN = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // Wer ruft auf?
    const auth = req.headers.get("Authorization") || "";
    const me = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY, Authorization: auth } });
    if (!me.ok) return json({ error: "Nicht angemeldet." }, 401);
    const user = await me.json();
    const prof = await fetch(`${URL_}/rest/v1/profiles?id=eq.${user.id}&select=is_admin,active`, { headers: ADMIN }).then((r) => r.json());
    if (!prof?.[0]?.is_admin || !prof[0].active) return json({ error: "Nur Admins dürfen das." }, 403);

    const b = await req.json();

    if (b.action === "invite") {
      const email = String(b.email || "").trim().toLowerCase();
      const name = String(b.name || "").trim();
      if (!email.includes("@") || !name) return json({ error: "Name und E-Mail angeben." }, 400);
      const r = await fetch(`${URL_}/auth/v1/invite?redirect_to=${encodeURIComponent(APP_URL + "?setpw=1")}`, {
        method: "POST", headers: ADMIN, body: JSON.stringify({ email, data: { name } }),
      });
      const t = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: t.msg || t.message || "Einladung fehlgeschlagen." }, 400);
      return json({ ok: true, id: t.id });
    }

    if (b.action === "deactivate" || b.action === "activate") {
      const id = String(b.user_id || "");
      if (!id || id === user.id) return json({ error: "Ungültiger Nutzer." }, 400);
      const on = b.action === "activate";
      await fetch(`${URL_}/auth/v1/admin/users/${id}`, {
        method: "PUT", headers: ADMIN, body: JSON.stringify({ ban_duration: on ? "none" : "876000h" }),
      });
      await fetch(`${URL_}/rest/v1/profiles?id=eq.${id}`, {
        method: "PATCH", headers: ADMIN, body: JSON.stringify({ active: on }),
      });
      return json({ ok: true });
    }

    return json({ error: "Unbekannte Aktion." }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
