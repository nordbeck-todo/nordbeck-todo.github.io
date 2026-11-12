// Nordbeck To-Do – Hauptprogramm
import { sb } from "./supabase.js";
import { VAPID_PUBLIC_KEY, APP_VERSION } from "./config.js";
import {
  i, esc, fmtDate, fmtDue, fmtTime, initials, greeting, longDate, toast, b64uToUint8, isIOS, isStandalone, COLORS, daysUntil, todayStr,
} from "./util.js";
import * as st from "./store.js";
import { NEUERUNGEN, fassungKleiner } from "./neuerungen.js";
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
// Globaler Umschalter wie in HERO: „Eigene anzeigen“ / „Alle anzeigen“ / eine Person (ab v1.0.31)
// Gilt für Übersicht, Aufgaben, Projekte, Kalender, Ideen, Zur Prüfung und Archiv; bleibt pro Gerät gespeichert.
// =====================================================================
const WHO = { v: (() => { try { return localStorage.getItem("taskWho") || "me"; } catch (_) { return "me"; } })() };
function setWho(w) { WHO.v = w; try { localStorage.setItem("taskWho", w); } catch (_) { /* */ } }
/** Ausgewählte Person (id) oder null bei „Alle anzeigen“; unbekannte/gesperrte Person fällt auf „Eigene“ zurück */
function whoId() {
  if (WHO.v === "all") return null;
  if (WHO.v !== "me" && !st.activeProfiles().some((p) => p.id === WHO.v && p.id !== S.me)) WHO.v = "me";
  return WHO.v === "me" ? S.me : WHO.v;
}
const whoAll = () => whoId() === null;
const whoMe = () => whoId() === S.me;
const whoFirst = () => (st.profile(whoId())?.name || "").split(" ")[0];
/** Aufgabe gehört zur Auswahl: zuständig – oder Ersteller einer Aufgabe, die auf seine Bestätigung wartet */
function whoTask(t) {
  const u = whoId();
  return !u || st.assigneesOf(t.id).includes(u) || (t.created_by === u && t.status === "review");
}
/** Projekt gehört zur Auswahl: verantwortlich, angelegt oder mindestens eine Aufgabe darin */
function whoProject(p) {
  const u = whoId();
  if (!u) return true;
  if (!p) return st.tasksOfProject("allgemein").some(whoTask);
  return p.owner_id === u || p.created_by === u || st.tasksOfProject(p.id).some(whoTask);
}
function whoSelect(id) {
  const others = st.activeProfiles().filter((p) => p.id !== S.me);
  const cur = whoAll() ? "all" : whoMe() ? "me" : WHO.v;
  const opt = (v, l) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
  return `<select class="inp whosel" id="${id}" data-who aria-label="Wessen Aufgaben und Projekte">${opt("me", "Eigene anzeigen")}${opt("all", "Alle anzeigen")}
    ${others.length ? `<optgroup label="Person">${others.map((p) => opt(p.id, p.name)).join("")}</optgroup>` : ""}</select>`;
}
/** Hinweis, wenn durch die Auswahl etwas ausgeblendet ist */
function whoHidden(n, what) {
  if (!n || whoAll()) return "";
  return `<p class="muted whohint">${n} ${what} anderer ${n === 1 ? "ist" : "sind"} ausgeblendet – oben „Alle anzeigen“ wählen.</p>`;
}

// =====================================================================
// Grundgerüst
// =====================================================================
const NAV = [
  ["#/", "home", "Übersicht"], ["#/aufgaben", "check", "Aufgaben", () => st.myOpen().length],
  ["#/kalender", "cal", "Kalender"], ["#/projekte", "folder", "Projekte"], ["#/ideen", "bulb", "Ideen"],
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
    <a href="#" class="foot" data-news title="Was ist neu">Nordbeck To-Do · v${APP_VERSION}</a>
  </aside>
  <header class="top">
    <form class="search" id="ts">${i("search")}<input placeholder="Aufgaben und Projekte durchsuchen …" name="q"></form>
    <span id="twho" class="twho"></span>
    <button class="btn red" data-newmenu aria-haspopup="menu">${i("plus")}Neu</button>
    <a class="iconbtn" href="#/mitteilungen" title="Benachrichtigungen">${i("bell")}<span class="badge hidden" id="tbadge"></span></a>
    <a href="#/einstellungen" title="Einstellungen" id="tav"></a>
  </header>
  <header class="mhead" id="mhead"></header>
  <main class="main" id="main"></main>
  <nav class="mnav" id="mnav"></nav>
  <button class="fab" data-newmenu aria-haspopup="menu" aria-label="Neu anlegen">${i("plus")}</button>
  <div class="newmenu hidden" id="newmenu" role="menu">
    <button type="button" role="menuitem" data-nm="task">${i("check")}<span><b>Aufgabe</b><small>mit Frist und Zuständigen</small></span></button>
    <button type="button" role="menuitem" data-nm="idea">${i("bulb")}<span><b>Idee</b><small>nur festhalten, später übernehmen</small></span></button>
    <button type="button" role="menuitem" data-nm="project">${i("folder")}<span><b>Projekt</b><small>mehrere Aufgaben bündeln</small></span></button>
  </div>
  <div class="newmenu-bg hidden" id="newmenu-bg"></div>`;
  for (const id of ["ss", "ts"]) document.getElementById(id).onsubmit = (e) => {
    e.preventDefault(); const q = e.target.q.value.trim(); if (q) location.hash = "#/suche/" + encodeURIComponent(q);
  };
  $app.addEventListener("change", (e) => { if (e.target.matches("[data-who]")) { setWho(e.target.value); route(); } });
  $app.addEventListener("click", (e) => {
    const m = e.target.closest("[data-newmenu]");
    if (m) { e.preventDefault(); return toggleNewMenu(m); }
    const c = e.target.closest("[data-nm]");
    if (c) {
      closeNewMenu();
      const k = c.dataset.nm;
      if (k === "task") openTaskForm(null, { project_id: currentProject() });
      else if (k === "idea") openIdeaForm();
      else openProjectForm();
      return;
    }
    if (e.target.id === "newmenu-bg") return closeNewMenu();
    const nw = e.target.closest("[data-news]");
    if (nw) { e.preventDefault(); return showNews(true); }
    const n = e.target.closest("[data-new]");
    if (n) { e.preventDefault(); openTaskForm(null, { project_id: currentProject() }); }
  });
  shellReady = true;
}
// Auswahl beim Plus: Aufgabe, Idee oder Projekt
function toggleNewMenu(btn) {
  const menu = document.getElementById("newmenu"), bg = document.getElementById("newmenu-bg");
  if (!menu.classList.contains("hidden")) return closeNewMenu();
  const fab = btn.classList.contains("fab");
  menu.classList.toggle("from-fab", fab);
  if (!fab) { const r = btn.getBoundingClientRect(); menu.style.top = r.bottom + 6 + "px"; menu.style.right = Math.max(8, innerWidth - r.right) + "px"; }
  else { menu.style.top = ""; menu.style.right = ""; }
  menu.classList.remove("hidden"); bg.classList.remove("hidden");
  document.querySelector(".fab").classList.add("open");
  document.addEventListener("keydown", escNewMenu);
}
function closeNewMenu() {
  document.getElementById("newmenu")?.classList.add("hidden");
  document.getElementById("newmenu-bg")?.classList.add("hidden");
  document.querySelector(".fab")?.classList.remove("open");
  document.removeEventListener("keydown", escNewMenu);
}
function escNewMenu(e) { if (e.key === "Escape") closeNewMenu(); }
window.addEventListener("hashchange", closeNewMenu);

function currentProject() { const m = location.hash.match(/^#\/projekt\/([^/]+)/); return m && m[1] !== "allgemein" ? m[1] : null; }

function updateChrome(path, v) {
  const nav = NAV.map(([h, ic, t, cnt]) => {
    const c = cnt ? cnt() : 0;
    const act = h === "#/" ? path === "" : path.startsWith(h.slice(2)) || (h === "#/aufgaben" && path === "alle");
    return `<a class="mi${act ? " act" : ""}" href="${h}">${i(ic)}<span>${t}</span>${c ? `<span class="badge">${c}</span>` : ""}</a>`;
  }).join("");
  document.getElementById("snav").innerHTML = nav;
  document.getElementById("sadmin").innerHTML = `<div class="sep"></div>
    ${st.isAdmin() ? `<div class="lbl">ADMIN</div><a class="mi${path.startsWith("nutzer") ? " act" : ""}" href="#/nutzer">${i("users")}<span>Nutzer</span></a>` : ""}
    <a class="mi${path.startsWith("einstellungen") ? " act" : ""}" href="#/einstellungen">${i("gear")}<span>Einstellungen</span></a>
    <a class="mi" href="#" data-news>${i("star")}<span>Was ist neu</span></a>`;
  const u = st.unreadCount();
  const tb = document.getElementById("tbadge"); tb.textContent = u; tb.classList.toggle("hidden", !u);
  document.getElementById("tav").innerHTML = avatar(S.me, "lg");
  const tw = document.getElementById("twho"); tw.innerHTML = v.who ? whoSelect("whoPc") : ""; tw.classList.toggle("off", !v.who);
  // Handy
  const bell = `<a class="bell" href="#/mitteilungen" aria-label="Benachrichtigungen">${i("bell", "width:22px;height:22px")}${u ? `<span class="badge">${u}</span>` : ""}</a>`;
  document.getElementById("mhead").innerHTML = `
    <div class="mrow"><span class="mside">${v.back ? `<a class="back" href="${v.back}" aria-label="Zurück">${i("back", "width:22px;height:22px")}</a>` : ""}</span>
      <a href="#/" class="mlogo"><img src="img/logo.png" alt="Tischlermeister Nordbeck"></a><span class="mside r">${bell}</span></div>
    <div class="mtitle">${v.sub ? `<div class="sub">${esc(v.sub)}</div>` : ""}<div class="ptitle">${esc(v.title)}</div>${v.who ? `<div class="mwho">${whoSelect("whoM")}</div>` : ""}</div>`;
  const mn = [["#/", "home", "Übersicht", ""], ["#/aufgaben", "check", "Aufgaben", "aufgaben"], ["#/projekte", "folder", "Projekte", "projekt"], ["#/ideen", "bulb", "Ideen", "ideen"], ["#/mehr", "more", "Mehr", "mehr"]];
  const moreKeys = ["pruefung", "archiv", "mitteilungen", "nutzer", "einstellungen", "suche", "mehr"];
  const w = st.waitingForMe().length;
  document.getElementById("mnav").innerHTML = mn.map(([h, ic, t, key]) => {
    const act = key === "" ? path === "" : key === "mehr" ? moreKeys.some((k) => path.startsWith(k)) : path.startsWith(key) || (key === "aufgaben" && (path.startsWith("aufgabe/") || path === "alle")) || (key === "projekt" && path.startsWith("kalender"));
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
  [/^$/, vDashboard], [/^aufgaben(?:\/(alle|eigene|offen))?$/, vTasks], [/^alle$/, () => vTasks("alle")], [/^projekte$/, vProjects], [/^projekt\/([^/]+)$/, vProject],
  [/^aufgabe\/([^/]+)$/, vTask], [/^pruefung$/, vReview], [/^archiv$/, vArchive], [/^mitteilungen$/, vNotifications],
  [/^ideen$/, vIdeas], [/^kalender$/, vCalendar], [/^nutzer$/, vUsers], [/^einstellungen$/, vSettings], [/^mehr$/, vMore], [/^suche\/(.+)$/, vSearch],
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

// ---------- Wiederholung (Aufgaben und Projekte, ab v1.0.29) ----------
const REC_OPTS = [["", "Nicht wiederholen"], ["workday:1", "Werktags (Mo–Fr)"], ["day:1", "Täglich"], ["week:1", "Wöchentlich"], ["week:2", "Alle 2 Wochen"],
  ["month:1", "Monatlich"], ["month:3", "Vierteljährlich"], ["month:6", "Halbjährlich"], ["year:1", "Jährlich"], ["custom", "Eigener Rhythmus …"]];
const REC_UNITS = { day: ["Tag", "Tage"], week: ["Woche", "Wochen"], month: ["Monat", "Monate"], year: ["Jahr", "Jahre"] };
const recKey = (r) => {
  if (!r || !r.unit) return "";
  const k = `${r.unit}:${r.every || 1}`;
  return REC_OPTS.some((o) => o[0] === k) ? k : "custom";
};
/** Kurztext, z. B. „Monatlich“, „Alle 3 Wochen bis 31.12.2027“ */
function recText(r) {
  if (!r || !r.unit) return "";
  const k = recKey(r);
  let s = k === "custom" ? `Alle ${r.every} ${REC_UNITS[r.unit]?.[1] || ""}` : REC_OPTS.find((o) => o[0] === k)[1].replace(" (Mo–Fr)", "");
  if (r.until) s += ` bis ${fmtDate(r.until)}`;
  return s;
}
/** Formularfelder „Wiederholen“ – kind: "task" oder "project" */
function recFields(r, kind) {
  const k = recKey(r);
  const hint = kind === "task"
    ? "Beim Abhaken legt die App automatisch die nächste Aufgabe mit neuer Frist an – mit denselben Zuständigen und der Checkliste."
    : "Beim Archivieren legt die App das Projekt mit allen Aufgaben für die nächste Runde neu an – Termine verschoben, alles wieder offen.";
  return `<div class="field"><label>Wiederholen</label><select name="rec">${REC_OPTS.map(([v, l]) => `<option value="${v}" ${v === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <div class="muted rec-on ${k ? "" : "hidden"}" style="font-size:12px">${hint}</div></div>
    <div class="row2 rec-cus ${k === "custom" ? "" : "hidden"}">
      <div class="field"><label>Alle</label><input type="number" name="rec_n" min="1" max="99" inputmode="numeric" value="${k === "custom" ? r.every : 2}"></div>
      <div class="field"><label>Einheit</label><select name="rec_u">${Object.entries(REC_UNITS).map(([u, l]) => `<option value="${u}" ${k === "custom" && r.unit === u ? "selected" : ""}>${l[1]}</option>`).join("")}</select></div>
    </div>
    <div class="field rec-on ${k ? "" : "hidden"}"><label>Wiederholen bis (optional)</label><input type="date" name="rec_until" value="${r?.until || ""}"></div>`;
}
function bindRec(f) {
  if (!f.rec) return;
  f.rec.onchange = () => {
    f.querySelectorAll(".rec-on").forEach((el) => el.classList.toggle("hidden", !f.rec.value));
    f.querySelector(".rec-cus").classList.toggle("hidden", f.rec.value !== "custom");
  };
}
/** Regel aus dem Formular lesen; undefined = Feld nicht vorhanden (06 nicht eingespielt), null = keine Wiederholung */
function readRec(f, old, sameDue) {
  if (!f.rec) return undefined;
  const v = f.rec.value;
  if (!v) return null;
  let [unit, every] = v === "custom" ? [f.rec_u.value, f.rec_n.value] : v.split(":");
  every = Math.max(1, Math.min(99, Math.round(Number(every)) || 1));
  const r = { unit, every };
  if (f.rec_until.value) r.until = f.rec_until.value;
  // Tag im Monat (setzt die Datenbank) behalten, solange Rhythmus und Frist gleich bleiben
  if (old?.tag && old.unit === unit && sameDue) r.tag = old.tag;
  return r;
}
/** Hinweis nach dem Abhaken, wann die nächste Wiederholung fällig ist */
function nextInfo(id) {
  const t = st.task(id), n = t?.next_task_id && st.task(t.next_task_id);
  return n ? ` – nächste Runde ${n.due_date ? "am " + fmtDate(n.due_date) : "angelegt"}` : "";
}

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
  if (t.recurrence?.unit) meta += `<span class="m" title="Wiederholung">${i("repeat")}${esc(recText(t.recurrence))}</span>`;
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
      toast(s === "done" ? "Erledigt ✓" + nextInfo(t.id) : s === "review" ? "Zur Prüfung an den Ersteller geschickt" : "Wieder geöffnet");
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
  const u = whoId(), me = whoMe(), nm = whoFirst();
  const mine = S.tasks.filter((t) => t.status === "open" && !st.archivedTask(t) && (!u || st.assigneesOf(t.id).includes(u)));
  const over = mine.filter((t) => daysUntil(t.due_date) < 0).length;
  const today = mine.filter((t) => daysUntil(t.due_date) === 0);
  const wait = S.tasks.filter((t) => t.status === "review" && !st.archivedTask(t) && (!u || t.created_by === u));
  const projs = st.activeProjects().filter(whoProject);
  const avg = projs.length ? Math.round(projs.reduce((s, p) => s + st.progress(st.tasksOfProject(p.id)).pct, 0) / projs.length) : 0;
  const first = (S.profile?.name || "").split(" ")[0];
  const stat = (h, ic, t, n, s, red) => `<a class="card stat" href="${h}"><div class="t">${i(ic)}${t}</div>
    <div class="n" style="${red ? "color:var(--accent)" : ""}">${n}</div><div class="s ${red ? "over" : ""}">${s}</div></a>`;
  const prows = [...projs.map((p) => [p, st.tasksOfProject(p.id)]), ...(whoProject(null) ? [[null, st.tasksOfProject("allgemein")]] : [])]
    .filter(([p, l]) => p || l.length)
    .map(([p, l]) => {
      const g = st.progress(l);
      return `<a class="prow" href="#/projekt/${p ? p.id : "allgemein"}"><div class="a"><span>${esc(p ? p.name : "Allgemein")}</span><span>${g.pct} %</span></div>
        <div class="bar"><div style="width:${g.pct}%"></div></div>
        <div class="b"><span style="display:flex;gap:6px;align-items:center">${p ? (p.owner_id ? avatar(p.owner_id) : "") + (p.due_date ? ` bis ${fmtDate(p.due_date)}` : "") : "Aufgaben ohne Projekt"}</span><span>${g.done} von ${g.total} erledigt</span></div></a>`;
    }).join("") || `<div class="empty">${u ? "Keine Projekte in dieser Auswahl." : "Noch keine Projekte."}</div>`;
  const tasksT = me ? "Meine Aufgaben" : u ? `Aufgaben von ${nm}` : "Alle offenen Aufgaben";
  return {
    title: "Übersicht", who: true,
    html: `<div class="page-h"><div><h1 style="display:block">${greeting()}${first ? ", " + esc(first) : ""}</h1><div class="muted">${longDate()}</div></div></div>
      ${pushNote()}
      <div class="stats">
        ${stat("#/aufgaben/offen", "check", me ? "Meine offenen Aufgaben" : u ? `Offene Aufgaben von ${esc(nm)}` : "Offene Aufgaben (alle)", mine.length, over ? `davon ${over} überfällig` : "nichts überfällig", over > 0)}
        ${stat("#/aufgaben/offen", "cal", "Heute fällig", today.length, today.map((t) => t.title).join(", ").slice(0, 60) || "–")}
        ${stat("#/pruefung", "eye", "Zur Prüfung", wait.length, wait.length ? (me ? "wartet auf deine Bestätigung" : u ? `wartet auf Bestätigung von ${esc(nm)}` : "wartet auf Bestätigung") : "nichts offen")}
        ${stat("#/projekte", "folder", me ? "Meine Projekte" : u ? `Projekte von ${esc(nm)}` : "Aktive Projekte", projs.length, projs.length ? `Ø ${avg} % erledigt` : "–")}
      </div>
      <div class="cols">
        <div class="card list-cards-m"><div class="card-h"><h3>${esc(tasksT)}</h3><a class="btn sm" href="#/aufgaben/offen">Zur Liste</a></div>
          ${taskList(st.sortTasks(mine).slice(0, 8), { group: false, empty: me ? "Keine offenen Aufgaben – sehr gut!" : "Keine offenen Aufgaben." })}
          <div class="card-f"><a href="#" data-new>+ Aufgabe hinzufügen</a></div></div>
        <div class="card"><div class="card-h"><h3>Projekte</h3><button class="btn sm" id="np">${i("plus", "width:14px;height:14px")}Projekt</button></div>
          <div style="padding:0 18px 6px">${prows}</div></div>
      </div>`,
    after(r) { bindList(r); bindPushNote(r); r.querySelector("#np").onclick = () => openProjectForm(); },
  };
}

// Aufgaben: eine Liste; wessen Aufgaben, bestimmt der globale Umschalter oben (WHO)
// #/aufgaben/offen springt auf „Offen“, #/aufgaben/eigene bzw. #/aufgaben/alle (alte Adresse #/alle) setzen zusätzlich die Auswahl
const taskF = { proj: "", tab: "open" };
function vTasks(pre) {
  if (pre) {
    if (pre !== "offen") setWho(pre === "alle" ? "all" : "me");
    taskF.tab = "open"; taskF.proj = "";
    history.replaceState(null, "", "#/aufgaben"); // Vorgabe nur einmal anwenden, danach gilt der Umschalter
  }
  if (taskF.proj && taskF.proj !== "allgemein" && !st.activeProjects().some((p) => p.id === taskF.proj)) taskF.proj = "";
  let base = S.tasks.filter((t) => !st.archivedTask(t) && whoTask(t));
  if (taskF.proj) base = base.filter((t) => (taskF.proj === "allgemein" ? !t.project_id : t.project_id === taskF.proj));
  const open = base.filter((t) => t.status === "open"), rev = base.filter((t) => t.status === "review");
  const done = base.filter((t) => t.status === "done").sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "")).slice(0, 100);
  const me = whoMe();
  const list = taskF.tab === "open" ? taskList(open, { empty: me ? "Keine offenen Aufgaben – sehr gut!" : "Keine offenen Aufgaben." })
    : taskF.tab === "review" ? taskList(rev, { group: false, empty: "Nichts zur Prüfung." })
    : taskList(done, { group: false, empty: "Noch nichts erledigt." });
  const title = me ? "Meine Aufgaben" : whoAll() ? "Alle Aufgaben" : `Aufgaben von ${whoFirst()}`;
  const opt = (v, l, cur) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
  return {
    title, who: true,
    html: `<div class="page-h"><h1>${esc(title)}</h1>
        <div class="tfil"><select class="inp" id="fp" aria-label="Projekt">${opt("", "Alle Projekte", taskF.proj)}${opt("allgemein", "Allgemein", taskF.proj)}${st.activeProjects().map((p) => opt(p.id, p.name, taskF.proj)).join("")}</select></div></div>
      <div class="ttabs">${seg([["open", `Offen · ${open.length}`], ["review", `Zur Prüfung · ${rev.length}`], ["done", "Erledigt"]], taskF.tab, "tab")}</div>
      <div class="card list-cards">${list}</div>`,
    after(r) {
      bindList(r);
      r.querySelector("#fp").onchange = (e) => { taskF.proj = e.target.value; route(); };
      r.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { taskF.tab = b.dataset.tab; route(); });
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
    ${p?.due_date || p?.recurrence?.unit ? `<div class="muted" style="font-size:12px;margin-top:6px;display:flex;gap:12px;flex-wrap:wrap">${p.due_date ? `<span>${i("cal", "width:13px;height:13px;vertical-align:-2px")} bis ${fmtDate(p.due_date)}</span>` : ""}${p.recurrence?.unit ? `<span>${i("repeat", "width:13px;height:13px;vertical-align:-2px")} ${esc(recText(p.recurrence))}</span>` : ""}</div>` : ""}</a>`;
}
/** Handy: Umschalter zwischen Projektliste und Kalender oben auf beiden Seiten */
const projSwitch = (cur) => `<div class="seg mswitch">
  <a class="btn${cur === "list" ? " red" : ""}" href="#/projekte">${i("folder")}Liste</a>
  <a class="btn${cur === "cal" ? " red" : ""}" href="#/kalender">${i("cal")}Kalender</a></div>`;
function vProjects() {
  const act = st.activeProjects(), shown = act.filter(whoProject), gen = whoProject(null);
  const me = whoMe();
  return {
    title: me ? "Meine Projekte" : whoAll() ? "Projekte" : `Projekte von ${whoFirst()}`, who: true,
    html: `${projSwitch("list")}<div class="page-h"><h1>${esc(me ? "Meine Projekte" : whoAll() ? "Projekte" : "Projekte von " + whoFirst())}</h1><div style="display:flex;gap:8px"><a class="btn" href="#/archiv">${i("archive")}Archiv</a><button class="btn red" id="np">${i("plus")}Projekt</button></div></div>
      ${whoAll() ? "" : `<p class="muted whohint" style="margin-top:-4px">Projekte, in denen ${me ? "du" : esc(whoFirst())} verantwortlich ${me ? "bist" : "ist"}, sie angelegt ${me ? "hast" : "hat"} oder Aufgaben ${me ? "hast" : "hat"}.</p>`}
      ${shown.length || gen ? `<div class="pgrid">${shown.map(projectCard).join("")}${gen ? projectCard(null) : ""}</div>` : `<div class="card empty">Keine Projekte in dieser Auswahl.</div>`}
      ${whoHidden(act.length - shown.length, act.length - shown.length === 1 ? "Projekt" : "Projekte")}`,
    after(r) { r.querySelector("#np").onclick = () => openProjectForm(); },
  };
}

let projTab = "open";
function vProject(id) {
  const p = id === "allgemein" ? null : st.project(id);
  if (id !== "allgemein" && !p) return { title: "Projekt", back: "#/projekte", html: `<div class="empty">Projekt nicht gefunden.</div>` };
  const all = st.tasksOfProject(id), g = st.progress(all); // Fortschritt immer über das ganze Projekt
  const l = all.filter(whoTask);
  const open = l.filter((t) => t.status !== "done"), done = l.filter((t) => t.status === "done");
  const allOpen = all.filter((t) => t.status !== "done");
  const canP = p && (st.isAdmin() || p.owner_id === S.me || p.created_by === S.me);
  const nextP = p?.next_project_id ? st.project(p.next_project_id) : null;
  const list = projTab === "open" ? taskList(open, { project: false, empty: "Keine offenen Aufgaben." })
    : projTab === "done" ? taskList(done, { project: false, group: false, empty: "Noch nichts erledigt." })
    : taskList(st.sortTasks(l), { project: false, group: false });
  return {
    title: p ? p.name : "Allgemein", sub: "Projekt", back: "#/projekte", who: true,
    html: `<div class="page-h"><h1>${esc(p ? p.name : "Allgemein")}${p?.archived ? ' <span class="chip">archiviert</span>' : ""}</h1>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${canP ? `<button class="btn" id="pe">${i("edit")}Bearbeiten</button>
          <button class="btn" id="pa">${i("archive")}${p.archived ? "Wiederherstellen" : "Archivieren"}</button>` : ""}
          <button class="btn" id="pcal">${i("cal")}Kalender</button><button class="btn red" data-new>${i("plus")}Aufgabe</button></div></div>
      <div class="card" style="margin-bottom:12px"><div class="phead">${ring(g.pct)}<div class="info">
        <div><span class="muted">Erledigt:</span> ${g.done} von ${g.total}</div>
        ${p ? `<div style="display:flex;gap:6px;align-items:center"><span class="muted">Verantwortlich:</span> ${p.owner_id ? avatar(p.owner_id) + " " + esc(st.profile(p.owner_id)?.name || "") : "–"}</div>
        ${p.start_date ? `<div><span class="muted">Beginn:</span> ${fmtDate(p.start_date)}</div>` : ""}
        <div><span class="muted">Enddatum:</span> ${p.due_date ? fmtDate(p.due_date) : "–"}</div>
        ${p.recurrence?.unit ? `<div><span class="muted">Wiederholung:</span> ${esc(recText(p.recurrence))}</div>` : ""}
        ${nextP ? `<div><span class="muted">Nächste Runde:</span> <a href="#/projekt/${nextP.id}">${nextP.due_date ? "bis " + fmtDate(nextP.due_date) : "öffnen"}</a></div>` : ""}` : `<div class="muted">Aufgaben ohne Projekt</div>`}
      </div></div>${p?.description ? `<div class="desc">${esc(p.description)}</div>` : ""}</div>
      <div style="margin-bottom:10px">${seg([["open", `Offen · ${open.length}`], ["done", `Erledigt · ${done.length}`], ["all", "Alle"]], projTab, "pt")}</div>
      <div class="card list-cards">${list}</div>${whoHidden(all.length - l.length, "Aufgaben")}`,
    after(r) {
      bindList(r);
      r.querySelectorAll("[data-pt]").forEach((b) => b.onclick = () => { projTab = b.dataset.pt; route(); });
      r.querySelector("#pcal").onclick = () => { calF.proj = id; calF.anchor = null; location.hash = "#/kalender"; };
      const pe = r.querySelector("#pe"); if (pe) pe.onclick = () => openProjectForm(p);
      const pa = r.querySelector("#pa"); if (pa) pa.onclick = async () => {
        const rec = !p.archived && p.recurrence?.unit && !p.next_project_id;
        if (rec && !confirm(`Projekt archivieren?\n\nDas Projekt wiederholt sich (${recText(p.recurrence)}). Die nächste Runde wird mit allen Aufgaben neu angelegt – Termine verschoben, alles wieder offen.`
          + (allOpen.length ? `\n\nHinweis: Es sind noch ${allOpen.length} Aufgaben offen.` : ""))) return;
        if (!rec && !p.archived && allOpen.length && !confirm(`Es sind noch ${allOpen.length} Aufgaben offen. Trotzdem archivieren?`)) return;
        try {
          await st.archiveProject(p.id, !p.archived);
          const np = rec && st.project(p.id)?.next_project_id && st.project(st.project(p.id).next_project_id);
          if (np) { toast(`Archiviert – nächste Runde ${np.due_date ? "bis " + fmtDate(np.due_date) : ""} angelegt`); location.hash = "#/projekt/" + np.id; }
          else toast(p.archived ? "Wiederhergestellt" : rec ? "Archiviert – die Wiederholung ist abgelaufen" : "Archiviert");
        } catch (er) { toast(er.message); }
      };
    },
  };
}

function vTask(id) {
  const t = st.task(id);
  if (!t) return { title: "Aufgabe", back: "#/aufgaben", html: `<div class="empty">Aufgabe nicht gefunden oder gelöscht.</div>`, noFab: true };
  const p = t.project_id ? st.project(t.project_id) : null;
  const ck = st.checklistOf(id), cm = st.commentsOf(id), can = st.canEdit(t);
  const nextT = t.next_task_id ? st.task(t.next_task_id) : null;
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
          ${t.start_date ? `<span class="k">Beginn</span><span>${fmtDate(t.start_date)}</span>` : ""}
          <span class="k">Frist</span><span class="${due.over && t.status !== "done" ? "over" : ""}">${t.due_date ? fmtDate(t.due_date) + (due.today ? " (heute)" : "") : "–"}</span>
          ${t.recurrence?.unit ? `<span class="k">Wiederholung</span><span style="display:flex;gap:6px;align-items:center">${i("repeat", "width:15px;height:15px")}${esc(recText(t.recurrence))}</span>` : ""}
          ${nextT ? `<span class="k">Nächste Runde</span><span><a href="#/aufgabe/${nextT.id}">${nextT.due_date ? "fällig am " + fmtDate(nextT.due_date) : "öffnen"}</a></span>` : ""}
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
      if (q("#ap")) q("#ap").onclick = async () => { await st.setStatus(id, "done"); toast("Bestätigt ✓" + nextInfo(id)); };
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
      const ACT = { created: "angelegt", done: "abgehakt", review: "erledigt, zur Prüfung", approved: "bestätigt", reopened: "wieder geöffnet", repeated: "die Wiederholung angelegt (automatisch)" };
      st.taskEvents(id).then((ev) => {
        const el = q("#log"); if (!el) return;
        el.innerHTML = ev.map((e) => `<div class="log">${fmtTime(e.created_at)} – ${esc(st.profile(e.user_id)?.name || "System")} hat ${ACT[e.action] || e.action}</div>`).join("") || "–";
      }).catch(() => {});
    },
  };
}

function vReview() {
  const u = whoId(), me = whoMe();
  const wait = S.tasks.filter((t) => t.status === "review" && !st.archivedTask(t) && (!u || t.created_by === u));
  return {
    title: "Zur Prüfung", who: true,
    html: `<div class="page-h"><h1>Zur Prüfung</h1></div>
      <p class="muted" style="margin-bottom:12px">${me ? "Von dir angelegte Aufgaben, die erledigt wurden und auf deine Bestätigung warten."
        : u ? `Von ${esc(whoFirst())} angelegte Aufgaben, die erledigt wurden und auf seine/ihre Bestätigung warten.` : "Alle erledigten Aufgaben, die auf die Bestätigung durch den Ersteller warten."}</p>
      <div class="card list-cards">${taskList(wait, { group: false, empty: "Nichts zu prüfen." })}</div>`,
    after: bindList,
  };
}

function vArchive() {
  const arch = S.projects.filter((p) => p.archived && whoProject(p));
  const done = S.tasks.filter((t) => t.status === "done" && whoTask(t)).sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "")).slice(0, 40);
  return {
    title: "Archiv", who: true,
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
    html: `<div class="card mlist">${l("#/pruefung", "eye", "Zur Prüfung", w)}${l("#/archiv", "archive", "Archiv")}
      ${l("#/mitteilungen", "bell", "Benachrichtigungen", u)}${st.isAdmin() ? l("#/nutzer", "users", "Nutzer verwalten") : ""}${l("#/einstellungen", "gear", "Einstellungen")}<a href="#" data-news>${i("star")}<span>Was ist neu</span></a></div>
      <form class="card" id="ms" style="margin-top:12px;padding:12px;display:flex;gap:8px"><input class="inp" name="q" placeholder="Suchen …"><button class="btn">${i("search")}</button></form>`,
    after(r) { r.querySelector("#ms").onsubmit = (e) => { e.preventDefault(); const q = e.target.q.value.trim(); if (q) location.hash = "#/suche/" + encodeURIComponent(q); }; },
  };
}

function vSearch(q) {
  const s = q.toLowerCase();
  const ts = S.tasks.filter((t) => (t.title + " " + (t.description || "")).toLowerCase().includes(s));
  const ps = S.projects.filter((p) => (p.name + " " + (p.description || "")).toLowerCase().includes(s));
  const is = S.ideas.filter((x) => (x.title + " " + (x.description || "")).toLowerCase().includes(s));
  return {
    title: `Suche: ${q}`, back: "#/",
    html: `<div class="page-h"><h1>Suche: „${esc(q)}“</h1></div>
      ${ps.length ? `<div class="pgrid" style="margin-bottom:16px">${ps.map(projectCard).join("")}</div>` : ""}
      <div class="card list-cards">${taskList(st.sortTasks(ts), { group: false, empty: is.length ? "Keine Aufgaben gefunden." : "Keine Treffer." })}</div>
      ${is.length ? `<h3 style="font-size:15px;margin:18px 2px 10px">Ideen</h3><div class="card list-cards">${is.map(ideaRow).join("")}</div>` : ""}`,
    after(r) { bindList(r); bindIdeas(r); },
  };
}

// ---------- Kalender (Gantt) ----------
const dD = (s) => new Date(s + "T12:00:00");
const dS = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dDiff = (a, b) => Math.round((dD(b) - dD(a)) / 86400000);
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONL = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const n = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - n);
  return Math.ceil(((x - new Date(Date.UTC(x.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
}
const calF = {
  mode: (() => { try { return localStorage.getItem("calMode") || "month"; } catch (_) { return "month"; } })(),
  anchor: null, proj: "", done: false,
};
let calScroll = null;
// Fenstergröße geändert (PC): Kalender neu an die Breite anpassen
let calRz;
window.addEventListener("resize", () => { clearTimeout(calRz); calRz = setTimeout(() => { if (shellReady && innerWidth > 900 && location.hash.startsWith("#/kalender")) route(); }, 200); });
/** Sichtbarer Zeitraum je Ansicht: 2 Wochen ab Montag, Kalendermonat oder 3 Monate */
function calRange() {
  const a = calF.anchor ? dD(calF.anchor) : dD(todayStr());
  let start, end, label;
  if (calF.mode === "2w") {
    start = addD(a, -((a.getDay() + 6) % 7)); end = addD(start, 13);
    label = `KW ${isoWeek(start)}–${isoWeek(end)} · ${fmtDate(dS(start), false)} – ${fmtDate(dS(end))}`;
  } else {
    start = new Date(a.getFullYear(), a.getMonth(), 1, 12);
    const n = calF.mode === "quarter" ? 3 : 1;
    end = new Date(a.getFullYear(), a.getMonth() + n, 0, 12);
    label = n === 1 ? `${MONL[start.getMonth()]} ${start.getFullYear()}` : `${MON[start.getMonth()]} ${start.getFullYear() !== end.getFullYear() ? start.getFullYear() + " " : ""}– ${MON[end.getMonth()]} ${end.getFullYear()}`;
  }
  return { start: dS(start), end: dS(end), days: dDiff(dS(start), dS(end)) + 1, label };
}
function calShift(dir) {
  const a = calF.anchor ? dD(calF.anchor) : dD(todayStr());
  const x = calF.mode === "2w" ? addD(a, 14 * dir) : new Date(a.getFullYear(), a.getMonth() + (calF.mode === "quarter" ? 3 : 1) * dir, 1, 12);
  calF.anchor = dS(x); calScroll = null;
}
/** Zeitraum einer Aufgabe: Beginn bis Frist; ohne Beginn nur der Tag der Frist */
function taskSpan(t) {
  const s = t.start_date || t.due_date, e = t.due_date || t.start_date;
  return s ? [s, e < s ? s : e] : null;
}
function vCalendar() {
  const R = calRange();
  const mob = innerWidth <= 900;
  const lw = mob ? 128 : 300;
  // PC: Zeitachse füllt die ganze Breite (mindestens die Grundbreite je Tag); Handy: feste Breite, seitlich scrollen
  const minDw = { "2w": mob ? 44 : 64, month: mob ? 30 : 40, quarter: mob ? 11 : 16 }[calF.mode];
  const mainEl = document.getElementById("main");
  const avail = mainEl ? (mob ? mainEl.clientWidth : document.documentElement.clientWidth - mainEl.getBoundingClientRect().left) - 46 : innerWidth;
  const dw = mob ? minDw : Math.max(minDw, Math.floor((avail - lw) / R.days));
  const W = R.days * dw;
  const today = todayStr(), tIdx = dDiff(R.start, today);
  // Aufgaben filtern
  let tasks = S.tasks.filter((t) => !st.archivedTask(t));
  tasks = tasks.filter(whoTask);
  if (calF.proj) tasks = tasks.filter((t) => (calF.proj === "allgemein" ? !t.project_id : t.project_id === calF.proj));
  if (!calF.done) tasks = tasks.filter((t) => t.status !== "done");
  const noDate = tasks.filter((t) => !taskSpan(t)).length;
  const inRange = ([s, e]) => !(e < R.start || s > R.end);
  // Balken-Position (abgeschnitten an den Rändern)
  const pos = ([s, e]) => {
    const a = Math.max(0, dDiff(R.start, s)), b = Math.min(R.days - 1, dDiff(R.start, e));
    return { left: a * dw + 2, width: Math.max(dw - 4, (b - a + 1) * dw - 4), cl: s < R.start, cr: e > R.end };
  };
  const groups = [...st.activeProjects(), null].filter((p) => !calF.proj || (p ? p.id === calF.proj : calF.proj === "allgemein")).map((p) => {
    const all = tasks.filter((t) => (p ? t.project_id === p.id : !t.project_id));
    const rows = all.map((t) => [t, taskSpan(t)]).filter(([, sp]) => sp && inRange(sp))
      .sort((a, b) => (a[1][0] + a[1][1]).localeCompare(b[1][0] + b[1][1]) || a[0].priority - b[0].priority);
    // Projektbalken: Beginn/Enddatum des Projekts, sonst aus den Aufgaben abgeleitet
    let span = null;
    if (p) {
      const sp = st.tasksOfProject(p.id).map(taskSpan).filter(Boolean);
      const s = p.start_date || (sp.length ? sp.map((x) => x[0]).sort()[0] : null) || p.due_date;
      const e = p.due_date || (sp.length ? sp.map((x) => x[1]).sort().pop() : null) || s;
      if (s) span = [s, e < s ? s : e];
    }
    return { p, rows, span, show: rows.length || (span && inRange(span) && whoAll()) };
  }).filter((g) => g.show);

  // Kopf: Monate + Tage bzw. Kalenderwochen
  let months = "", days = "", bg = "";
  for (let k = 0; k < R.days; k++) {
    const d = addD(dD(R.start), k), wd = d.getDay();
    if (k === 0 || d.getDate() === 1) {
      const rest = Math.min(R.days - k, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate() + 1);
      months += `<div class="gm" style="left:${k * dw}px;width:${rest * dw}px"><span>${rest * dw > 70 ? MONL[d.getMonth()] + " " + d.getFullYear() : MON[d.getMonth()]}</span></div>`;
    }
    if (calF.mode === "quarter") {
      if (wd === 1 || k === 0) { const len = Math.min(R.days - k, wd === 1 ? 7 : (8 - wd) % 7 || 7); days += `<div class="gd wk" style="left:${k * dw}px;width:${len * dw}px">${len * dw >= 34 ? "KW " : ""}${isoWeek(d)}</div>`; }
    } else days += `<div class="gd${wd === 0 || wd === 6 ? " we" : ""}${k === tIdx ? " td" : ""}" style="left:${k * dw}px;width:${dw}px"><span class="gdi"><small>${WD[wd]}</small>${d.getDate()}</span></div>`;
    if (wd === 0 || wd === 6) bg += `<div class="gwe" style="left:${k * dw}px;width:${dw}px"></div>`;
    if (calF.mode !== "quarter" || wd === 1) bg += `<div class="gvl${wd === 1 ? " mo" : ""}" style="left:${k * dw}px"></div>`;
  }
  if (tIdx >= 0 && tIdx < R.days) bg += `<div class="gtoday" style="left:${tIdx * dw + dw / 2 - 1}px" title="Heute"></div>`;

  const barCls = (t) => t.status === "done" ? "done" : t.status === "review" ? "rev" : t.due_date && t.due_date < today ? "over" : "";
  const rowsHtml = groups.map(({ p, rows, span }) => {
    let h = `<div class="grow gproj"><a class="glbl" href="#/projekt/${p ? p.id : "allgemein"}">${i("folder", "width:15px;height:15px")}<span class="gt">${esc(p ? p.name : "Allgemein")}</span></a><div class="gtrack">`;
    if (p && span && inRange(span)) {
      const ps = pos(span), g = st.progress(st.tasksOfProject(p.id));
      h += `<a class="gpbar${ps.cl ? " cl" : ""}${ps.cr ? " cr" : ""}" href="#/projekt/${p.id}" style="left:${ps.left}px;width:${ps.width}px" title="${esc(p.name)}: ${fmtDate(span[0])} – ${fmtDate(span[1])} · ${g.pct} % erledigt"><span style="width:${g.pct}%"></span></a>`;
    }
    h += `</div></div>`;
    h += rows.map(([t, sp]) => {
      const ps = pos(sp), one = sp[0] === sp[1];
      const tip = `${t.title} · ${one ? fmtDate(sp[0]) : fmtDate(sp[0]) + " – " + fmtDate(sp[1])}${t.start_date ? "" : " (nur Frist)"}`;
      return `<div class="grow"><div class="glbl" data-open="${t.id}"><span class="prio p${t.priority}"></span><span class="gt ${t.status === "done" ? "strike" : ""}">${esc(t.title)}</span>${mob ? "" : avatars(st.assigneesOf(t.id))}</div>
        <div class="gtrack"><div class="gbar ${barCls(t)}${one ? " one" : ""}${ps.cl ? " cl" : ""}${ps.cr ? " cr" : ""}" data-open="${t.id}" style="left:${ps.left}px;width:${ps.width}px" title="${esc(tip)}">${ps.width > 90 ? `<span>${esc(t.title)}</span>` : ""}</div></div></div>`;
    }).join("");
    return h;
  }).join("");

  const sel = (id, opts, cur) => `<select class="inp" id="${id}" style="width:auto">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  return {
    title: "Kalender", who: true,
    html: `${projSwitch("cal")}<div class="page-h calh"><h1>Kalender</h1>${seg([["2w", "2 Wochen"], ["month", "Monat"], ["quarter", "Quartal"]], calF.mode, "cm")}</div>
      <div class="gctl">
        <div class="gnav"><button class="btn sm" id="cprev" aria-label="Zurück">${i("back", "width:16px;height:16px")}</button><button class="btn sm" id="ctoday">Heute</button>
          <button class="btn sm" id="cnext" aria-label="Weiter">${i("back", "width:16px;height:16px;transform:rotate(180deg)")}</button><b class="glabel">${esc(R.label)}</b></div>
        <div class="gfil">${sel("cp", [["", "Alle Projekte"], ["allgemein", "Allgemein"], ...st.activeProjects().map((u) => [u.id, u.name])], calF.proj)}
          <label class="check" style="font-size:13px"><input type="checkbox" id="cd" ${calF.done ? "checked" : ""}>Erledigte zeigen</label></div>
      </div>
      <div class="card gantt" style="--dw:${dw}px;--lw:${lw}px">
        ${groups.length ? `<div class="gscroll" id="gs"><div class="gtable" style="width:${lw + W}px">
          <div class="grow ghead"><div class="glbl">Aufgabe</div><div class="gtrack"><div class="gms">${months}</div><div class="gds">${days}</div></div></div>
          <div class="gbody"><div class="gbg" style="left:${lw}px;width:${W}px">${bg}</div>${rowsHtml}</div>
        </div></div>` : `<div class="empty">Im gewählten Zeitraum stehen keine Aufgaben mit Frist.</div>`}
      </div>
      <div class="glegend muted"><span><i class="gbar lg"></i>offen</span><span><i class="gbar lg over"></i>überfällig</span><span><i class="gbar lg rev"></i>zur Prüfung</span><span><i class="gbar lg done"></i>erledigt</span><span><i class="gpbar lg"><span style="width:60%"></span></i>Projekt (Fortschritt)</span></div>
      <p class="muted" style="font-size:13px;margin:8px 2px 0">Balken laufen vom Beginn bis zur Frist. Aufgaben ohne Beginn erscheinen als kurzer Balken am Tag der Frist – den Beginn trägst du beim Bearbeiten der Aufgabe ein.${S.hasStart ? "" : " <b>Hinweis:</b> Das Feld „Beginn“ ist verfügbar, sobald ein Admin 05_prioritaet_kalender.sql in Supabase ausgeführt hat."}
        ${noDate ? `<br>${noDate} ${noDate === 1 ? "Aufgabe hat" : "Aufgaben haben"} weder Beginn noch Frist und ${noDate === 1 ? "erscheint" : "erscheinen"} nicht im Kalender – siehe <a href="#/aufgaben/offen">Aufgaben</a>.` : ""}</p>`,
    after(r) {
      bindList(r);
      r.querySelectorAll("[data-cm]").forEach((b) => b.onclick = () => { calF.mode = b.dataset.cm; calScroll = null; try { localStorage.setItem("calMode", calF.mode); } catch (_) { /* */ } route(); });
      r.querySelector("#cprev").onclick = () => { calShift(-1); route(); };
      r.querySelector("#cnext").onclick = () => { calShift(1); route(); };
      r.querySelector("#ctoday").onclick = () => { calF.anchor = null; calScroll = null; route(); };
      r.querySelector("#cp").onchange = (e) => { calF.proj = e.target.value; route(); };
      r.querySelector("#cd").onchange = (e) => { calF.done = e.target.checked; route(); };
      const gs = r.querySelector("#gs");
      if (gs) {
        // Position merken (Live-Aktualisierung zeichnet neu); sonst „heute“ in den sichtbaren Bereich holen
        if (calScroll && calScroll.key === R.start + calF.mode) gs.scrollLeft = calScroll.x;
        else if (tIdx >= 0 && tIdx < R.days) gs.scrollLeft = Math.max(0, tIdx * dw - Math.min(3 * dw, (gs.clientWidth - lw) / 3));
        gs.addEventListener("scroll", () => { calScroll = { key: R.start + calF.mode, x: gs.scrollLeft }; }, { passive: true });
      }
    },
  };
}

// ---------- Ideen ----------
function ideaRow(x) {
  const p = x.project_id ? st.project(x.project_id) : null;
  const t = x.task_id ? st.task(x.task_id) : null;
  const rp = x.result_project_id ? st.project(x.result_project_id) : null;
  let meta = "";
  if (p) meta += `<span class="chip">${esc(p.name)}</span>`;
  if (x.status === "adopted") meta += `<span class="chip" style="background:#e3f4ea;color:#1a7a45">übernommen${x.adopted_at ? " " + fmtDate(x.adopted_at.slice(0, 10)) : ""}</span>`;
  if (S.hasRating) meta += rateBadge(x);
  meta += `<span class="m">${esc(st.profile(x.created_by)?.name || "")} · ${fmtTime(x.created_at)}</span>`;
  const act = x.status === "open"
    ? `<button class="btn sm" data-adopt="${x.id}" title="Als Aufgabe oder Projekt übernehmen">${i("check", "width:15px;height:15px")}Übernehmen</button>`
    : t ? `<a class="btn sm" href="#/aufgabe/${t.id}" data-stop>Zur Aufgabe</a>`
    : rp ? `<a class="btn sm" href="#/projekt/${rp.id}" data-stop>Zum Projekt</a>`
    : `<span class="muted" style="font-size:12px">gelöscht</span>`;
  return `<div class="trow irow" data-idea="${x.id}"><span class="ibulb ${x.status}">${i("bulb")}</span>
    <div class="tt"><div class="ti">${esc(x.title)}</div>${x.description ? `<div class="idesc">${esc(x.description)}</div>` : ""}<div class="meta">${meta}</div></div>
    <div class="side-r"><div class="iact">${act}</div></div></div>`;
}
/** Kurzanzeige der Priorität einer Idee */
function rateBadge(x) {
  if (!x.priority) return `<span class="rates none">noch nicht eingestuft</span>`;
  return `<span class="rates p-${x.priority}" title="Priorität ${PRIO[x.priority]}"><span class="prio p${x.priority}"></span>${PRIO[x.priority]}</span>`;
}
function bindIdeas(root) {
  root.querySelectorAll("[data-adopt]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); adoptIdea(st.idea(b.dataset.adopt)); });
  root.querySelectorAll("[data-stop]").forEach((a) => a.onclick = (e) => e.stopPropagation());
  root.querySelectorAll("[data-idea]").forEach((r) => r.onclick = () => openIdeaForm(st.idea(r.dataset.idea)));
}
/** Idee übernehmen: erst fragen, ob daraus eine Aufgabe oder ein Projekt werden soll */
function adoptIdea(x) {
  if (!x) return;
  modal("Idee übernehmen als …", `
    <div class="newmenu inline">
      <button type="button" data-as="task">${i("check")}<span><b>Aufgabe</b><small>mit Frist und Zuständigen${x.project_id ? " – im Projekt " + esc(st.project(x.project_id)?.name || "") : ""}</small></span></button>
      <button type="button" data-as="project">${i("folder")}<span><b>Projekt</b><small>wird eigenes Projekt, Aufgaben kommen danach dazu</small></span></button>
    </div>`,
    `<button type="button" class="btn" data-close>Abbrechen</button>`,
    (f, close) => {
      f.querySelector('[data-as="task"]').onclick = () => { close(); adoptIdeaAsTask(x); };
      f.querySelector('[data-as="project"]').onclick = () => { close(); openProjectForm(null, { name: x.title, description: x.description || "", idea_id: x.id }); };
    });
}
function adoptIdeaAsTask(x) {
  openTaskForm(null, { title: x.title, description: x.description || "", project_id: x.project_id || currentProject(), priority: x.priority || 2, idea_id: x.id });
}

let ideaTab = "open";
let ideaSort = (() => { try { return localStorage.getItem("ideaSort2") || "priority"; } catch (_) { return "priority"; } })();
const IDEA_SORTS = [["priority", "Priorität"], ["new", "Neueste zuerst"]];
function vIdeas() {
  if (S.ideasMissing) return { title: "Ideen", noFab: true,
    html: `<div class="page-h"><h1>Ideen</h1></div><div class="card empty">Der Ideen-Bereich ist noch nicht eingerichtet.<br>Ein Admin muss einmalig die Datenbank-Erweiterung <b>03_ideen.sql</b> in Supabase ausführen.</div>` };
  const u = whoId(), mineI = S.ideas.filter((x) => !u || x.created_by === u);
  const open = mineI.filter((x) => x.status === "open"), done = mineI.filter((x) => x.status === "adopted");
  const sortBy = S.hasRating ? ideaSort : "new";
  const list = st.sortIdeas(ideaTab === "open" ? open : done, sortBy);
  return {
    title: "Ideen", who: true,
    html: `<div class="page-h"><h1>Ideen</h1><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${seg([["open", `Offen · ${open.length}`], ["adopted", `Übernommen · ${done.length}`]], ideaTab, "it")}
        <button class="btn red" id="ni">${i("plus")}Idee</button></div></div>
      <form class="card iquick" id="iq">${i("bulb", "color:var(--warn)")}<input id="iqin" placeholder="Idee schnell notieren …" autocomplete="off" maxlength="200"><button class="btn red sm">Notieren</button></form>
      <p class="muted" style="font-size:13px;margin:0 2px 12px">Hier landet alles, was man nicht vergessen will, aber noch keine Aufgabe ist. Ideen lassen sich nach Priorität einstufen (Idee antippen) – gemeint ist, wie machbar, wichtig und dringend sie insgesamt ist. Mit „Übernehmen“ wird daraus eine Aufgabe oder ein Projekt.</p>
      ${S.hasRating ? `<div class="isort"><label for="isrt" class="muted">Sortieren nach</label><select class="inp" id="isrt">${IDEA_SORTS.map(([k, l]) => `<option value="${k}" ${k === ideaSort ? "selected" : ""}>${l}</option>`).join("")}</select></div>`
        : `<div class="card note" style="border-left-color:var(--warn)"><div class="tx muted" style="font-size:13px">Einstufen und Sortieren nach Priorität ist verfügbar, sobald ein Admin <b>05_prioritaet_kalender.sql</b> in Supabase ausgeführt hat.</div></div>`}
      <div class="card list-cards">${list.map(ideaRow).join("") || `<div class="empty">${ideaTab === "open" ? "Noch keine Ideen notiert." : "Noch keine Idee übernommen."}</div>`}</div>
      ${whoHidden(S.ideas.length - mineI.length, "Ideen")}`,
    after(r) {
      bindIdeas(r);
      r.querySelectorAll("[data-it]").forEach((b) => b.onclick = () => { ideaTab = b.dataset.it; route(); });
      const srt = r.querySelector("#isrt");
      if (srt) srt.onchange = () => { ideaSort = srt.value; try { localStorage.setItem("ideaSort2", ideaSort); } catch (_) { /* */ } route(); };
      r.querySelector("#ni").onclick = () => openIdeaForm();
      r.querySelector("#iq").onsubmit = async (e) => {
        e.preventDefault();
        const inp = r.querySelector("#iqin"), v = inp.value.trim();
        if (!v) return;
        inp.value = "";
        try { await st.createIdea({ title: v }); ideaTab = "open"; toast("Idee notiert"); route(); document.getElementById("iqin")?.focus(); }
        catch (er) { inp.value = v; toast(er.message); }
      };
    },
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
          <button class="btn sm ${p.active ? "danger" : ""}" data-act="${p.id}">${p.active ? "Sperren" : "Entsperren"}</button>
          <button class="btn sm danger" data-del="${p.id}" title="Nutzer endgültig löschen">${i("trash")}Löschen</button></div>`}</div>`).join("")}</div>
      <p class="muted" style="font-size:13px;margin-top:10px">Neue Nutzer bekommen ein Startpasswort. Nach dem Anlegen kannst du die Zugangsdaten per „Teilen“ verschicken. Später erneut teilen: „Passwort“ → neues Passwort speichern → „Teilen“.</p>`,
    after(r) {
      r.querySelector("#inv").onclick = openInviteForm;
      r.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
        const p = st.profile(b.dataset.del);
        const n = S.tasks.filter((t) => st.assigneesOf(t.id).includes(p.id) && t.status !== "done").length;
        if (!confirm(`${p.name} endgültig löschen?\n\nDer Zugang wird entfernt.${n ? ` ${p.name} wird außerdem aus ${n} offenen Aufgaben ausgetragen.` : ""} Von ${p.name} angelegte Aufgaben und Projekte bleiben erhalten.\n\nDas lässt sich nicht rückgängig machen.`)) return;
        try { await st.adminAction({ action: "delete", user_id: p.id }); toast(`${p.name} gelöscht`); } catch (e) { toast(e.message); }
      });
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
        <div class="card" style="padding:14px 18px;display:flex;justify-content:space-between;align-items:center;gap:10px">
          <span><b>Was ist neu</b><br><span class="muted" style="font-size:12px">Die letzten Änderungen an der App</span></span><button class="btn" data-news>${i("star")}Anzeigen</button></div>
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
  const d = t || { title: preset.title || "", description: preset.description || "", project_id: preset.project_id || "", start_date: preset.start_date || "", due_date: preset.due_date || "", priority: preset.priority || 2, needs_approval: false, recurrence: null };
  const nextT = edit && t.next_task_id ? st.task(t.next_task_id) : null;
  const ass = edit ? st.assigneesOf(t.id) : [S.me];
  const projs = st.activeProjects();
  if (d.project_id && !projs.find((p) => p.id === d.project_id)) { const pp = st.project(d.project_id); if (pp) projs.push(pp); }
  modal(edit ? "Aufgabe bearbeiten" : preset.idea_id ? "Idee als Aufgabe übernehmen" : "Neue Aufgabe", `
    <div class="err hidden" id="fe"></div>
    <div class="field"><label>Titel *</label><input name="title" value="${esc(d.title)}" maxlength="200" required></div>
    <div class="field"><label>Beschreibung</label><textarea name="description">${esc(d.description || "")}</textarea></div>
    <div class="field"><label>Projekt</label><select name="project_id"><option value="">Allgemein (ohne Projekt)</option>
      ${projs.map((p) => `<option value="${p.id}" ${p.id === d.project_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <div class="row2">
      ${S.hasStart ? `<div class="field"><label>Beginn (optional, für den Kalender)</label><input type="date" name="start_date" value="${d.start_date || ""}"></div>` : ""}
      <div class="field"><label>Frist</label><input type="date" name="due_date" value="${d.due_date || ""}"></div>
    </div>
    ${S.hasRec ? recFields(d.recurrence, "task") : ""}
    ${nextT ? `<div class="muted" style="font-size:12px;margin:-6px 0 14px">Die nächste Runde (fällig am ${fmtDate(nextT.due_date)}) ist schon angelegt – Änderungen für künftige Runden bitte dort vornehmen.</div>` : ""}
    <div class="field"><label>Priorität</label><div class="pick">${[1, 2, 3].map((p) => `<label><input type="radio" name="priority" value="${p}" ${p === d.priority ? "checked" : ""}><span class="prio p${p}" style="margin-left:6px"></span>${PRIO[p]}</label>`).join("")}</div></div>
    <div class="field"><label>Zuständig</label><div class="pick">${st.activeProfiles().map((p) => `<label><input type="checkbox" name="ass" value="${p.id}" ${ass.includes(p.id) ? "checked" : ""}>${avatar(p.id)}${esc(p.name)}</label>`).join("")}</div></div>
    ${edit ? "" : `<div class="field"><label>Checkliste (ein Punkt pro Zeile, optional)</label><textarea name="ck" style="min-height:70px"></textarea></div>`}
    <label class="check"><input type="checkbox" name="needs_approval" ${d.needs_approval ? "checked" : ""}> Erledigung muss von mir bestätigt werden</label>`,
    `<button type="button" class="btn" data-close>Abbrechen</button><button class="btn red" id="sv">${edit ? "Speichern" : "Anlegen"}</button>`,
    (f, close) => {
      bindRec(f);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const fe = f.querySelector("#fe");
        const data = {
          title: f.title.value.trim(), description: f.description.value.trim(), project_id: f.project_id.value,
          due_date: f.due_date.value, priority: Number(f.priority.value), needs_approval: f.needs_approval.checked,
          start_date: f.start_date ? f.start_date.value : "",
        };
        const rec = readRec(f, d.recurrence, data.due_date === (d.due_date || ""));
        if (rec !== undefined) data.recurrence = rec;
        const a = [...f.querySelectorAll("[name=ass]:checked")].map((x) => x.value);
        if (!data.title) { fe.textContent = "Bitte einen Titel eingeben."; return fe.classList.remove("hidden"); }
        if (!a.length) { fe.textContent = "Bitte mindestens eine Person zuweisen."; return fe.classList.remove("hidden"); }
        if (data.start_date && data.due_date && data.start_date > data.due_date) { fe.textContent = "Der Beginn liegt nach der Frist."; return fe.classList.remove("hidden"); }
        if (rec && !data.due_date) { fe.textContent = "Für eine Wiederholung braucht die Aufgabe eine Frist."; return fe.classList.remove("hidden"); }
        if (rec?.until && rec.until < data.due_date) { fe.textContent = "„Wiederholen bis“ liegt vor der Frist."; return fe.classList.remove("hidden"); }
        const b = f.querySelector("#sv"); b.disabled = true;
        try {
          if (edit) { await st.updateTask(t.id, data, a); toast("Gespeichert"); close(); }
          else {
            const ck = (f.ck.value || "").split("\n").map((s) => s.trim()).filter(Boolean);
            const nt = await st.createTask(data, a, ck);
            if (preset.idea_id) { try { await st.adoptIdea(preset.idea_id, nt.id); } catch (_) { toast("Aufgabe angelegt – Idee konnte nicht als übernommen markiert werden"); } }
            toast(preset.idea_id ? "Idee als Aufgabe übernommen" : "Aufgabe angelegt"); close();
            if (!location.hash.startsWith("#/projekt/")) location.hash = "#/aufgabe/" + nt.id;
          }
        } catch (er) { b.disabled = false; fe.textContent = er.message; fe.classList.remove("hidden"); }
      };
    });
}

function openIdeaForm(x) {
  const edit = !!x, can = !edit || st.canEditIdea(x);
  const d = x || { title: "", description: "", project_id: currentProject() || "" };
  const projs = st.activeProjects();
  if (d.project_id && !projs.find((p) => p.id === d.project_id)) { const pp = st.project(d.project_id); if (pp) projs.push(pp); }
  const dis = can ? "" : "disabled";
  const t = x?.task_id ? st.task(x.task_id) : null;
  const rp = x?.result_project_id ? st.project(x.result_project_id) : null;
  const res = t ? ` · <a href="#/aufgabe/${t.id}" data-close>zur Aufgabe</a>` : rp ? ` · <a href="#/projekt/${rp.id}" data-close>zum Projekt</a>` : " · Aufgabe bzw. Projekt wurde gelöscht";
  const info = edit ? `<div class="muted" style="font-size:13px;margin-bottom:12px">Notiert von ${esc(st.profile(x.created_by)?.name || "–")} · ${fmtTime(x.created_at)}
    ${x.status === "adopted" ? `<br>Übernommen${x.adopted_by ? " von " + esc(st.profile(x.adopted_by)?.name || "") : ""}${x.adopted_at ? " · " + fmtTime(x.adopted_at) : ""}${res}` : ""}</div>` : "";
  modal(edit ? (can ? "Idee bearbeiten" : "Idee") : "Neue Idee", `
    <div class="err hidden" id="fe"></div>${info}
    <div class="field"><label>Idee *</label><input name="title" value="${esc(d.title)}" maxlength="200" required ${dis}></div>
    <div class="field"><label>Notizen</label><textarea name="description" ${dis}>${esc(d.description || "")}</textarea></div>
    <div class="field"><label>Passt zu Projekt (optional)</label><select name="project_id" ${dis}><option value="">–</option>
      ${projs.map((p) => `<option value="${p.id}" ${p.id === d.project_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    ${S.hasRating ? `<div class="field"><label>Priorität <span style="font-weight:400">(machbar, wichtig, dringend – insgesamt)</span></label>
      <div class="pick">${[[0, "noch offen"], [1, PRIO[1]], [2, PRIO[2]], [3, PRIO[3]]].map(([v, t]) => `<label><input type="radio" name="iprio" value="${v}" ${(d.priority || 0) === v ? "checked" : ""} ${dis}>${v ? `<span class="prio p${v}" style="margin-left:6px"></span>` : `<span style="width:6px"></span>`}${t}</label>`).join("")}</div></div>` : ""}`,
    `${edit && can ? `<button type="button" class="btn danger" id="idel" style="margin-right:auto" title="Löschen">${i("trash")}</button>` : ""}
     ${edit && x.status === "open" ? `<button type="button" class="btn" id="iad">${i("check")}Übernehmen</button>` : ""}
     ${edit && x.status === "adopted" && can ? `<button type="button" class="btn" id="ire">${i("undo")}Wieder offen</button>` : ""}
     ${can ? `<button class="btn red" id="sv">${edit ? "Speichern" : "Notieren"}</button>` : `<button type="button" class="btn" data-close>Schließen</button>`}`,
    (f, close) => {
      const read = () => {
        const r = { title: f.title.value.trim(), description: f.description.value.trim() || null, project_id: f.project_id.value || null };
        if (S.hasRating) r.priority = Number(f.querySelector("[name=iprio]:checked")?.value || 0) || null;
        return r;
      };
      f.onsubmit = async (e) => {
        e.preventDefault();
        if (!can) return close();
        const fe = f.querySelector("#fe"), data = read();
        if (!data.title) { fe.textContent = "Bitte die Idee kurz beschreiben."; return fe.classList.remove("hidden"); }
        const b = f.querySelector("#sv"); b.disabled = true;
        try {
          if (edit) { await st.updateIdea(x.id, data); toast("Gespeichert"); }
          else { await st.createIdea(data); ideaTab = "open"; toast("Idee notiert"); if (!location.hash.startsWith("#/ideen")) location.hash = "#/ideen"; }
          close();
        } catch (er) { b.disabled = false; fe.textContent = er.message; fe.classList.remove("hidden"); }
      };
      const ad = f.querySelector("#iad");
      if (ad) ad.onclick = async () => {
        // ungespeicherte Änderungen vorher sichern, damit sie in die Aufgabe bzw. das Projekt übernommen werden
        const data = read();
        if (can && data.title && (data.title !== x.title || data.description !== (x.description || null) || data.project_id !== (x.project_id || null)
          || ("priority" in data && data.priority !== (x.priority || null)))) {
          try { await st.updateIdea(x.id, data); } catch (_) { /* */ }
        }
        close(); adoptIdea({ ...x, ...(can && data.title ? data : {}) });
      };
      const re = f.querySelector("#ire");
      if (re) re.onclick = async () => { try { await st.reopenIdea(x.id); close(); toast("Idee wieder offen"); } catch (er) { toast(er.message); } };
      const dl = f.querySelector("#idel");
      if (dl) dl.onclick = async () => {
        if (!confirm("Idee endgültig löschen?")) return;
        try { await st.deleteIdea(x.id); close(); toast("Idee gelöscht"); } catch (er) { toast(er.message); }
      };
    });
}

function openProjectForm(p, preset = {}) {
  const edit = !!p;
  const d = p || { name: preset.name || "", description: preset.description || "", owner_id: S.me, start_date: "", due_date: "", recurrence: null };
  modal(edit ? "Projekt bearbeiten" : preset.idea_id ? "Idee als Projekt übernehmen" : "Neues Projekt", `
    <div class="err hidden" id="fe"></div>
    <div class="field"><label>Name *</label><input name="name" value="${esc(d.name)}" maxlength="120" required></div>
    <div class="field"><label>Beschreibung</label><textarea name="description">${esc(d.description || "")}</textarea></div>
    <div class="field"><label>Verantwortlich</label><select name="owner_id"><option value="">–</option>
      ${st.activeProfiles().map((u) => `<option value="${u.id}" ${u.id === d.owner_id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
    <div class="row2">
      ${S.hasStart ? `<div class="field"><label>Beginn (optional)</label><input type="date" name="start_date" value="${d.start_date || ""}"></div>` : ""}
      <div class="field"><label>Enddatum</label><input type="date" name="due_date" value="${d.due_date || ""}"></div>
    </div>
    ${S.hasRec ? recFields(d.recurrence, "project") : ""}
    ${edit && p.next_project_id ? `<div class="muted" style="font-size:12px;margin:-6px 0 14px">Die nächste Runde ist schon angelegt – Änderungen für künftige Runden bitte dort vornehmen.</div>` : ""}`,
    `${edit && (st.isAdmin() || p.created_by === S.me) ? `<button type="button" class="btn danger" id="pd" style="margin-right:auto">${i("trash")}Löschen</button>` : ""}
     <button type="button" class="btn" data-close>Abbrechen</button><button class="btn red" id="sv">${edit ? "Speichern" : "Anlegen"}</button>`,
    (f, close) => {
      bindRec(f);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const data = { name: f.name.value.trim(), description: f.description.value.trim() || null, owner_id: f.owner_id.value || null, due_date: f.due_date.value || null };
        if (f.start_date) data.start_date = f.start_date.value || null;
        const rec = readRec(f, d.recurrence, (data.due_date || "") === (d.due_date || ""));
        if (rec !== undefined) data.recurrence = rec;
        const fe = f.querySelector("#fe");
        if (!data.name) { fe.textContent = "Bitte einen Namen eingeben."; return fe.classList.remove("hidden"); }
        if (data.start_date && data.due_date && data.start_date > data.due_date) { fe.textContent = "Der Beginn liegt nach dem Enddatum."; return fe.classList.remove("hidden"); }
        if (rec && !data.due_date) { fe.textContent = "Für eine Wiederholung braucht das Projekt ein Enddatum."; return fe.classList.remove("hidden"); }
        if (rec?.until && rec.until < data.due_date) { fe.textContent = "„Wiederholen bis“ liegt vor dem Enddatum."; return fe.classList.remove("hidden"); }
        try {
          if (edit) { await st.updateProject(p.id, data); toast("Gespeichert"); close(); }
          else {
            const np = await st.createProject(data);
            let msg = preset.idea_id ? "Idee als Projekt übernommen" : "Projekt angelegt";
            if (preset.idea_id) { try { await st.adoptIdeaAsProject(preset.idea_id, np.id); } catch (_) { msg = "Projekt angelegt – Idee konnte nicht als übernommen markiert werden"; } }
            toast(msg); close(); location.hash = "#/projekt/" + np.id;
          }
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
// Was ist neu
// =====================================================================
const NEWS_KEY = "nbt-neu-gesehen";
// Geräte ohne Merker hatten die App schon vor dieser Funktion (bis 1.0.22) –
// sie sollen die Neuerungen ab 1.0.23 einmal zu sehen bekommen.
const NEWS_START = "1.0.22";
function newsSeen() { try { return localStorage.getItem(NEWS_KEY) || NEWS_START; } catch (_) { return APP_VERSION; } }
function newsMark() { try { localStorage.setItem(NEWS_KEY, APP_VERSION); } catch (_) { /* */ } }
/** manual = false: beim Start nur das zeigen, was seit dem letzten Mal dazugekommen ist.
 *  manual = true (von Hand): immer die letzten Einträge zeigen. */
function showNews(manual) {
  closeNewMenu();
  const cur = NEUERUNGEN.filter((n) => !fassungKleiner(APP_VERSION, n.fassung));
  const list = manual ? cur.slice(0, 6) : cur.filter((n) => fassungKleiner(newsSeen(), n.fassung));
  if (!manual) newsMark(); // auch beim Wegtippen gemerkt – sonst käme dasselbe Fenster bei jedem Start
  if (!list.length) { if (manual) toast("Zu dieser Version gibt es nichts Neues."); return; }
  modal("Was ist neu", `
    <div class="news-head">${i("star")}<div><b>Nordbeck To-Do ${esc(APP_VERSION)}</b><div class="muted">${manual ? "Die letzten Änderungen" : "Seit deinem letzten Besuch hat sich etwas getan"}</div></div></div>
    ${list.map((n) => `<div class="news-ver">Version ${esc(n.fassung)}${n.datum ? " · " + esc(n.datum) : ""}</div>
      <ul class="news-list">${n.punkte.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`).join("")}
    ${manual ? "" : `<p class="muted" style="font-size:12px;margin-top:10px">Später nachlesen: ${innerWidth > 900 ? "links in der Leiste unter „Einstellungen“" : "unter „Mehr“"} › „Was ist neu“.</p>`}`,
    `<button type="button" class="btn red" data-close>Alles klar</button>`,
    (f) => { f.onsubmit = (e) => e.preventDefault(); });
}
/** Beim Start einmal prüfen – aber nicht über ein anderes offenes Fenster legen (z. B. die Push-Frage) */
function newsCheck(tries = 0) {
  if (!shellReady || !S.me) return;
  if (!NEUERUNGEN.some((n) => fassungKleiner(newsSeen(), n.fassung) && !fassungKleiner(APP_VERSION, n.fassung))) return newsMark();
  if ($modal.innerHTML.trim()) { if (tries < 600) setTimeout(() => newsCheck(tries + 1), 1000); return; }
  showNews(false);
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
  setTimeout(newsCheck, 600);
});
