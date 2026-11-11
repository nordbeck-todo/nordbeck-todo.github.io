-- =====================================================================
-- Nordbeck To-Do – Erweiterung „Ideen“ (Stand 11.11.2026, ab v1.0.19)
-- Einmal im Supabase-SQL-Editor ausführen. Mehrfaches Ausführen schadet nicht.
-- =====================================================================

create table if not exists public.ideas (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  project_id   uuid references public.projects(id) on delete set null,   -- optional: passt zu Projekt …
  status       text not null default 'open' check (status in ('open','adopted')),
  task_id      uuid references public.tasks(id) on delete set null,       -- daraus entstandene Aufgabe
  adopted_by   uuid references public.profiles(id) on delete set null,
  adopted_at   timestamptz,
  created_by   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists ideas_status_idx on public.ideas(status, created_at desc);

-- Zeitstempel und „übernommen von/am“ automatisch setzen
create or replace function public.ideas_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'adopted' and old.status <> 'adopted' then
    new.adopted_at := now();
    new.adopted_by := auth.uid();
  elsif new.status = 'open' then
    new.adopted_at := null;
    new.adopted_by := null;
    new.task_id := null;
  end if;
  return new;
end $$;
drop trigger if exists ideas_before_update on public.ideas;
create trigger ideas_before_update before update on public.ideas
  for each row execute function public.ideas_before_update();

-- Rechte: alle sehen und notieren; übernehmen darf jeder (kleines Team),
-- bearbeiten regelt die App (Ersteller, Admin); löschen nur Ersteller und Admin
alter table public.ideas enable row level security;
drop policy if exists ideas_select on public.ideas;
create policy ideas_select on public.ideas for select to authenticated using (is_active_user());
drop policy if exists ideas_insert on public.ideas;
create policy ideas_insert on public.ideas for insert to authenticated
  with check (is_active_user() and created_by = auth.uid());
drop policy if exists ideas_update on public.ideas;
create policy ideas_update on public.ideas for update to authenticated
  using (is_active_user()) with check (is_active_user());
drop policy if exists ideas_delete on public.ideas;
create policy ideas_delete on public.ideas for delete to authenticated
  using (is_admin() or created_by = auth.uid());

grant select, insert, update, delete on public.ideas to authenticated;
grant all on public.ideas to service_role;

-- Live-Aktualisierung in der App
do $$ begin
  begin alter publication supabase_realtime add table public.ideas; exception when others then null; end;
end $$;
