# Nordbeck To-Do

Aufgaben-App für Aufgaben außerhalb des Tagesgeschäfts – Tischlermeister Nordbeck GmbH.

- App: https://nordbeck-todo.github.io/
- Backend: Supabase (Region Frankfurt), Projekt `nordbeck-todo`
- `supabase/01_schema.sql` – Tabellen, Rechte, Trigger, Fristerinnerung
- `supabase/02_push.sql` – Push-Anbindung
- `supabase/03_ideen.sql` – Ideen-Bereich (ab v1.0.19)
- `supabase/04_ideen_projekt.sql` – Ideen auch als Projekt übernehmen (ab v1.0.22)
- `supabase/05_prioritaet_kalender.sql` – Ideen-Priorität, „Beginn“ für Kalender/Gantt, enthält auch 04 (ab v1.0.23)
- `supabase/functions/send-push` – verschickt Push-Nachrichten (Secret: `VAPID_PRIVATE_KEY`)
- `supabase/functions/invite-user` – Nutzer anlegen, Passwort zurücksetzen, sperren (nur Admins)
