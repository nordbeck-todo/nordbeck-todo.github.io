// Nordbeck To-Do – Hauptprogramm
import { sb } from "./supabase.js";
import { VAPID_PUBLIC_KEY, APP_VERSION } from "./config.js";
import {
  i, esc, fmtDate, fmtDue, fmtTime, initials, greeting, longDate, toast, b64uToUint8, isIOS, isStandalone, COLORS, daysUntil,
} from "./util.js";
import * as st from "./store.js";
const { S } = st;

const $app = document.getElementById("app");
const $modal = document.getElementById("modal-root");
let shellReady = false;
let setPwMode = new URLSearchParams(location.search).has("setpw");

// =====================================================================
// Start
// =====================================================================
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
// Kennzeichen auch hier setzen (falls das iPad noch eine ältere index.html aus dem Zwischenspeicher zeigt)
try {
  const d = document.documentElement, n = navigator;
  if (n.standalone === true || matchMedia("(display-mode: standalone)").matches) d.classList.add("ios-app");
  if (/iPad/.test(n.userAgent) || (/Macintosh/.test(n.userAgent) && n.maxTouchPoints > 1)) d.classList.add("ipad");
} catch (_) { /* */ }

// Zoomen verhindern (iPhone: Zwei-Finger-Zoom; Doppeltipp verhindert touch-action im CSS)
["gesturestart", "gesturechange", "gestureend"].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

async function boot() {
  const hashErr = new URLSearchParams(location.hash.slice(1)).get("error_description");
  const { data: { session } } = await sb.auth.getSession();
  if (location.hash.includes("access_token") || hashErr) history.replaceState(null, "", location.pathname + location.search + "#/");
  sb.auth.onAuthStateChange((ev, sess) => {
    if (ev === "PASSWORD_RECOVERY") { setPwMode = true; start(sess); }
    if (ev === "SIGNED_OUT") { shellReady = false; st.stopRealtime(); renderLogin(); }
  });
  if (!session) return renderLogin(hashErr ? "Der Link ist abgelaufen oder ungültig. Bitte fordere einen neuen an." : "");
  start(session);
}

async function start(session) {
  S.me = session.user.id;
  try { await st.loadAll(); } catch (e) { return renderError(e.message); }
  if (setPwMode) return renderSetPassword();
  if (!S.profile || !S.profile.active) return renderBlocked();
  st.startRealtime();
  st.onChange(() => { if (shellReady) route(); });
  window.addEventListener("hashchange", route);
  if (!location.hash || location.hash === "#") location.hash = "#/";
  route();
}

function renderError(msg) {
  $app.innerHTML = `<div class="login"><div class="box"><img src="img/logo.png" alt="Nordbeck"><div class="card">
    <h2>Verbindung fehlgeschlagen</h2><p class="muted" style="margin-bottom:16px">${esc(msg)}</p>
    <button class="btn red" onclick="location.reload()">Erneut versuchen</button></div></div></div>`;
}
function renderBlocked() {
  $app.innerHTML = `<div class="login"><div class="box"><img src="img/logo.png" alt="Nordbeck"><div class="card">
    <h2>Kein Zugang</h2><p class="muted" style="margin-bottom:16px">Dein Zugang ist gesperrt oder noch nicht eingerichtet. Bitte wende dich an einen Admin.</p>
    <button class="btn" id="lo">${i("logout")}Abmelden</button></div></div></div>`;
  document.getElementById("lo").onclick = () => sb.auth.signOut();
}

// =====================================================================
// Anmeldung
// =====================================================================
function renderLogin(msg = "") {
  $app.innerHTML = `<div class="login"><div class="box"><img src="img/logo.png" alt="Tischlermeister Nordbeck">
    <form class="card" id="lf"><h2>Anmelden</h2>
      ${msg ? `<div class="err">${esc(msg)}</div>` : ""}<div class="err hidden" id="le"></div>
      <div class="field"><label>E-Mail</label><input type="email" name="email" autocomplete="username" required></div>
      <div class="field"><label>Passwort</label><input type="password" name="pw" autocomplete="current-password" required></div>
      <button class="btn red" style="width:100%;padding:11px" id="lb">Anmelden</button>
      <div style="text-align:center;margin-top:14px"><a href="#" id="fg">Passwort vergessen?</a></div>
    </form>
    <div style="text-align:center;color:#8a8c92;font-size:12px;margin-top:18px">Nordbeck To-Do · Zugang erhältst du von einem Admin</div></div></div>`;
  const f = document.getElementById("lf"), le = document.getElementById("le");
  const err = (t) => { le.textContent = t; le.classList.remove("hidden"); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = document.getElementById("lb"); b.disabled = true; b.textContent = "Moment …";
    const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.pw.value });
    if (error) { b.disabled = false; b.textContent = "Anmelden"; return err("E-Mail oder Passwort falsch."); }
    location.hash = "#/"; start(data.session);
  };
  document.getElementById("fg").onclick = async (e) => {
    e.preventDefault();
    const email = f.email.value.trim();
    if (!email) return err("Bitte zuerst die E-Mail-Adresse eintragen.");
    await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + "?setpw=1" });
    toast("Falls keine E-Mail kommt: Ein Admin kann dein Passwort in der App zurücksetzen.");
  };
}

function renderSetPassword() {
  const name = S.profile?.name || "";
  $app.innerHTML = `<div class="login"><div class="box"><img src="img/logo.png" alt="Nordbeck">
    <form class="card" id="pf"><h2>Passwort festlegen</h2>
      <p class="muted" style="margin-bottom:14px">Willkommen${name ? ", " + esc(name) : ""}! Lege dein Passwort für die App fest.</p>
      <div class="err hidden" id="pe"></div>
      <div class="field"><label>Neues Passwort (mind. 8 Zeichen)</label><input type="password" name="a" autocomplete="new-password" minlength="8" required></div>
      <div class="field"><label>Wiederholen</label><input type="password" name="b" autocomplete="new-password" minlength="8" required></div>
      <button class="btn red" style="width:100%;padding:11px">Speichern und loslegen</button></form></div></div>`;
  const f = document.getElementById("pf"), pe = document.getElementById("pe");
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (f.a.value !== f.b.value) { pe.textContent = "Die Passwörter stimmen nicht überein."; return pe.classList.remove("hidden"); }
    const { error } = await sb.auth.updateUser({ password: f.a.value });
    if (error) { pe.textContent = error.message; return pe.classList.remove("hidden"); }
    setPwMode = false;
    history.replaceState(null, "", location.pathname + "#/");
    toast("Passwort gespeichert.");
    const { data: { session } } = await sb.auth.getSession();
    start(session);
  };
}

// =====================================================================
// Grundgerüst
// =====================================================================
const NAV = [
  ["#/", "home", "Übersicht"], ["#/aufgaben", "check", "Meine Aufgaben", () => st.myOpen().length],
  ["#/alle", "list", "Alle Aufgaben"], ["#/projekte", "folder", "Projekte"],
  ["#/pruefung", "eye", "Zur Prüfung", () => st.waitingForMe().length], ["#/archiv", "archive", "Archiv"],
];
function shell() {
  $app.innerHTML = `
  <div class="safe-top"></div><div class="safe-bottom"></div>
  <aside class="side">
    <a class="logo" href="#/"><img src="img/logo.png" alt="Tischlermeister Nordbeck"></a>
    <form class="search" id="ss">${i("search")}<input placeholder="Suche" name="q"></form>
    <nav id="snav"></nav>
    <div id="sadmin"></div>
    <div class="foot">Nordbeck To-Do · v${APP_VERSION}</div>
  </aside>
  <header class="top">
    <form class="search" id="ts">${i("search")}<input placeholder="Aufgaben und Projekte durchsuchen …" name="q"></form>
    <button class="btn red" data-new>${i("plus")}Neu</button>
    <a class="iconbtn" href="#/mitteilungen" title="Benachrichtigungen">${i("bell")}<span class="badge hidden" id="tbadge"></span></a>
    <a href="#/einstellungen" title="Einstellungen" id="tav"></a>
  </header>
  <header class="mhead" id="mhead"></header>
  <main class="main" id="main"></main>
  <nav class="mnav" id="mnav"></nav>
  <button class="fab" data-new aria-label="Neue Aufgabe">${i("plus")}</button>`;
  for (const id of ["ss", "ts"]) document.getElementById(id).onsubmit = (e) => {
    e.preventDefault(); const q = e.target.q.value.trim(); if (q) location.hash = "#/suche/" + encodeURIComponent(q);
  };
  $app.addEventListener("click", (e) => {
    const n = e.target.closest("[data-new]");
    if (n) { e.preventDefault(); openTaskForm(null, { project_id: currentProject() }); }
  });
  shellReady = true;
}
function currentProject() { const m = location.hash.match(/^#\/projekt\/([^/]+)/); return m && m[1] !== "allgemein" ? m[1] : null; }

function updateChrome(path, v) {
  const nav = NAV.map(([h, ic, t, cnt]) => {
    const c = cnt ? cnt() : 0;
    const act = h === "#/" ? path === "" : path.startsWith(h.slice(2));
    return `<a class="mi${act ? " act" : ""}" href="${h}">${i(ic)}<span>${t}</span>${c ? `<span class="badge">${c}</span>` : ""}</a>`;
  }).join("");
  document.getElementById("snav").innerHTML = nav;
  document.getElementById("sadmin").innerHTML = `<div class="sep"></div>
    ${st.isAdmin() ? `<div class="lbl">ADMIN</div><a class="mi${path.startsWith("nutzer") ? " act" : ""}" href="#/nutzer">${i("users")}<span>Nutzer</span></a>` : ""}
    <a class="mi${path.startsWith("einstellungen") ? " act" : ""}" href="#/einstellungen">${i("gear")}<span>Einstellungen</span></a>`;
  const u = st.unreadCount();
  const tb = document.getElementById("tbadge"); tb.textContent = u; tb.classList.toggle("hidden", !u);
  document.getElementById("tav").innerHTML = avatar(S.me, "lg");
  // Handy
  const bell = `<a class="bell" href="#/mitteilungen" aria-label="Benachrichtigungen">${i("bell", "width:22px;height:22px")}${u ? `<span class="badge">${u}</span>` : ""}</a>`;
  document.getElementById("mhead").innerHTML = `
    <div class="mrow"><span class="mside">${v.back ? `<a class="back" href="${v.back}" aria-label="Zurück">${i("back", "width:22px;height:22px")}</a>` : ""}</span>
      <a href="#/" class="mlogo"><img src="img/logo.png" alt="Tischlermeister Nordbeck"></a><span class="mside r">${bell}</span></div>
    <div class="mtitle">${v.sub ? `<div class="sub">${esc(v.sub)}</div>` : ""}<div class="ptitle">${esc(v.title)}</div></div>`;
  const mn = [["#/", "home", "Übersicht", ""], ["#/aufgaben", "check", "Aufgaben", "aufgaben"], ["#/projekte", "folder", "Projekte", "projekt"], ["#/mehr", "more", "Mehr", "mehr"]];
  const moreKeys = ["alle", "pruefung", "archiv", "mitteilungen", "nutzer", "einstellungen", "suche", "mehr"];
  const w = st.waitingForMe().length;
  document.getElementById("mnav").innerHTML = mn.map(([h, ic, t, key]) => {
    const act = key === "" ? path === "" : key === "mehr" ? moreKeys.some((k) => path.startsWith(k)) : path.startsWith(key) || (key === "aufgaben" && path.startsWith("aufgabe/"));
    const b = key === "aufgaben" ? st.myOpen().length : key === "mehr" ? w : 0;
    return `<a href="${h}" class="${act ? "act" : ""}"><span class="ic">${i(ic)}</span>${t}${b ? `<span class="badge">${b}</span>` : ""}</a>`;
  }).join("");
  document.querySelector(".fab").classList.toggle("hidden", !!v.noFab);
  const mh = document.getElementById("mhead");
  requestAnimationFrame(() => document.documentElement.style.setProperty("--mhead-h", mh.offsetHeight + "px"));
  document.title = `${v.title} · Nordbeck To-Do`;
}

// =====================================================================
// Router
// =====================================================================
const ROUTES = [
  [/^$/, vDashboard], [/^aufgaben$/, vMine], [/^alle$/, vAll], [/^projekte$/, vProjects], [/^projekt\/([^/]+)$/, vProject],
  [/^aufgabe\/([^/]+)$/, vTask], [/^pruefung$/, vReview], [/^archiv$/, vArchive], [/^mitteilungen$/, vNotifications],
  [/^nutzer$/, vUsers], [/^einstellungen$/, vSettings], [/^mehr$/, vMore], [/^suche\/(.+)$/, vSearch],
];
let lastPath = null;
function route() {
  if (!shellReady) shell();
  const path = decodeURIComponent(location.hash.replace(/^#\/?/, "")).replace(/\/$/, "");
  let v = null;
  for (const [re, fn] of ROUTES) { const m = path.match(re); if (m) { v = fn(...m.slice(1)); break; } }
  if (!v) v = vDashboard();
  const main = document.getElementById("main");
  const keep = path === lastPath ? [window.scrollY, document.activeElement?.id] : null;
  main.innerHTML = v.html;
  updateChrome(path, v);
  v.after?.(main);
  if (keep) { window.scrollTo(0, keep[0]); if (keep[1]) document.getElementById(keep[1])?.focus(); } else window.scrollTo(0, 0);
  lastPath = path;
}

// =====================================================================
// Bausteine
// =====================================================================
function avatar(uid, cls = "") {
  const p = st.profile(uid);
  return `<span class="av ${cls}" style="background:${esc(p?.color || "#9a9da5")}" title="${esc(p?.name || "")}">${esc(initials(p?.name))}</span>`;
}
const avatars = (ids) => `<span class="avs">${ids.map((u) => avatar(u)).join("")}</span>`;
const PRIO = { 1: "Hoch", 2: "Mittel", 3: "Niedrig" };

function cbHtml(t) {
  const cls = t.status === "done" ? "done" : t.status === "review" ? "review" : "";
  const title = t.status === "done" ? "Wieder öffnen" : t.status === "review" ? "Wartet auf Bestätigung" : "Abhaken";
  return `<button class="cb ${cls}" data-toggle="${t.id}" title="${title}" ${st.canEdit(t) ? "" : "disabled"}>${t.status !== "open" ? i(t.status === "done" ? "tick" : "eye") : ""}</button>`;
}

function taskRow(t, opt = {}) {
  const ids = st.assigneesOf(t.id);
  const ck = st.checklistOf(t.id), cm = st.commentsOf(t.id).length;
  const p = t.project_id ? st.project(t.project_id) : null;
  const due = fmtDue(t.due_date);
  const over = due.over && t.status !== "done";
  let meta = "";
  if (opt.project !== false) meta += `<span class="chip">${esc(p ? p.name : "Allgemein")}</span>`;
  if (t.status === "review") meta += `<span class="chip" style="background:#fff1d6;color:#9a6200">zur Prüfung</span>`;
  if (ck.length) meta += `<span class="m">${i("clist")}${ck.filter((c) => c.done).length}/${ck.length}</span>`;
  if (cm) meta += `<span class="m">${i("chat")}${cm}</span>`;
  if (t.status === "done" && t.done_by) meta += `<span class="m">erledigt von ${esc(st.profile(t.done_by)?.name || "")}</span>`;
  return `<div class="trow" data-open="${t.id}">${cbHtml(t)}<span class="prio p${t.priority}" title="Priorität ${PRIO[t.priority]}"></span>
    <div class="tt"><div class="ti ${t.status === "done" ? "strike" : ""}">${esc(t.title)}</div><div class="meta">${meta}</div></div>
    <div class="side-r"><div class="due ${over ? "over" : ""}">${t.due_date ? (over ? i("alert") + '<span class="ol">überfällig · </span>' : i("cal")) + due.text : ""}</div>
    <div class="who">${avatars(ids)}</div></div></div>`;
}

function taskList(list, opt = {}) {
  if (!list.length) return `<div class="empty">${opt.empty || "Keine Aufgaben."}</div>`;
  if (opt.group === false) return list.map((t) => taskRow(t, opt)).join("");
  return st.groupByDue(list).map(([lbl, ts, red]) =>
    `<div class="grp ${red ? "red" : ""}">${lbl} · ${ts.length}</div>${ts.map((t) => taskRow(t, opt)).join("")}`).join("");
}

function bindList(root) {
  root.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    const t = st.task(b.dataset.toggle);
    if (!t || !st.canEdit(t)) return;
    if (t.status === "review" && t.created_by !== S.me) return toast("Wartet auf Bestätigung durch den Ersteller.");
    if (t.status !== "open" && !confirm("Aufgabe wieder öffnen?")) return;
    try {
      const s = await st.toggleTask(t);
      toast(s === "done" ? "Erledigt ✓" : s === "review" ? "Zur Prüfung an den Ersteller geschickt" : "Wieder geöffnet");
    } catch (er) { toast(er.message); }
  });
  root.querySelectorAll("[data-open]").forEach((r) => r.onclick = () => (location.hash = "#/aufgabe/" + r.dataset.open));
}

function seg(items, cur, attr) {
  return `<div class="seg">${items.map(([k, l]) => `<button class="btn sm ${k === cur ? "on" : ""}" data-${attr}="${k}">${l}</button>`).join("")}</div>`;
}
function ring(pct) {
  const c = 97.4, d = (pct / 100) * c;
  return `<div class="ring"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--track)" stroke-width="4"/>
    <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--accent)" stroke-width="4" stroke-dasharray="${d} ${c}" stroke-linecap="round"/></svg><div>${pct} %</div></div>`;
}

// =====================================================================
// Ansichten
// =====================================================================
function pushNote() {
  const s = pushState();
  if (s === "on" || s === "unsupported" || s === "denied" || sessionStorage.getItem("pushNoteHidden")) return "";
  const ios = s === "ios-install";
  return `<div class="card note"><div>${i(ios ? "phone" : "bell", "width:22px;height:22px;color:var(--accent)")}</div>
    <div class="tx"><b>${ios ? "App zum Home-Bildschirm hinzufügen" : "Erinnerungen aktivieren"}</b><div class="muted" style="font-size:13px">${ios
      ? "Auf dem iPhone kommen Erinnerungen nur, wenn die App über Teilen → „Zum Home-Bildschirm“ installiert ist."
      : "Damit du an Fristen und neue Aufgaben erinnert wirst."}</div></div>
    ${ios ? "" : `<button class="btn red sm" id="pushOn">Aktivieren</button>`}<button class="btn ghost sm" id="pushHide">Später</button></div>`;
}
function bindPushNote(root) {
  const on = root.querySelector("#pushOn"); if (on) on.onclick = async () => { await enablePush(); route(); };
  const h = root.querySelector("#pushHide"); if (h) h.onclick = () => { sessionStorage.setItem("pushNoteHidden", "1"); route(); };
}

function vDashboard() {
  const mine = st.myOpen();
  const over = mine.filter((t) => daysUntil(t.due_date) < 0).length;
  const today = mine.filter((t) => daysUntil(t.due_date) === 0);
  const wait = st.waitingForMe();
  const projs = st.activeProjects();
  const avg = projs.length ? Math.round(projs.reduce((s, p) => s + st.progress(st.tasksOfProject(p.id)).pct, 0) / projs.length) : 0;
  const first = (S.profile?.name || "").split(" ")[0];
  const stat = (h, ic, t, n, s, red) => `<a class="card stat" href="${h}"><div class="t">${i(ic)}${t}</div>
    <div class="n" style="${red ? "color:var(--accent)" : ""}">${n}</div><div class="s ${red ? "over" : ""}">${s}</div></a>`;
  const prows = [...projs.map((p) => [p, st.tasksOfProject(p.id)]), [null, st.tasksOfProject("allgemein").filter((t) => true)]]
    .filter(([p, l]) => p || l.length)
    .map(([p, l]) => {
      const g = st.progress(l);
      return `<a class="prow" href="#/projekt/${p ? p.id : "allgemein"}"><div class="a"><span>${esc(p ? p.name : "Allgemein")}</span><span>${g.pct} %</span></div>
        <div class="bar"><div style="width:${g.pct}%"></div></div>
        <div class="b"><span style="display:flex;gap:6px;align-items:center">${p ? (p.owner_id ? avatar(p.owner_id) : "") + (p.due_date ? ` bis ${fmtDate(p.due_date)}` : "") : "Aufgaben ohne Projekt"}</span><span>${g.done} von ${g.total} erledigt</span></div></a>`;
    }).join("") || `<div class="empty">Noch keine Projekte.</div>`;
  return {
    title: "Übersicht",
    html: `<div class="page-h"><div><h1 style="display:block">${greeting()}${first ? ", " + esc(first) : ""}</h1><div class="muted">${longDate()}</div></div></div>
      ${pushNote()}
      <div class="stats">
        ${stat("#/aufgaben", "check", "Meine offenen Aufgaben", mine.length, over ? `davon ${over} überfällig` : "nichts überfällig", over > 0)}
        ${stat("#/aufgaben", "cal", "Heute fällig", today.length, today.map((t) => t.title).join(", ").slice(0, 60) || "–")}
        ${stat("#/pruefung", "eye", "Zur Prüfung", wait.length, wait.length ? "wartet auf deine Bestätigung" : "nichts offen")}
        ${stat("#/projekte", "folder", "Aktive Projekte", projs.length, projs.length ? `Ø ${avg} % erledigt` : "–")}
      </div>
      <div class="cols">
        <div class="card list-cards-m"><div class="card-h"><h3>Meine Aufgaben</h3><a class="btn sm" href="#/aufgaben">Alle anzeigen</a></div>
          ${taskList(st.sortTasks(mine).slice(0, 8), { group: false, empty: "Keine offenen Aufgaben – sehr gut!" })}
          <div class="card-f"><a href="#" data-new>+ Aufgabe hinzufügen</a></div></div>
        <div class="card"><div class="card-h"><h3>Projekte</h3><button class="btn sm" id="np">${i("plus", "width:14px;height:14px")}Projekt</button></div>
          <div style="padding:0 18px 6px">${prows}</div></div>
      </div>`,
    after(r) { bindList(r); bindPushNote(r); r.querySelector("#np").onclick = () => openProjectForm(); },
  };
}

let mineTab = "open";
function vMine() {
  const mine = S.tasks.filter((t) => (st.isMine(t) || (t.created_by === S.me && t.status === "review")) && !st.archivedTask(t));
  const open = mine.filter((t) => t.status === "open"), rev = mine.filter((t) => t.status === "review");
  const done = mine.filter((t) => t.status === "done").sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "")).slice(0, 50);
  const list = mineTab === "open" ? taskList(open, { empty: "Keine offenen Aufgaben – sehr gut!" })
    : mineTab === "review" ? taskList(rev, { group: false, empty: "Nichts zur Prüfung." })
    : taskList(done, { group: false, empty: "Noch nichts erledigt." });
  return {
    title: "Meine Aufgaben",
    html: `<div class="page-h"><h1>Meine Aufgaben</h1>${seg([["open", `Offen · ${open.length}`], ["review", `Zur Prüfung · ${rev.length}`], ["done", "Erledigt"]], mineTab, "tab")}</div>
      <div class="card list-cards">${list}</div>`,
    after(r) { bindList(r); r.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { mineTab = b.dataset.tab; route(); }); },
  };
}

const allF = { who: "", proj: "", status: "open" };
function vAll() {
  let list = S.tasks.filter((t) => !st.archivedTask(t));
  if (allF.who) list = list.filter((t) => st.assigneesOf(t.id).includes(allF.who));
  if (allF.proj) list = list.filter((t) => (allF.proj === "allgemein" ? !t.project_id : t.project_id === allF.proj));
  if (allF.status !== "all") list = list.filter((t) => (allF.status === "open" ? t.status !== "done" : t.status === "done"));
  const sel = (id, opts, cur) => `<select class="inp" id="${id}" style="width:auto">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  return {
    title: "Alle Aufgaben",
    html: `<div class="page-h"><h1>Alle Aufgaben</h1></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${sel("fw", [["", "Alle Personen"], ...st.activeProfiles().map((p) => [p.id, p.name])], allF.who)}
        ${sel("fp", [["", "Alle Projekte"], ["allgemein", "Allgemein"], ...st.activeProjects().map((p) => [p.id, p.name])], allF.proj)}
        ${seg([["open", "Offen"], ["done", "Erledigt"], ["all", "Alle"]], allF.status, "st")}
      </div>
      <div class="card list-cards">${allF.status === "done" ? taskList(st.sortTasks(list).reverse(), { group: false }) : taskList(list)}</div>`,
    after(r) {
      bindList(r);
      r.querySelector("#fw").onchange = (e) => { allF.who = e.target.value; route(); };
      r.querySelector("#fp").onchange = (e) => { allF.proj = e.target.value; route(); };
      r.querySelectorAll("[data-st]").forEach((b) => b.onclick = () => { allF.status = b.dataset.st; route(); });
    },
  };
}

function projectCard(p) {
  const l = st.tasksOfProject(p ? p.id : "allgemein"), g = st.progress(l);
  const open = l.filter((t) => t.status !== "done").length;
  return `<a class="card pcard" href="#/projekt/${p ? p.id : "allgemein"}"><h3><span>${esc(p ? p.name : "Allgemein")}</span><span>${g.pct} %</span></h3>
    <div class="bar"><div style="width:${g.pct}%"></div></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12px" class="muted">
      <span style="display:flex;gap:6px;align-items:center">${p ? (p.owner_id ? avatar(p.owner_id) + " " + esc(st.profile(p.owner_id)?.name || "") : "kein Verantwortlicher") : "Aufgaben ohne Projekt"}</span>
      <span>${open} offen · ${g.done}/${g.total}</span></div>
    ${p?.due_date ? `<div class="muted" style="font-size:12px;margin-top:6px">${i("cal", "width:13px;height:13px;vertical-align:-2px")} bis ${fmtDate(p.due_date)}</div>` : ""}</a>`;
}
function vProjects() {
  return {
    title: "Projekte",
    html: `<div class="page-h"><h1>Projekte</h1><div style="display:flex;gap:8px"><a class="btn" href="#/archiv">${i("archive")}Archiv</a><button class="btn red" id="np">${i("plus")}Projekt</button></div></div>
      <div class="pgrid">${st.activeProjects().map(projectCard).join("")}${projectCard(null)}</div>`,
    after(r) { r.querySelector("#np").onclick = () => openProjectForm(); },
  };
}

let projTab = "open";
function vProject(id) {
  const p = id === "allgemein" ? null : st.project(id);
  if (id !== "allgemein" && !p) return { title: "Projekt", back: "#/projekte", html: `<div class="empty">Projekt nicht gefunden.</div>` };
  const l = st.tasksOfProject(id), g = st.progress(l);
  const open = l.filter((t) => t.status !== "done"), done = l.filter((t) => t.status === "done");
  const canP = p && (st.isAdmin() || p.owner_id === S.me || p.created_by === S.me);
  const list = projTab === "open" ? taskList(open, { project: false, empty: "Keine offenen Aufgaben." })
    : projTab === "done" ? taskList(done, { project: false, group: false, empty: "Noch nichts erledigt." })
    : taskList(st.sortTasks(l), { project: false, group: false });
  return {
    title: p ? p.name : "Allgemein", sub: "Projekt", back: "#/projekte",
    html: `<div class="page-h"><h1>${esc(p ? p.name : "Allgemein")}${p?.archived ? ' <span class="chip">archiviert</span>' : ""}</h1>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${canP ? `<button class="btn" id="pe">${i("edit")}Bearbeiten</button>
          <button class="btn" id="pa">${i("archive")}${p.archived ? "Wiederherstellen" : "Archivieren"}</button>` : ""}
          <button class="btn red" data-new>${i("plus")}Aufgabe</button></div></div>
      <div class="card" style="margin-bottom:12px"><div class="phead">${ring(g.pct)}<div class="info">
        <div><span class="muted">Erledigt:</span> ${g.done} von ${g.total}</div>
        ${p ? `<div style="display:flex;gap:6px;align-items:center"><span class="muted">Verantwortlich:</span> ${p.owner_id ? avatar(p.owner_id) + " " + esc(st.profile(p.owner_id)?.name || "") : "–"}</div>
        <div><span class="muted">Enddatum:</span> ${p.due_date ? fmtDate(p.due_date) : "–"}</div>` : `<div class="muted">Aufgaben ohne Projekt</div>`}
      </div></div>${p?.description ? `<div class="desc">${esc(p.description)}</div>` : ""}</div>
      <div style="margin-bottom:10px">${seg([["open", `Offen · ${open.length}`], ["done", `Erledigt · ${done.length}`], ["all", "Alle"]], projTab, "pt")}</div>
      <div class="card list-cards">${list}</div>`,
    after(r) {
      bindList(r);
      r.querySelectorAll("[data-pt]").forEach((b) => b.onclick = () => { projTab = b.dataset.pt; route(); });
      const pe = r.querySelector("#pe"); if (pe) pe.onclick = () => openProjectForm(p);
      const pa = r.querySelector("#pa"); if (pa) pa.onclick = async () => {
        if (!p.archived && open.length && !confirm(`Es sind noch ${open.length} Aufgaben offen. Trotzdem archivieren?`)) return;
        await st.archiveProject(p.id, !p.archived); toast(p.archived ? "Wiederhergestellt" : "Archiviert");
      };
    },
  };
}

function vTask(id) {
  const t = st.task(id);
  if (!t) return { title: "Aufgabe", back: "#/aufgaben", html: `<div class="empty">Aufgabe nicht gefunden oder gelöscht.</div>`, noFab: true };
  const p = t.project_id ? st.project(t.project_id) : null;
  const ck = st.checklistOf(id), cm = st.commentsOf(id), can = st.canEdit(t);
  const due = fmtDue(t.due_date);
  const reviewBox = t.status === "review"
    ? (t.created_by === S.me
      ? `<div class="review-box">${i("eye")}<div style="flex:1">${esc(st.profile(t.done_by)?.name || "Jemand")} hat die Aufgabe erledigt. Bitte bestätigen.</div>
         <button class="btn red sm" id="ap">${i("tick")}Bestätigen</button><button class="btn sm" id="rj">${i("undo")}Zurückgeben</button></div>`
      : `<div class="review-box">${i("eye")}<div>Erledigt – wartet auf Bestätigung durch ${esc(st.profile(t.created_by)?.name || "den Ersteller")}.</div></div>`)
    : "";
  return {
    title: t.title, sub: p ? p.name : "Allgemein", back: p ? `#/projekt/${p.id}` : "#/aufgaben", noFab: true,
    html: `<div class="detail">
      <div class="card">
        <div class="dhead">${cbHtml(t)}<div style="flex:1;min-width:0"><h2 class="${t.status === "done" ? "strike" : ""}">${esc(t.title)}</h2>
          <div class="muted" style="font-size:13px;margin-top:4px">${t.status === "done" ? `Erledigt ${t.done_at ? fmtTime(t.done_at) : ""}${t.done_by ? " von " + esc(st.profile(t.done_by)?.name || "") : ""}` : t.status === "review" ? "Zur Prüfung" : "Offen"}</div></div>
          ${can ? `<button class="btn ghost sm" id="ed" title="Bearbeiten">${i("edit")}</button>` : ""}</div>
        ${reviewBox}
        ${t.description ? `<div class="desc">${esc(t.description)}</div>` : ""}
        <div class="section"><h4>Checkliste ${ck.length ? `· ${ck.filter((c) => c.done).length}/${ck.length}` : ""}</h4>
          ${ck.map((c) => `<div class="ck"><button class="cb ${c.done ? "done" : ""}" data-ck="${c.id}" ${can ? "" : "disabled"}>${c.done ? i("tick") : ""}</button>
            <span class="${c.done ? "strike" : ""}">${esc(c.text)}</span>${can ? `<button class="x" data-ckdel="${c.id}" title="Entfernen">${i("x", "width:15px;height:15px")}</button>` : ""}</div>`).join("") || `<div class="muted" style="font-size:13px">Keine Punkte.</div>`}
          ${can ? `<form class="addline" id="ckf"><input id="ckin" placeholder="Punkt hinzufügen …" autocomplete="off"><button class="btn sm">${i("plus", "width:14px;height:14px")}</button></form>` : ""}</div>
        <div class="section"><h4>Kommentare ${cm.length ? "· " + cm.length : ""}</h4>
          ${cm.map((c) => `<div class="cmt">${avatar(c.user_id)}<div class="bub"><div class="who">${esc(st.profile(c.user_id)?.name || "")} · ${fmtTime(c.created_at)}
            ${c.user_id === S.me || st.isAdmin() ? ` · <a href="#" data-cmdel="${c.id}">löschen</a>` : ""}</div>${esc(c.body)}</div></div>`).join("")}
          <form class="addline" id="cmf"><input id="cmin" placeholder="Kommentar schreiben …" autocomplete="off"><button class="btn red sm">Senden</button></form></div>
      </div>
      <div class="card">
        <div class="kv">
          <span class="k">Projekt</span><span>${p ? `<a href="#/projekt/${p.id}">${esc(p.name)}</a>` : "Allgemein"}</span>
          <span class="k">Frist</span><span class="${due.over && t.status !== "done" ? "over" : ""}">${t.due_date ? fmtDate(t.due_date) + (due.today ? " (heute)" : "") : "–"}</span>
          <span class="k">Priorität</span><span style="display:flex;gap:6px;align-items:center"><span class="prio p${t.priority}"></span>${PRIO[t.priority]}</span>
          <span class="k">Zuständig</span><span style="display:flex;flex-direction:column;gap:4px">${st.assigneesOf(id).map((u) => `<span style="display:flex;gap:6px;align-items:center">${avatar(u)}${esc(st.profile(u)?.name || "")}</span>`).join("") || "–"}</span>
          <span class="k">Erstellt von</span><span>${esc(st.profile(t.created_by)?.name || "–")}</span>
          <span class="k">Erstellt am</span><span>${fmtTime(t.created_at)}</span>
          <span class="k">Bestätigung</span><span>${t.needs_approval ? "Ersteller bestätigt" : "nicht nötig"}</span>
        </div>
        <div class="section"><h4>Verlauf</h4><div id="log" class="log">lädt …</div></div>
        ${t.created_by === S.me || st.isAdmin() ? `<div class="section"><button class="btn sm danger" id="del">${i("trash")}Aufgabe löschen</button></div>` : ""}
      </div></div>`,
    after(r) {
      bindList(r);
      const q = (s) => r.querySelector(s);
      if (q("#ed")) q("#ed").onclick = () => openTaskForm(t);
      if (q("#ap")) q("#ap").onclick = async () => { await st.setStatus(id, "done"); toast("Bestätigt ✓"); };
      if (q("#rj")) q("#rj").onclick = async () => {
        const why = prompt("Was fehlt noch? (optional)");
        if (why === null) return;
        if (why.trim()) await st.addComment(id, "Zurückgegeben: " + why.trim());
        await st.setStatus(id, "open"); toast("Zurückgegeben");
      };
      r.querySelectorAll("[data-ck]").forEach((b) => b.onclick = () => st.toggleChecklist(S.checklist.find((c) => c.id === b.dataset.ck)));
      r.querySelectorAll("[data-ckdel]").forEach((b) => b.onclick = () => st.deleteChecklist(b.dataset.ckdel));
      r.querySelectorAll("[data-cmdel]").forEach((b) => b.onclick = (e) => { e.preventDefault(); if (confirm("Kommentar löschen?")) st.deleteComment(b.dataset.cmdel); });
      if (q("#ckf")) q("#ckf").onsubmit = async (e) => { e.preventDefault(); const v = q("#ckin").value.trim(); if (v) { q("#ckin").value = ""; await st.addChecklist(id, v); q("#ckin")?.focus(); } };
      q("#cmf").onsubmit = async (e) => { e.preventDefault(); const v = q("#cmin").value.trim(); if (v) { q("#cmin").value = ""; await st.addComment(id, v); } };
      if (q("#del")) q("#del").onclick = async () => {
        if (!confirm("Aufgabe endgültig löschen?")) return;
        await st.deleteTask(id); toast("Gelöscht"); location.hash = p ? `#/projekt/${p.id}` : "#/aufgaben";
      };
      const ACT = { created: "angelegt", done: "abgehakt", review: "erledigt, zur Prüfung", approved: "bestätigt", reopened: "wieder geöffnet" };
      st.taskEvents(id).then((ev) => {
        const el = q("#log"); if (!el) return;
        el.innerHTML = ev.map((e) => `<div class="log">${fmtTime(e.created_at)} – ${esc(st.profile(e.user_id)?.name || "System")} hat ${ACT[e.action] || e.action}</div>`).join("") || "–";
      }).catch(() => {});
    },
  };
}

function vReview() {
  const wait = st.waitingForMe();
  return {
    title: "Zur Prüfung",
    html: `<div class="page-h"><h1>Zur Prüfung</h1></div>
      <p class="muted" style="margin-bottom:12px">Von dir angelegte Aufgaben, die erledigt wurden und auf deine Bestätigung warten.</p>
      <div class="card list-cards">${taskList(wait, { group: false, empty: "Nichts zu prüfen." })}</div>`,
    after: bindList,
  };
}

function vArchive() {
  const arch = S.projects.filter((p) => p.archived);
  const done = S.tasks.filter((t) => t.status === "done").sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "")).slice(0, 40);
  return {
    title: "Archiv",
    html: `<div class="page-h"><h1>Archiv</h1></div>
      <h3 style="font-size:15px;margin:4px 2px 10px">Abgeschlossene Projekte</h3>
      ${arch.length ? `<div class="pgrid" style="margin-bottom:20px">${arch.map(projectCard).join("")}</div>` : `<div class="card empty" style="margin-bottom:20px">Keine archivierten Projekte.</div>`}
      <h3 style="font-size:15px;margin:4px 2px 10px">Zuletzt erledigt</h3>
      <div class="card list-cards">${taskList(done, { group: false, empty: "Noch nichts erledigt." })}</div>`,
    after: bindList,
  };
}

function vNotifications() {
  const n = S.notifications;
  return {
    title: "Benachrichtigungen",
    html: `<div class="page-h"><h1>Benachrichtigungen</h1>${n.some((x) => !x.read_at) ? `<button class="btn sm" id="ar">Alle als gelesen markieren</button>` : ""}</div>
      ${pushNote()}
      <div class="card">${n.map((x) => `<div class="nrow ${x.read_at ? "" : "unread"}" data-n="${x.id}"><div style="flex:1;min-width:0">
        <div class="nt">${esc(x.title)}</div><div class="nb">${esc(x.body || "")}</div></div><div class="nd">${fmtTime(x.created_at)}</div></div>`).join("") || `<div class="empty">Keine Benachrichtigungen.</div>`}</div>`,
    after(r) {
      bindPushNote(r);
      const ar = r.querySelector("#ar"); if (ar) ar.onclick = () => st.markAllRead();
      r.querySelectorAll("[data-n]").forEach((el) => el.onclick = async () => {
        const x = S.notifications.find((y) => String(y.id) === el.dataset.n);
        await st.markRead(x.id);
        if (x.task_id) location.hash = "#/aufgabe/" + x.task_id;
      });
    },
  };
}

function vMore() {
  const w = st.waitingForMe().length, u = st.unreadCount();
  const l = (h, ic, t, b) => `<a href="${h}">${i(ic)}<span>${t}</span>${b ? `<span class="badge">${b}</span>` : ""}</a>`;
  return {
    title: "Mehr", noFab: true,
    html: `<div class="card mlist">${l("#/alle", "list", "Alle Aufgaben")}${l("#/pruefung", "eye", "Zur Prüfung", w)}${l("#/archiv", "archive", "Archiv")}
      ${l("#/mitteilungen", "bell", "Benachrichtigungen", u)}${st.isAdmin() ? l("#/nutzer", "users", "Nutzer verwalten") : ""}${l("#/einstellungen", "gear", "Einstellungen")}</div>
      <form class="card" id="ms" style="margin-top:12px;padding:12px;display:flex;gap:8px"><input class="inp" name="q" placeholder="Suchen …"><button class="btn">${i("search")}</button></form>`,
    after(r) { r.querySelector("#ms").onsubmit = (e) => { e.preventDefault(); const q = e.target.q.value.trim(); if (q) location.hash = "#/suche/" + encodeURIComponent(q); }; },
  };
}

function vSearch(q) {
  const s = q.toLowerCase();
  const ts = S.tasks.filter((t) => (t.title + " " + (t.description || "")).toLowerCase().includes(s));
  const ps = S.projects.filter((p) => (p.name + " " + (p.description || "")).toLowerCase().includes(s));
  return {
    title: `Suche: ${q}`, back: "#/",
    html: `<div class="page-h"><h1>Suche: „${esc(q)}“</h1></div>
      ${ps.length ? `<div class="pgrid" style="margin-bottom:16px">${ps.map(projectCard).join("")}</div>` : ""}
      <div class="card list-cards">${taskList(st.sortTasks(ts), { group: false, empty: "Keine Treffer." })}</div>`,
    after: bindList,
  };
}

function vUsers() {
  if (!st.isAdmin()) return { title: "Nutzer", html: `<div class="empty">Nur für Admins.</div>` };
  return {
    title: "Nutzer", noFab: true,
    html: `<div class="page-h"><h1>Nutzer</h1><button class="btn red" id="inv">${i("plus")}Nutzer anlegen</button></div>
      <div class="card">${S.profiles.map((p) => `<div class="trow urow" style="cursor:default">${avatar(p.id, "lg")}
        <div class="tt"><div class="ti">${esc(p.name)} ${p.id === S.me ? '<span class="chip">du</span>' : ""} ${p.is_admin ? '<span class="chip">Admin</span>' : ""} ${p.active ? "" : '<span class="chip" style="color:var(--accent)">gesperrt</span>'}</div>
          <div class="meta">${esc(p.email || "")}</div></div>
        ${p.id === S.me ? "" : `<div class="uacts">
          <button class="btn sm" data-pw="${p.id}">Passwort</button>
          <button class="btn sm" data-adm="${p.id}">${p.is_admin ? "Admin entziehen" : "Zum Admin machen"}</button>
          <button class="btn sm ${p.active ? "danger" : ""}" data-act="${p.id}">${p.active ? "Sperren" : "Entsperren"}</button></div>`}</div>`).join("")}</div>
      <p class="muted" style="font-size:13px;margin-top:10px">Neue Nutzer bekommen ein Startpasswort. Nach dem Anlegen kannst du die Zugangsdaten per „Teilen“ verschicken.</p>`,
    after(r) {
      r.querySelector("#inv").onclick = openInviteForm;
      r.querySelectorAll("[data-pw]").forEach((b) => b.onclick = () => openPasswordForm(st.profile(b.dataset.pw)));
      r.querySelectorAll("[data-adm]").forEach((b) => b.onclick = async () => {
        const p = st.profile(b.dataset.adm);
        try { await st.updateProfile(p.id, { is_admin: !p.is_admin }); toast("Gespeichert"); } catch (e) { toast(e.message); }
      });
      r.querySelectorAll("[data-act]").forEach((b) => b.onclick = async () => {
        const p = st.profile(b.dataset.act);
        if (p.active && !confirm(`${p.name} sperren? Die Person kann sich dann nicht mehr anmelden.`)) return;
        try { await st.adminAction({ action: p.active ? "deactivate" : "activate", user_id: p.id }); toast(p.active ? "Gesperrt" : "Entsperrt"); } catch (e) { toast(e.message); }
      });
    },
  };
}

function vSettings() {
  const ps = pushState();
  const pushTxt = {
    on: "Aktiv auf diesem Gerät.", off: "Auf diesem Gerät noch nicht aktiviert.", denied: "Im Browser blockiert. Bitte in den Browser-/Geräteeinstellungen für diese Seite erlauben.",
    unsupported: "Dieser Browser unterstützt keine Push-Nachrichten.", "ios-install": "Auf dem iPhone/iPad zuerst über Teilen → „Zum Home-Bildschirm“ installieren und die App von dort öffnen.",
  }[ps];
  const me = S.profile;
  return {
    title: "Einstellungen", noFab: true,
    html: `<div class="page-h"><h1>Einstellungen</h1></div>
      <div class="cols cols2">
      <form class="card" id="pf"><div class="card-h"><h3>Mein Profil</h3></div><div style="padding:18px">
        <div class="field"><label>Name</label><input name="name" value="${esc(me.name)}" required></div>
        <div class="field"><label>Farbe</label><div class="pick">${COLORS.map((c) => `<label style="padding:4px"><input type="radio" name="color" value="${c}" ${c === me.color ? "checked" : ""}><span class="av" style="background:${c}">${esc(initials(me.name))}</span></label>`).join("")}</div></div>
        <div class="field"><label>E-Mail</label><input value="${esc(me.email || "")}" disabled></div>
        <button class="btn red">Speichern</button></div></form>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card"><div class="card-h"><h3>Erinnerungen (Push)</h3></div><div style="padding:18px">
          <p style="margin-bottom:12px">${pushTxt}</p>
          ${ps === "off" ? `<button class="btn red" id="pon">${i("bell")}Auf diesem Gerät aktivieren</button>` : ""}
          ${ps === "on" ? `<button class="btn" id="poff">Auf diesem Gerät abschalten</button>` : ""}
          <p class="muted" style="font-size:12px;margin-top:12px">Erinnerungen kommen bei neuer Zuweisung, 2 Tage vor der Frist, am Fälligkeitstag und täglich bei Überfälligkeit (Mo–Fr um 7 Uhr), außerdem bei Erledigung und neuen Kommentaren.</p></div></div>
        <form class="card" id="pwf"><div class="card-h"><h3>Passwort ändern</h3></div><div style="padding:18px">
          <div class="field"><label>Neues Passwort (mind. 8 Zeichen)</label><input type="password" name="a" minlength="8" autocomplete="new-password" required></div>
          <button class="btn">Passwort ändern</button></div></form>
        <div class="card" style="padding:18px;display:flex;justify-content:space-between;align-items:center">
          <span class="muted" style="font-size:12px">Nordbeck To-Do · Version ${APP_VERSION}<br><span id="diag" style="font-size:11px"></span></span><button class="btn" id="lo">${i("logout")}Abmelden</button></div>
      </div></div>`,
    after(r) {
      r.querySelector("#pf").onsubmit = async (e) => {
        e.preventDefault(); const f = e.target;
        try { await st.updateProfile(S.me, { name: f.name.value.trim(), color: f.color.value }); toast("Gespeichert"); } catch (er) { toast(er.message); }
      };
      r.querySelector("#pwf").onsubmit = async (e) => {
        e.preventDefault();
        const { error } = await sb.auth.updateUser({ password: e.target.a.value });
        toast(error ? error.message : "Passwort geändert"); if (!error) e.target.reset();
      };
      const on = r.querySelector("#pon"); if (on) on.onclick = async () => { await enablePush(); route(); };
      const off = r.querySelector("#poff"); if (off) off.onclick = async () => { await disablePush(); route(); };
      const pr = document.createElement("div");
      pr.style.cssText = "position:fixed;top:0;left:0;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)";
      document.body.appendChild(pr); const cs = getComputedStyle(pr);
      r.querySelector("#diag").textContent = `Technik: ${innerWidth}×${innerHeight} · Bildschirm ${screen.width}×${screen.height} · oben ${cs.paddingTop} unten ${cs.paddingBottom} · var ${getComputedStyle(document.documentElement).getPropertyValue("--safe-t") || "-"} · ios ${isIOS()} · app ${isStandalone()} · mode ${["standalone","fullscreen","minimal-ui","browser"].find((m) => matchMedia("(display-mode: " + m + ")").matches)} · dpr ${devicePixelRatio} · klassen ${document.documentElement.className}`;
      pr.remove();
      r.querySelector("#lo").onclick = async () => { await disablePush(true); await sb.auth.signOut(); };
    },
  };
}

// =====================================================================
// Formulare (Modal)
// =====================================================================
function modal(title, body, foot, onMount) {
  $modal.innerHTML = `<div class="modal-bg"><form class="modal" novalidate><div class="card-h"><h3>${esc(title)}</h3>
    <button type="button" class="btn ghost sm" data-close aria-label="Schließen">${i("x")}</button></div><div class="mb">${body}</div><div class="mf">${foot}</div></form></div>`;
  const bg = $modal.firstElementChild, f = bg.querySelector("form");
  const close = () => { $modal.innerHTML = ""; document.removeEventListener("keydown", esc_); };
  const esc_ = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", esc_);
  bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
  bg.querySelectorAll("[data-close]").forEach((b) => b.onclick = close);
  onMount(f, close);
  setTimeout(() => f.querySelector("input,textarea")?.focus(), 50);
}

function openTaskForm(t, preset = {}) {
  const edit = !!t;
  const d = t || { title: "", description: "", project_id: preset.project_id || "", due_date: "", priority: 2, needs_approval: false };
  const ass = edit ? st.assigneesOf(t.id) : [S.me];
  const projs = st.activeProjects();
  if (d.project_id && !projs.find((p) => p.id === d.project_id)) { const pp = st.project(d.project_id); if (pp) projs.push(pp); }
  modal(edit ? "Aufgabe bearbeiten" : "Neue Aufgabe", `
    <div class="err hidden" id="fe"></div>
    <div class="field"><label>Titel *</label><input name="title" value="${esc(d.title)}" maxlength="200" required></div>
    <div class="field"><label>Beschreibung</label><textarea name="description">${esc(d.description || "")}</textarea></div>
    <div class="row2">
      <div class="field"><label>Projekt</label><select name="project_id"><option value="">Allgemein (ohne Projekt)</option>
        ${projs.map((p) => `<option value="${p.id}" ${p.id === d.project_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Frist</label><input type="date" name="due_date" value="${d.due_date || ""}"></div>
    </div>
    <div class="field"><label>Priorität</label><div class="pick">${[1, 2, 3].map((p) => `<label><input type="radio" name="priority" value="${p}" ${p === d.priority ? "checked" : ""}><span class="prio p${p}" style="margin-left:6px"></span>${PRIO[p]}</label>`).join("")}</div></div>
    <div class="field"><label>Zuständig</label><div class="pick">${st.activeProfiles().map((p) => `<label><input type="checkbox" name="ass" value="${p.id}" ${ass.includes(p.id) ? "checked" : ""}>${avatar(p.id)}${esc(p.name)}</label>`).join("")}</div></div>
    ${edit ? "" : `<div class="field"><label>Checkliste (ein Punkt pro Zeile, optional)</label><textarea name="ck" style="min-height:70px"></textarea></div>`}
    <label class="check"><input type="checkbox" name="needs_approval" ${d.needs_approval ? "checked" : ""}> Erledigung muss von mir bestätigt werden</label>`,
    `<button type="button" class="btn" data-close>Abbrechen</button><button class="btn red" id="sv">${edit ? "Speichern" : "Anlegen"}</button>`,
    (f, close) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const fe = f.querySelector("#fe");
        const data = {
          title: f.title.value.trim(), description: f.description.value.trim(), project_id: f.project_id.value,
          due_date: f.due_date.value, priority: Number(f.priority.value), needs_approval: f.needs_approval.checked,
        };
        const a = [...f.querySelectorAll("[name=ass]:checked")].map((x) => x.value);
        if (!data.title) { fe.textContent = "Bitte einen Titel eingeben."; return fe.classList.remove("hidden"); }
        if (!a.length) { fe.textContent = "Bitte mindestens eine Person zuweisen."; return fe.classList.remove("hidden"); }
        const b = f.querySelector("#sv"); b.disabled = true;
        try {
          if (edit) { await st.updateTask(t.id, data, a); toast("Gespeichert"); close(); }
          else {
            const ck = (f.ck.value || "").split("\n").map((s) => s.trim()).filter(Boolean);
            const nt = await st.createTask(data, a, ck); toast("Aufgabe angelegt"); close();
            if (!location.hash.startsWith("#/projekt/")) location.hash = "#/aufgabe/" + nt.id;
          }
        } catch (er) { b.disabled = false; fe.textContent = er.message; fe.classList.remove("hidden"); }
      };
    });
}

function openProjectForm(p) {
  const edit = !!p;
  const d = p || { name: "", description: "", owner_id: S.me, due_date: "" };
  modal(edit ? "Projekt bearbeiten" : "Neues Projekt", `
    <div class="err hidden" id="fe"></div>
    <div class="field"><label>Name *</label><input name="name" value="${esc(d.name)}" maxlength="120" required></div>
    <div class="field"><label>Beschreibung</label><textarea name="description">${esc(d.description || "")}</textarea></div>
    <div class="row2">
      <div class="field"><label>Verantwortlich</label><select name="owner_id"><option value="">–</option>
        ${st.activeProfiles().map((u) => `<option value="${u.id}" ${u.id === d.owner_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Enddatum</label><input type="date" name="due_date" value="${d.due_date || ""}"></div>
    </div>`,
    `${edit && (st.isAdmin() || p.created_by === S.me) ? `<button type="button" class="btn danger" id="pd" style="margin-right:auto">${i("trash")}Löschen</button>` : ""}
     <button type="button" class="btn" data-close>Abbrechen</button><button class="btn red" id="sv">${edit ? "Speichern" : "Anlegen"}</button>`,
    (f, close) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const data = { name: f.name.value.trim(), description: f.description.value.trim() || null, owner_id: f.owner_id.value || null, due_date: f.due_date.value || null };
        const fe = f.querySelector("#fe");
        if (!data.name) { fe.textContent = "Bitte einen Namen eingeben."; return fe.classList.remove("hidden"); }
        try {
          if (edit) { await st.updateProject(p.id, data); toast("Gespeichert"); close(); }
          else { const np = await st.createProject(data); toast("Projekt angelegt"); close(); location.hash = "#/projekt/" + np.id; }
        } catch (er) { fe.textContent = er.message; fe.classList.remove("hidden"); }
      };
      const pd = f.querySelector("#pd");
      if (pd) pd.onclick = async () => {
        const n = st.tasksOfProject(p.id).length;
        if (!confirm(`Projekt „${p.name}“ endgültig löschen?${n ? ` Dabei werden auch ${n} Aufgaben gelöscht.` : ""}`)) return;
        await st.deleteProject(p.id); close(); toast("Projekt gelöscht"); location.hash = "#/projekte";
      };
    });
}

function randomPw() {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint32Array(10));
  return [...r].map((x) => a[x % a.length]).join("");
}
function openInviteForm() {
  const pw = randomPw();
  modal("Nutzer anlegen", `
    <div class="err hidden" id="fe"></div>
    <div class="field"><label>Name *</label><input name="name" required placeholder="Vor- und Nachname"></div>
    <div class="field"><label>E-Mail *</label><input type="email" name="email" required></div>
    <div class="field"><label>Startpasswort *</label><input name="password" value="${pw}" minlength="8" required></div>
    <p class="muted" style="font-size:13px">Nach dem Anlegen kannst du die Zugangsdaten direkt per WhatsApp, Mail o. Ä. teilen. Das Passwort lässt sich später unter Einstellungen ändern.</p>`,
    `<button type="button" class="btn" data-close>Abbrechen</button><button class="btn red" id="sv">Anlegen</button>`,
    (f, close) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const fe = f.querySelector("#fe"), b = f.querySelector("#sv");
        const name = f.name.value.trim(), email = f.email.value.trim(), password = f.password.value;
        if (!name || !email.includes("@") || password.length < 8) { fe.textContent = "Bitte Name, E-Mail und ein Passwort mit mind. 8 Zeichen angeben."; return fe.classList.remove("hidden"); }
        b.disabled = true;
        try {
          await st.adminAction({ action: "create", name, email, password });
          close();
          shareAccess(name, email, password, true);
        } catch (er) { b.disabled = false; fe.textContent = er.message; fe.classList.remove("hidden"); }
      };
    });
}
function accessText(name, email, password, isNew) {
  const first = (name || "").split(" ")[0];
  return `Hallo ${first},

${isNew ? "für dich ist ein Zugang zur Nordbeck To-Do App eingerichtet." : "dein Passwort für die Nordbeck To-Do App wurde zurückgesetzt."}

App: ${location.origin}/
E-Mail: ${email}
Passwort: ${password}

${isNew ? `So richtest du die App ein:
1. Link öffnen und anmelden
2. iPhone: Teilen → „Zum Home-Bildschirm“ · Android: Menü ⋮ → „App installieren“
3. App über das neue Symbol öffnen und Erinnerungen erlauben

` : ""}Das Passwort kannst du in der App unter Einstellungen ändern.`;
}
function shareAccess(name, email, password, isNew) {
  const text = accessText(name, email, password, isNew);
  modal(isNew ? "Nutzer angelegt" : "Passwort zurückgesetzt", `
    <p style="margin-bottom:12px">Schick ${esc(name)} die Zugangsdaten:</p>
    <div class="card" style="padding:12px 14px;line-height:1.9;margin-bottom:12px"><div><span class="muted">App:</span> ${esc(location.host)}</div>
      <div><span class="muted">E-Mail:</span> ${esc(email)}</div><div><span class="muted">Passwort:</span> <b>${esc(password)}</b></div></div>
    <p class="muted" style="font-size:13px">„Teilen“ öffnet die Auswahl deines Geräts (WhatsApp, Mail, SMS …). Der Text enthält auch eine kurze Einrichtungsanleitung.</p>`,
    `<button type="button" class="btn" id="cp">Kopieren</button>${navigator.share ? `<button type="button" class="btn red" id="sh">${i("share")}Teilen</button>` : ""}<button type="button" class="btn${navigator.share ? "" : " red"}" data-close>Fertig</button>`,
    (f) => {
      f.onsubmit = (e) => e.preventDefault();
      f.querySelector("#cp").onclick = async () => {
        try { await navigator.clipboard.writeText(text); toast("Kopiert – jetzt z. B. in WhatsApp einfügen"); }
        catch (_) { prompt("Zum Kopieren markieren:", text); }
      };
      const sh = f.querySelector("#sh");
      if (sh) sh.onclick = async () => { try { await navigator.share({ title: "Zugang Nordbeck To-Do", text }); } catch (_) { /* abgebrochen */ } };
    });
}
function openPasswordForm(p) {
  const pw = randomPw();
  modal(`Passwort für ${p.name} zurücksetzen`, `
    <div class="err hidden" id="fe"></div>
    <div class="field"><label>Neues Passwort</label><input name="password" value="${pw}" minlength="8" required></div>
    <p class="muted" style="font-size:13px">Nach dem Speichern kannst du die Zugangsdaten direkt per WhatsApp, Mail o. Ä. teilen.</p>`,
    `<button type="button" class="btn" data-close>Abbrechen</button><button class="btn red" id="sv">Speichern</button>`,
    (f, close) => {
      f.onsubmit = async (e) => {
        e.preventDefault();
        const fe = f.querySelector("#fe");
        try { await st.adminAction({ action: "password", user_id: p.id, password: f.password.value }); close(); shareAccess(p.name, p.email, f.password.value, false); }
        catch (er) { fe.textContent = er.message; fe.classList.remove("hidden"); }
      };
    });
}

// =====================================================================
// Push
// =====================================================================
let pushCache = null;
function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return isIOS() && !isStandalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted" && pushCache) return "on";
  return "off";
}
async function refreshPushCache() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    pushCache = sub && Notification.permission === "granted" ? sub : null;
    if (pushCache && S.me) await st.savePushSubscription(pushCache).catch(() => {});
  } catch (_) { pushCache = null; }
}
async function enablePush(silent) {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("Benachrichtigungen wurden nicht erlaubt.");
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToUint8(VAPID_PUBLIC_KEY) });
    await st.savePushSubscription(sub);
    pushCache = sub;
    if (!silent) toast("Erinnerungen aktiviert ✓");
  } catch (e) { toast("Aktivieren fehlgeschlagen: " + e.message); }
}
async function disablePush(silent) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await st.deletePushSubscription(sub.endpoint); await sub.unsubscribe(); }
    pushCache = null;
    if (!silent) toast("Erinnerungen auf diesem Gerät abgeschaltet");
  } catch (_) { /* */ }
}
if ("serviceWorker" in navigator && "PushManager" in window) {
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "open" && e.data.url) location.hash = e.data.url.replace(/^.*#/, "#"); });
}

// Erinnerungen standardmäßig an: Ist die Erlaubnis schon erteilt, wird das Gerät automatisch angemeldet.
// Sonst fragt die App nach dem Start einmal nach (Browser verlangen dafür einen Tipp des Nutzers).
async function autoPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !S.me) return;
  if (Notification.permission === "granted" && !pushCache) await enablePush(true);
  if (pushState() === "off" && !sessionStorage.getItem("pushAsked")) {
    sessionStorage.setItem("pushAsked", "1");
    modal("Erinnerungen einschalten", `<div style="display:flex;gap:14px;align-items:flex-start">${i("bell", "width:30px;height:30px;color:var(--accent);flex:none")}
      <p>Damit du an Fristen und neue Aufgaben erinnert wirst, braucht die App einmalig deine Erlaubnis für Mitteilungen.</p></div>`,
      `<button type="button" class="btn" data-close>Später</button><button class="btn red" id="pa">Einschalten</button>`,
      (f, close) => { f.onsubmit = async (e) => { e.preventDefault(); close(); await enablePush(); route(); }; });
  }
}
boot().then(async () => {
  if ("serviceWorker" in navigator && "PushManager" in window) { await refreshPushCache(); await autoPush(); if (shellReady) route(); }
});
