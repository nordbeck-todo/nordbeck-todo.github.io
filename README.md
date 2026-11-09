# Nordbeck To-Do

Aufgaben-App für Aufgaben außerhalb des Tagesgeschäfts – Tischlermeister Nordbeck GmbH.

- App: https://nordbeck-todo.github.io/
- Backend: Supabase (Region Frankfurt), Projekt `nordbeck-todo`
- `supabase/01_schema.sql` – Tabellen, Rechte, Trigger, Fristerinnerung
- `supabase/02_push.sql` – Push-Anbindung
- `supabase/functions/send-push` – verschickt Push-Nachrichten (Secret: `VAPID_PRIVATE_KEY`)
- `supabase/functions/invite-user` – Nutzer anlegen, Passwort zurücksetzen, sperren (nur Admins)
