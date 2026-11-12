-- =====================================================================
-- Nordbeck To-Do – Wiederholung für Aufgaben und Projekte (Stand 12.11.2026, ab v1.0.29)
-- Einmal im Supabase-SQL-Editor ausführen (nach 01–05). Mehrfaches Ausführen schadet nicht.
--
-- Aufgabe:  Wird eine Aufgabe mit Wiederholung erledigt (auch nach Bestätigung durch den Ersteller),
--           legt die Datenbank sofort die nächste Aufgabe an: gleiche Angaben, Zuständige und
--           Checkliste (wieder offen), Frist und Beginn auf den nächsten Termin verschoben.
-- Projekt:  Wird ein Projekt mit Wiederholung archiviert, entsteht das Projekt neu mit allen
--           Aufgaben (wieder offen, Termine um denselben Abstand verschoben).
--
-- Regel (Spalte recurrence, jsonb):
--   {"unit": "workday" | "day" | "week" | "month" | "year", "every": 1, "until": "2027-12-31"}
--   "tag" (Tag im Monat) setzt die Datenbank selbst, damit z. B. „monatlich am 31.“ nicht wandert.
-- Der nächste Termin richtet sich nach der bisherigen Frist (fester Rhythmus). Wurde verspätet
-- erledigt, wird bis zum ersten Termin ab heute weitergezählt – es entstehen keine überfälligen Kopien.
-- =====================================================================

alter table public.tasks    add column if not exists next_task_id    uuid references public.tasks(id)    on delete set null;
alter table public.projects add column if not exists recurrence      jsonb;
alter table public.projects add column if not exists next_project_id uuid references public.projects(id) on delete set null;

-- ---------- Nächsten Termin berechnen ----------
create or replace function public.recurrence_next(base date, rec jsonb, not_before date) returns date
language plpgsql immutable set search_path = public as $$
declare
  u    text := coalesce(rec->>'unit', '');
  n    int  := greatest(coalesce(nullif(rec->>'every', '')::int, 1), 1);
  tag  int;
  k    int  := 0;
  d    date := base;
  m    date;
  mons int;
begin
  if base is null or u not in ('workday', 'day', 'week', 'month', 'year') then
    return null;
  end if;
  tag := coalesce(nullif(rec->>'tag', '')::int, extract(day from base)::int);
  loop
    k := k + 1;
    exit when k > 20000;                         -- Sicherung gegen Endlosschleife
    if u = 'workday' then
      d := d + 1;
      continue when extract(isodow from d) > 5;  -- Sa/So überspringen
    elsif u = 'day' then
      d := base + k * n;
    elsif u = 'week' then
      d := base + k * n * 7;
    else
      mons := k * n * (case u when 'year' then 12 else 1 end);
      m := (date_trunc('month', base) + make_interval(months => mons))::date;
      -- gewünschter Tag, höchstens der letzte Tag des Monats
      d := m + (least(tag, extract(day from (m + interval '1 month' - interval '1 day'))::int) - 1);
    end if;
    exit when d >= not_before;
  end loop;
  if k > 20000 then return null; end if;
  if nullif(rec->>'until', '') is not null and d > (rec->>'until')::date then
    return null;                                 -- Wiederholung endet
  end if;
  return d;
end $$;

-- Tag im Monat in der Regel festhalten (nur für monatlich/jährlich)
create or replace function public.recurrence_fix(base date, rec jsonb) returns jsonb
language sql immutable as $$
  select case when rec->>'unit' in ('month', 'year') and rec->>'tag' is null and base is not null
              then rec || jsonb_build_object('tag', extract(day from base)::int)
              else rec end;
$$;

-- Aufgabe kopieren (für Wiederholung): Angaben, Zuständige, Checkliste; Termine um "off" Tage verschoben
create or replace function public.copy_task(src uuid, to_project uuid, off int, due date, rec jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t   tasks%rowtype;
  nid uuid;
begin
  select * into t from tasks where id = src;
  insert into tasks (project_id, title, description, priority, start_date, due_date, needs_approval, recurrence, created_by)
  values (to_project, t.title, t.description, t.priority,
          case when t.start_date is not null then least(t.start_date + off, coalesce(due, t.start_date + off)) end,
          due, t.needs_approval, rec, t.created_by)
  returning id into nid;
  insert into task_assignees (task_id, user_id)
    select nid, a.user_id from task_assignees a join profiles p on p.id = a.user_id and p.active where a.task_id = src;
  insert into checklist_items (task_id, text, done, position)
    select nid, c.text, false, c.position from checklist_items c where c.task_id = src;
  update task_events set action = 'repeated' where task_id = nid and action = 'created';
  return nid;
end $$;

-- ---------- Aufgabe erledigt → nächste anlegen ----------
create or replace function public.tasks_recur() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Berlin')::date;
  base  date := coalesce(old.due_date, today);
  rec   jsonb := recurrence_fix(coalesce(old.due_date, today), new.recurrence);
  nd    date;
begin
  -- im archivierten Projekt nichts mehr nachlegen (das neue Projekt hat die Aufgabe schon)
  if new.project_id is not null and exists (select 1 from projects where id = new.project_id and archived) then
    return new;
  end if;
  nd := recurrence_next(base, rec, today);
  if nd is null then return new; end if;
  perform set_config('nbt.recurring', '1', true);
  new.next_task_id := copy_task(new.id, new.project_id, nd - base, nd, rec);
  perform set_config('nbt.recurring', '', true);
  return new;
end $$;
drop trigger if exists tasks_recur on public.tasks;
create trigger tasks_recur before update on public.tasks
  for each row
  when (new.status = 'done' and old.status <> 'done' and new.recurrence is not null and new.next_task_id is null)
  execute function public.tasks_recur();

-- ---------- Projekt archiviert → nächste Runde anlegen ----------
create or replace function public.projects_recur() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Europe/Berlin')::date;
  base  date := coalesce(old.due_date, old.start_date, today);
  rec   jsonb := recurrence_fix(coalesce(old.due_date, old.start_date, today), new.recurrence);
  nd    date;
  off   int;
  npid  uuid;
  t     record;
begin
  nd := recurrence_next(base, rec, today);
  if nd is null then return new; end if;
  off := nd - base;
  insert into projects (name, description, owner_id, start_date, due_date, recurrence, created_by)
  values (new.name, new.description, new.owner_id, new.start_date + off, new.due_date + off, rec, new.created_by)
  returning id into npid;
  perform set_config('nbt.recurring', '1', true);
  -- alle Aufgaben des Projekts; von wiederholten Aufgaben nur die jüngste
  for t in select id, due_date, recurrence from tasks where project_id = new.id and next_task_id is null order by created_at loop
    perform copy_task(t.id, npid, off, t.due_date + off, recurrence_fix(t.due_date, t.recurrence));
  end loop;
  perform set_config('nbt.recurring', '', true);
  new.next_project_id := npid;
  return new;
end $$;
drop trigger if exists projects_recur on public.projects;
create trigger projects_recur before update on public.projects
  for each row
  when (new.archived and not old.archived and new.recurrence is not null and new.next_project_id is null)
  execute function public.projects_recur();

-- ---------- Zuweisung → Benachrichtigung (wie in 01, aber nicht für automatisch wiederholte Aufgaben;
--            an die Frist erinnert die tägliche Fristerinnerung wie gewohnt) ----------
create or replace function public.assignee_added() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks%rowtype;
  who text := coalesce((select name from profiles where id = auth.uid()), 'Jemand');
begin
  if coalesce(current_setting('nbt.recurring', true), '') = '1' then
    return new;
  end if;
  select * into t from tasks where id = new.task_id;
  if new.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) then
    insert into notifications (user_id, task_id, kind, title, body) values (
      new.user_id, new.task_id, 'assigned', 'Neue Aufgabe: ' || t.title,
      who || ' hat dir eine Aufgabe zugewiesen' ||
      case when t.due_date is not null then ' – fällig am ' || to_char(t.due_date, 'DD.MM.YYYY') else '' end || '.');
  end if;
  return new;
end $$;

revoke execute on function public.copy_task(uuid, uuid, int, date, jsonb) from public, anon, authenticated;

-- Schema-Cache der API neu laden, damit die neuen Spalten sofort bekannt sind
notify pgrst, 'reload schema';
