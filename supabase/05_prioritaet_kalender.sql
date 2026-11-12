-- =====================================================================
-- Nordbeck To-Do – Ideen-Priorität + Kalender/Gantt (Stand 12.11.2026, ab v1.0.23)
-- Enthält auch 04_ideen_projekt.sql. Einmal im Supabase-SQL-Editor ausführen.
-- Mehrfaches Ausführen schadet nicht.
-- =====================================================================

-- Ideen: daraus entstandenes Projekt (aus 04, falls noch nicht eingespielt)
alter table public.ideas add column if not exists result_project_id uuid references public.projects(id) on delete set null;

-- Ideen: Priorität wie bei Aufgaben (1 = hoch, 2 = mittel, 3 = niedrig, leer = noch nicht eingestuft)
alter table public.ideas add column if not exists priority smallint check (priority between 1 and 3);

-- Kalender/Gantt: optionaler Beginn für Aufgaben und Projekte
alter table public.tasks    add column if not exists start_date date;
alter table public.projects add column if not exists start_date date;

-- beim Zurücksetzen einer Idee auf „offen“ auch die Verknüpfungen lösen (aus 04)
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
    new.result_project_id := null;
  end if;
  return new;
end $$;

-- Schema-Cache der API neu laden, damit die neuen Spalten sofort bekannt sind
notify pgrst, 'reload schema';
