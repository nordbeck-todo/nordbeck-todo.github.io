-- Nordbeck To-Do – Push-Anbindung (nach 01_schema.sql ausführen)
alter table public.notifications add column if not exists pushed_at timestamptz;

create extension if not exists pg_net;

create or replace function public.notification_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://upezpqibppqeioubfmyf.supabase.co/functions/v1/send-push',
    body    := jsonb_build_object('id', new.id),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  return new;
end $$;

drop trigger if exists notification_push on public.notifications;
create trigger notification_push after insert on public.notifications
  for each row execute function public.notification_push();

-- Rechte für die Server-Funktionen (service_role). Nötig, weil „neue Tabellen automatisch freigeben“ abgeschaltet ist.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
