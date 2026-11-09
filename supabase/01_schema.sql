-- =====================================================================
-- Nordbeck To-Do – Datenbank-Schema (Supabase / Postgres)
-- Stand: 09.11.2026
-- =====================================================================

-- ---------- Profile (ein Eintrag je Nutzer) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  email       text,
  color       text not null default '#3b6fd4',
  is_admin    boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- Projekte ----------
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  owner_id     uuid references public.profiles(id) on delete set null,
  due_date     date,
  archived     boolean not null default false,
  archived_at  timestamptz,
  created_by   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

-- ---------- Aufgaben ----------
create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references public.projects(id) on delete cascade,  -- null = „Allgemein“
  title           text not null,
  description     text,
  priority        smallint not null default 2 check (priority between 1 and 3), -- 1 hoch, 2 mittel, 3 niedrig
  due_date        date,
  status          text not null default 'open' check (status in ('open','review','done')),
  needs_approval  boolean not null default false,
  done_at         timestamptz,
  done_by         uuid references public.profiles(id) on delete set null,
  recurrence      jsonb,      -- vorbereitet für wiederkehrende Aufgaben (später)
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tasks_project_idx on public.tasks(project_id);
create index if not exists tasks_due_idx on public.tasks(due_date) where status <> 'done';

-- ---------- Zuständige je Aufgabe ----------
create table if not exists public.task_assignees (
  task_id  uuid references public.tasks(id) on delete cascade,
  user_id  uuid references public.profiles(id) on delete cascade,
  primary key (task_id, user_id)
);
create index if not exists task_assignees_user_idx on public.task_assignees(user_id);

-- ---------- Checkliste ----------
create table if not exists public.checklist_items (
  id        uuid primary key default gen_random_uuid(),
  task_id   uuid not null references public.tasks(id) on delete cascade,
  text      text not null,
  done      boolean not null default false,
  position  integer not null default 0
);
create index if not exists checklist_task_idx on public.checklist_items(task_id);

-- ---------- Kommentare ----------
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null default auth.uid(),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists comments_task_idx on public.comments(task_id);

-- ---------- Protokoll (wer hat wann was gemacht) ----------
create table if not exists public.task_events (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  action      text not null,   -- created, done, review, approved, reopened
  created_at  timestamptz not null default now()
);
create index if not exists task_events_task_idx on public.task_events(task_id);

-- ---------- Benachrichtigungen (Glocke + Grundlage für Push) ----------
create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  task_id     uuid references public.tasks(id) on delete cascade,
  kind        text not null,   -- assigned, due_soon, due_today, overdue, done, review, comment
  title       text not null,
  body        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

-- ---------- Push-Abos (ein Eintrag je Gerät) ----------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- ---------- Merker, damit Fristerinnerungen nicht doppelt kommen ----------
create table if not exists public.reminder_log (
  task_id  uuid references public.tasks(id) on delete cascade,
  user_id  uuid references public.profiles(id) on delete cascade,
  kind     text not null,
  sent_on  date not null,
  primary key (task_id, user_id, kind, sent_on)
);

-- =====================================================================
-- Hilfsfunktionen
-- =====================================================================
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and is_admin);
$$;

create or replace function public.is_task_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tasks where id = t and created_by = auth.uid())
      or exists (select 1 from task_assignees where task_id = t and user_id = auth.uid());
$$;

-- Neues Konto → Profil anlegen (Name aus der Einladung)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Trigger: Status, Protokoll, Benachrichtigungen
-- =====================================================================
create or replace function public.tasks_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'done' and old.status <> 'done' then
    new.done_at := now();
    new.done_by := coalesce(new.done_by, auth.uid());
  elsif new.status = 'review' and old.status = 'open' then
    new.done_by := auth.uid();
  elsif new.status = 'open' then
    new.done_at := null;
    new.done_by := null;
  end if;
  return new;
end $$;
drop trigger if exists tasks_before_update on public.tasks;
create trigger tasks_before_update before update on public.tasks
  for each row execute function public.tasks_before_update();

create or replace function public.tasks_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text := coalesce((select name from profiles where id = auth.uid()), 'Jemand');
begin
  if tg_op = 'INSERT' then
    insert into task_events (task_id, user_id, action) values (new.id, auth.uid(), 'created');
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into task_events (task_id, user_id, action) values (new.id, auth.uid(),
      case when new.status = 'done' and old.status = 'review' then 'approved'
           else case new.status when 'done' then 'done' when 'review' then 'review' else 'reopened' end end);
    -- Ersteller informieren (nicht, wenn er es selbst war)
    if new.created_by is not null and new.created_by <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
       and new.status in ('done','review') then
      insert into notifications (user_id, task_id, kind, title, body) values (
        new.created_by, new.id, new.status,
        case new.status when 'done' then 'Erledigt: ' else 'Bitte prüfen: ' end || new.title,
        who || case new.status when 'done' then ' hat die Aufgabe abgehakt.' else ' hat die Aufgabe erledigt und wartet auf deine Bestätigung.' end);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tasks_after_change on public.tasks;
create trigger tasks_after_change after insert or update on public.tasks
  for each row execute function public.tasks_after_change();

-- Zuweisung → Benachrichtigung
create or replace function public.assignee_added() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks%rowtype;
  who text := coalesce((select name from profiles where id = auth.uid()), 'Jemand');
begin
  select * into t from tasks where id = new.task_id;
  if new.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) then
    insert into notifications (user_id, task_id, kind, title, body) values (
      new.user_id, new.task_id, 'assigned', 'Neue Aufgabe: ' || t.title,
      who || ' hat dir eine Aufgabe zugewiesen' ||
      case when t.due_date is not null then ' – fällig am ' || to_char(t.due_date, 'DD.MM.YYYY') else '' end || '.');
  end if;
  return new;
end $$;
drop trigger if exists assignee_added on public.task_assignees;
create trigger assignee_added after insert on public.task_assignees
  for each row execute function public.assignee_added();

-- Kommentar → Benachrichtigung an Ersteller und Zuständige (außer Verfasser)
create or replace function public.comment_added() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks%rowtype;
  who text := coalesce((select name from profiles where id = new.user_id), 'Jemand');
begin
  select * into t from tasks where id = new.task_id;
  insert into notifications (user_id, task_id, kind, title, body)
  select u, new.task_id, 'comment', 'Kommentar: ' || t.title, who || ': ' || left(new.body, 140)
  from (select t.created_by as u union select user_id from task_assignees where task_id = new.task_id) x
  where u is not null and u <> new.user_id
    and exists (select 1 from profiles p where p.id = u and p.active);
  return new;
end $$;
drop trigger if exists comment_added on public.comments;
create trigger comment_added after insert on public.comments
  for each row execute function public.comment_added();

-- =====================================================================
-- Tägliche Fristerinnerung (Mo–Fr 7:00 Uhr deutscher Zeit)
-- Wochenende: was Sa/So fällig gewesen wäre, kommt am Montag.
-- =====================================================================
create or replace function public.send_due_reminders(force boolean default false) returns integer
language plpgsql security definer set search_path = public as $$
declare
  local_now timestamp := now() at time zone 'Europe/Berlin';
  today date := local_now::date;
  dow int := extract(isodow from local_now);   -- 1 = Montag … 7 = Sonntag
  n int := 0;
  r record;
  k text;
  d int;
begin
  if not force and (extract(hour from local_now) <> 7 or dow > 5) then
    return 0;
  end if;

  for r in
    select t.id, t.title, t.due_date, a.user_id
    from tasks t
    join task_assignees a on a.task_id = t.id
    join profiles p on p.id = a.user_id and p.active
    left join projects pr on pr.id = t.project_id
    where t.status = 'open' and t.due_date is not null
      and coalesce(pr.archived, false) = false
  loop
    d := r.due_date - today;
    k := case
           when d < 0 then 'overdue'
           when d = 0 then 'due_today'
           when d = 2 or (dow = 1 and d = 1) then 'due_soon'
           else null
         end;
    continue when k is null;
    continue when exists (select 1 from reminder_log l
                          where l.task_id = r.id and l.user_id = r.user_id and l.kind = k and l.sent_on = today);
    insert into reminder_log values (r.id, r.user_id, k, today);
    insert into notifications (user_id, task_id, kind, title, body) values (
      r.user_id, r.id, k,
      case k when 'overdue' then 'Überfällig: ' when 'due_today' then 'Heute fällig: ' else 'Bald fällig: ' end || r.title,
      case k when 'overdue' then 'War fällig am ' || to_char(r.due_date, 'DD.MM.YYYY') || '.'
             when 'due_today' then 'Diese Aufgabe ist heute fällig.'
             else 'Fällig am ' || to_char(r.due_date, 'DD.MM.YYYY') || '.' end);
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================
-- Zeilenrechte (Row Level Security)
-- =====================================================================
alter table public.profiles           enable row level security;
alter table public.projects           enable row level security;
alter table public.tasks              enable row level security;
alter table public.task_assignees     enable row level security;
alter table public.checklist_items    enable row level security;
alter table public.comments           enable row level security;
alter table public.task_events        enable row level security;
alter table public.notifications      enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_log       enable row level security;

-- Profile: alle aktiven Nutzer sehen alle; eigenes Profil bearbeiten (ohne Admin-Felder); Admins alles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (is_active_user());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid()
    and is_admin = (select p.is_admin from profiles p where p.id = auth.uid())
    and active   = (select p.active   from profiles p where p.id = auth.uid()));
drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles for update to authenticated using (is_admin()) with check (is_admin());

-- Projekte: alle sehen und anlegen; bearbeiten Verantwortlicher, Ersteller, Admin; löschen Ersteller, Admin
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated using (is_active_user());
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated with check (is_active_user());
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated
  using (is_admin() or owner_id = auth.uid() or created_by = auth.uid());
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete to authenticated
  using (is_admin() or created_by = auth.uid());

-- Aufgaben: alle sehen und anlegen; bearbeiten Ersteller, Zuständige, Admin; löschen Ersteller, Admin
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated using (is_active_user());
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated with check (is_active_user());
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (is_admin() or is_task_member(id));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (is_admin() or created_by = auth.uid());

-- Zuständige: alle sehen; setzen/entfernen Ersteller, Zuständige, Admin
drop policy if exists assignees_select on public.task_assignees;
create policy assignees_select on public.task_assignees for select to authenticated using (is_active_user());
drop policy if exists assignees_write on public.task_assignees;
create policy assignees_write on public.task_assignees for all to authenticated
  using (is_admin() or is_task_member(task_id)) with check (is_admin() or is_task_member(task_id));

-- Checkliste: alle sehen; bearbeiten Ersteller, Zuständige, Admin
drop policy if exists checklist_select on public.checklist_items;
create policy checklist_select on public.checklist_items for select to authenticated using (is_active_user());
drop policy if exists checklist_write on public.checklist_items;
create policy checklist_write on public.checklist_items for all to authenticated
  using (is_admin() or is_task_member(task_id)) with check (is_admin() or is_task_member(task_id));

-- Kommentare: alle sehen und schreiben; eigene bearbeiten/löschen; Admin löscht alles
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated using (is_active_user());
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (is_active_user() and user_id = auth.uid());
drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments for update to authenticated using (user_id = auth.uid());
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated using (user_id = auth.uid() or is_admin());

-- Protokoll: nur lesen (geschrieben wird per Trigger)
drop policy if exists events_select on public.task_events;
create policy events_select on public.task_events for select to authenticated using (is_active_user());

-- Benachrichtigungen: nur eigene lesen und als gelesen markieren
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- Push-Abos: nur eigene
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- reminder_log: kein Zugriff für die App (nur intern)

-- =====================================================================
-- Freigaben für die App (automatisches Freigeben ist abgeschaltet)
-- =====================================================================
grant usage on schema public to authenticated;
grant select, update                 on public.profiles           to authenticated;
grant select, insert, update, delete on public.projects           to authenticated;
grant select, insert, update, delete on public.tasks              to authenticated;
grant select, insert, update, delete on public.task_assignees     to authenticated;
grant select, insert, update, delete on public.checklist_items    to authenticated;
grant select, insert, update, delete on public.comments           to authenticated;
grant select                         on public.task_events        to authenticated;
grant select, update, delete         on public.notifications      to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant execute on function public.is_active_user(), public.is_admin(), public.is_task_member(uuid) to authenticated;
revoke execute on function public.send_due_reminders(boolean) from public, anon, authenticated;

-- Live-Aktualisierung in der App
do $$ begin
  begin alter publication supabase_realtime add table public.tasks;           exception when others then null; end;
  begin alter publication supabase_realtime add table public.task_assignees;  exception when others then null; end;
  begin alter publication supabase_realtime add table public.checklist_items; exception when others then null; end;
  begin alter publication supabase_realtime add table public.comments;        exception when others then null; end;
  begin alter publication supabase_realtime add table public.notifications;   exception when others then null; end;
  begin alter publication supabase_realtime add table public.projects;        exception when others then null; end;
end $$;

-- =====================================================================
-- Zeitplan: Fristerinnerung (pg_cron). Läuft 5:00 und 6:00 UTC,
-- die Funktion selbst prüft auf 7 Uhr deutscher Zeit (Sommer/Winter).
-- =====================================================================
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'fristerinnerung';
select cron.schedule('fristerinnerung', '0 5,6 * * 1-5', $$select public.send_due_reminders()$$);
