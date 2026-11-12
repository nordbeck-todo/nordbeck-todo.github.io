// Datenhaltung: lädt alles (kleines Team) und hält es aktuell
import { sb } from "./supabase.js";
import { debounce, daysUntil, todayStr } from "./util.js";

export const S = {
  me: null, profile: null,
  profiles: [], projects: [], tasks: [], assignees: [], checklist: [], comments: [], notifications: [], ideas: [],
  ideasMissing: false, loaded: false,
  hasStart: true, hasRating: true, // neue Spalten aus 05_prioritaet_kalender.sql vorhanden?
  hasRec: true, // Wiederholung aus 06_wiederholung.sql vorhanden?
};
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

function check({ data, error }) {
  if (error) throw new Error(error.message || "Fehler beim Speichern");
  return data;
}

export async function loadAll() {
  const [pr, pj, tk, as, ck, cm, nt, id, ps, pi, rc] = await Promise.all([
    sb.from("profiles").select("*").order("name"),
    sb.from("projects").select("*").order("created_at"),
    sb.from("tasks").select("*"),
    sb.from("task_assignees").select("*"),
    sb.from("checklist_items").select("*").order("position"),
    sb.from("comments").select("*").order("created_at"),
    sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(100),
    sb.from("ideas").select("*").order("created_at", { ascending: false }),
    // Prüfen, ob 05_prioritaet_kalender.sql schon eingespielt ist (sonst laufen Speichern und Anzeige ohne die neuen Felder)
    sb.from("tasks").select("start_date").limit(1),
    sb.from("ideas").select("priority").limit(1),
    // Prüfen, ob 06_wiederholung.sql schon eingespielt ist
    sb.from("projects").select("recurrence,next_project_id").limit(1),
  ]);
  S.profiles = check(pr) || []; S.projects = check(pj) || []; S.tasks = check(tk) || [];
  S.assignees = check(as) || []; S.checklist = check(ck) || []; S.comments = check(cm) || [];
  S.notifications = check(nt) || [];
  // Ideen: fehlt die Tabelle noch (SQL 03 nicht ausgeführt), läuft der Rest der App trotzdem
  S.ideasMissing = !!id.error; S.ideas = id.error ? [] : id.data || [];
  S.hasStart = !ps.error; S.hasRating = !id.error && !pi.error; S.hasRec = !rc.error;
  S.profile = S.profiles.find((p) => p.id === S.me) || S.profile;
  S.loaded = true;
  emit();
}
const reload = debounce(() => loadAll().catch(() => {}), 400);

let channel;
export function startRealtime() {
  if (channel) return;
  channel = sb.channel("db")
    .on("postgres_changes", { event: "*", schema: "public" }, reload)
    .subscribe();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reload(); });
}
export function stopRealtime() { if (channel) { sb.removeChannel(channel); channel = null; } }

// ---------- Abfragen ----------
export const profile = (id) => S.profiles.find((p) => p.id === id);
export const project = (id) => S.projects.find((p) => p.id === id);
export const task = (id) => S.tasks.find((t) => t.id === id);
export const assigneesOf = (tid) => S.assignees.filter((a) => a.task_id === tid).map((a) => a.user_id);
export const checklistOf = (tid) => S.checklist.filter((c) => c.task_id === tid).sort((a, b) => a.position - b.position);
export const commentsOf = (tid) => S.comments.filter((c) => c.task_id === tid);
export const isAdmin = () => !!S.profile?.is_admin;
export const isMine = (t) => assigneesOf(t.id).includes(S.me);
export const canEdit = (t) => isAdmin() || t.created_by === S.me || isMine(t);
export const activeProfiles = () => S.profiles.filter((p) => p.active);
export const activeProjects = () => S.projects.filter((p) => !p.archived);
export const idea = (id) => S.ideas.find((x) => x.id === id);
export const canEditIdea = (x) => isAdmin() || x.created_by === S.me;
export const openIdeas = () => S.ideas.filter((x) => x.status === "open");
export const unreadCount = () => S.notifications.filter((n) => !n.read_at).length;

export function tasksOfProject(pid) {
  return S.tasks.filter((t) => (pid === "allgemein" ? !t.project_id : t.project_id === pid));
}
export function progress(list) {
  const total = list.length, done = list.filter((t) => t.status === "done").length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}
export function myOpen() { return S.tasks.filter((t) => t.status === "open" && isMine(t) && !archivedTask(t)); }
export function waitingForMe() { return S.tasks.filter((t) => t.status === "review" && t.created_by === S.me); }
export function archivedTask(t) { const p = t.project_id && project(t.project_id); return !!(p && p.archived); }

export function sortTasks(list) {
  return [...list].sort((a, b) => {
    const da = a.due_date || "9999-12-31", db = b.due_date || "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.created_at < b.created_at ? -1 : 1;
  });
}
// ---------- Ideen bewerten ----------
// Priorität einer Idee wie bei Aufgaben: 1 = hoch, 2 = mittel, 3 = niedrig, leer = noch nicht eingestuft
/** Sortierung: "priority" hoch → niedrig (nicht eingestufte unten), bei Gleichstand neueste zuerst; "new" nur nach Datum */
export function sortIdeas(list, by = "priority") {
  const newer = (a, b) => (b.created_at || "").localeCompare(a.created_at || "");
  if (by === "new") return [...list].sort(newer);
  return [...list].sort((a, b) => (a.priority || 9) - (b.priority || 9) || newer(a, b));
}

export function groupByDue(list) {
  const g = { over: [], today: [], week: [], later: [], none: [] };
  for (const t of sortTasks(list)) {
    const d = daysUntil(t.due_date);
    if (d === null) g.none.push(t);
    else if (d < 0) g.over.push(t);
    else if (d === 0) g.today.push(t);
    else if (d <= 7) g.week.push(t);
    else g.later.push(t);
  }
  return [
    ["ÜBERFÄLLIG", g.over, true], ["HEUTE", g.today], ["NÄCHSTE 7 TAGE", g.week], ["SPÄTER", g.later], ["OHNE FRIST", g.none],
  ].filter((x) => x[1].length);
}

// ---------- Änderungen ----------
function taskFields(data) {
  const r = {
    title: data.title, description: data.description || null, project_id: data.project_id || null,
    due_date: data.due_date || null, priority: data.priority || 2, needs_approval: !!data.needs_approval,
  };
  if (S.hasStart) r.start_date = data.start_date || null;
  if (S.hasRec && "recurrence" in data) r.recurrence = data.recurrence || null;
  return r;
}
export async function createTask(data, assignees, checklist) {
  const t = check(await sb.from("tasks").insert(taskFields(data)).select().single());
  if (assignees.length) check(await sb.from("task_assignees").insert(assignees.map((u) => ({ task_id: t.id, user_id: u }))));
  if (checklist.length) check(await sb.from("checklist_items").insert(checklist.map((text, k) => ({ task_id: t.id, text, position: k }))));
  await loadAll();
  return t;
}
export async function updateTask(id, data, assignees) {
  check(await sb.from("tasks").update(taskFields(data)).eq("id", id));
  if (assignees) {
    const cur = assigneesOf(id);
    const add = assignees.filter((u) => !cur.includes(u)), del = cur.filter((u) => !assignees.includes(u));
    if (del.length) check(await sb.from("task_assignees").delete().eq("task_id", id).in("user_id", del));
    if (add.length) check(await sb.from("task_assignees").insert(add.map((u) => ({ task_id: id, user_id: u }))));
  }
  await loadAll();
}
export async function setStatus(id, status) {
  check(await sb.from("tasks").update({ status }).eq("id", id));
  await loadAll();
}
/** Abhaken: mit Bestätigungspflicht → „zur Prüfung“, sonst erledigt */
export async function toggleTask(t) {
  if (t.status === "open") {
    const st = t.needs_approval && t.created_by !== S.me ? "review" : "done";
    await setStatus(t.id, st);
    return st;
  }
  await setStatus(t.id, "open");
  return "open";
}
export async function deleteTask(id) { check(await sb.from("tasks").delete().eq("id", id)); await loadAll(); }

export async function addChecklist(tid, text) {
  const pos = checklistOf(tid).length;
  check(await sb.from("checklist_items").insert({ task_id: tid, text, position: pos }));
  await loadAll();
}
export async function toggleChecklist(item) { check(await sb.from("checklist_items").update({ done: !item.done }).eq("id", item.id)); await loadAll(); }
export async function deleteChecklist(id) { check(await sb.from("checklist_items").delete().eq("id", id)); await loadAll(); }
export async function addComment(tid, body) { check(await sb.from("comments").insert({ task_id: tid, body, user_id: S.me })); await loadAll(); }
export async function deleteComment(id) { check(await sb.from("comments").delete().eq("id", id)); await loadAll(); }
export async function taskEvents(tid) {
  return check(await sb.from("task_events").select("*").eq("task_id", tid).order("created_at", { ascending: false })) || [];
}

export async function createProject(d) {
  const row = { name: d.name, description: d.description || null, owner_id: d.owner_id || null, due_date: d.due_date || null };
  if (S.hasStart) row.start_date = d.start_date || null;
  if (S.hasRec) row.recurrence = d.recurrence || null;
  const p = check(await sb.from("projects").insert(row).select().single());
  await loadAll(); return p;
}
export async function updateProject(id, d) {
  if (!S.hasStart) { d = { ...d }; delete d.start_date; }
  if (!S.hasRec) { d = { ...d }; delete d.recurrence; }
  check(await sb.from("projects").update(d).eq("id", id)); await loadAll(); }
export async function archiveProject(id, on) { await updateProject(id, { archived: on, archived_at: on ? new Date().toISOString() : null }); }
export async function deleteProject(id) { check(await sb.from("projects").delete().eq("id", id)); await loadAll(); }

// ---------- Ideen ----------
function ideaFields(d) {
  const r = { ...d };
  if (!S.hasRating) delete r.priority;
  return r;
}
export async function createIdea(d) {
  check(await sb.from("ideas").insert({ ...ideaFields({ title: d.title, description: d.description || null, project_id: d.project_id || null,
    priority: d.priority || null }), created_by: S.me }));
  await loadAll();
}
export async function updateIdea(id, d) { d = ideaFields(d); check(await sb.from("ideas").update(d).eq("id", id)); await loadAll(); }
export async function deleteIdea(id) { check(await sb.from("ideas").delete().eq("id", id)); await loadAll(); }
/** Idee als übernommen markieren und mit der neuen Aufgabe verknüpfen */
export async function adoptIdea(id, taskId) { await updateIdea(id, { status: "adopted", task_id: taskId }); }
/** Idee als übernommen markieren und mit dem neuen Projekt verknüpfen (braucht 04_ideen_projekt.sql) */
export async function adoptIdeaAsProject(id, projectId) { await updateIdea(id, { status: "adopted", result_project_id: projectId }); }
export async function reopenIdea(id) { await updateIdea(id, { status: "open" }); }

export async function markRead(id) {
  const n = S.notifications.find((x) => x.id === id);
  if (n && !n.read_at) { n.read_at = new Date().toISOString(); emit(); await sb.from("notifications").update({ read_at: n.read_at }).eq("id", id); }
}
export async function markAllRead() {
  const now = new Date().toISOString();
  S.notifications.forEach((n) => { if (!n.read_at) n.read_at = now; }); emit();
  await sb.from("notifications").update({ read_at: now }).eq("user_id", S.me).is("read_at", null);
}
export async function updateProfile(id, d) { check(await sb.from("profiles").update(d).eq("id", id)); await loadAll(); }

export async function adminAction(body) {
  const { data, error } = await sb.functions.invoke("invite-user", { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch (_) { /* */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  await loadAll();
  return data;
}

export async function savePushSubscription(sub) {
  const j = sub.toJSON();
  check(await sb.from("push_subscriptions").upsert({
    user_id: S.me, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200),
  }, { onConflict: "endpoint" }));
}
export async function deletePushSubscription(endpoint) { await sb.from("push_subscriptions").delete().eq("endpoint", endpoint); }
export { todayStr };
