-- =====================================================================
-- Nordbeck To-Do – Ideen bewerten + Kalender/Gantt (Stand 12.11.2026, ab v1.0.23)
-- Einmal im Supabase-SQL-Editor ausführen. Mehrfaches Ausführen schadet nicht.
-- =====================================================================

-- Ideen: Bewertung je Kriterium 1 = niedrig, 2 = mittel, 3 = hoch (leer = noch nicht bewertet)
alter table public.ideas add column if not exists feasibility smallint check (feasibility between 1 and 3);  -- Machbarkeit
alter table public.ideas add column if not exists relevance   smallint check (relevance between 1 and 3);    -- Relevanz
alter table public.ideas add column if not exists priority    smallint check (priority between 1 and 3);     -- Priorität

-- Kalender/Gantt: optionaler Beginn für Aufgaben und Projekte (Balken von Beginn bis Frist bzw. Enddatum)
alter table public.tasks    add column if not exists start_date date;
alter table public.projects add column if not exists start_date date;

-- Schema-Cache der API neu laden, damit die neuen Spalten sofort bekannt sind
notify pgrst, 'reload schema';
