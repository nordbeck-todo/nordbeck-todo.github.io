-- =====================================================================
-- Nordbeck To-Do – Ideen auch als Projekt übernehmen (Stand 11.11.2026, ab v1.0.22)
-- Einmal im Supabase-SQL-Editor ausführen. Mehrfaches Ausführen schadet nicht.
-- =====================================================================

-- daraus entstandenes Projekt (analog zu task_id)
alter table public.ideas add column if not exists result_project_id uuid references public.projects(id) on delete set null;

-- beim Zurücksetzen auf „offen“ auch die Projekt-Verknüpfung lösen
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

-- Schema-Cache der API neu laden, damit die neue Spalte sofort bekannt ist
notify pgrst, 'reload schema';
