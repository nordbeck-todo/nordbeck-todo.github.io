// „Was ist neu“ – wird nach einem Update einmal beim Start gezeigt
// und ist danach unter Einstellungen bzw. Mehr › „Was ist neu“ wieder aufrufbar.
//
// Pflege: Oben steht das Neueste. Je Fassung kurze Sätze aus Sicht der Nutzer –
// was sie jetzt tun können, nicht was technisch geändert wurde.
// Fassungen ohne sichtbare Änderung bekommen keinen Eintrag.
export const NEUERUNGEN = [
  { fassung: "1.0.30", datum: "12.11.2026", punkte: [
    "„Meine Aufgaben“ und „Alle Aufgaben“ sind jetzt eine Seite „Aufgaben“. Oben umschalten zwischen „Eigene anzeigen“, „Alle anzeigen“ oder den Aufgaben einer bestimmten Person – wie in HERO. Die Auswahl merkt sich die App.",
  ] },
  { fassung: "1.0.29", datum: "12.11.2026", punkte: [
    "Aufgaben können sich jetzt wiederholen – z. B. wöchentlich, monatlich oder jährlich. Einstellen beim Anlegen oder Bearbeiten unter „Wiederholen“. Beim Abhaken legt die App die nächste Aufgabe mit neuer Frist automatisch an.",
    "Auch Projekte lassen sich wiederholen: Beim Archivieren entsteht die nächste Runde mit allen Aufgaben – Termine verschoben, alles wieder offen.",
  ] },
  { fassung: "1.0.28", datum: "12.11.2026", punkte: [
    "Am Handy ist der Kalender jetzt unter „Projekte“ zu finden: oben zwischen „Liste“ und „Kalender“ umschalten.",
  ] },
  { fassung: "1.0.26", datum: "12.11.2026", punkte: [
    "Nach einem Update zeigt die App jetzt kurz, was neu ist – so wie hier. Nachlesen kannst du es jederzeit über „Was ist neu“ – am PC links in der Leiste unter „Einstellungen“, am Handy unter „Mehr“.",
  ] },
  { fassung: "1.0.25", datum: "12.11.2026", punkte: [
    "Der Kalender nutzt am PC jetzt die ganze Bildschirmbreite und ist besser lesbar.",
  ] },
  { fassung: "1.0.24", datum: "12.11.2026", punkte: [
    "Ideen lassen sich nach Priorität einstufen (Hoch, Mittel, Niedrig) – gemeint ist, wie machbar, wichtig und dringend sie insgesamt sind. Die Liste sortiert danach.",
    "Wird eine Idee als Aufgabe übernommen, kommt ihre Priorität mit.",
  ] },
  { fassung: "1.0.23", datum: "12.11.2026", punkte: [
    "Neu: der Kalender mit Zeitbalken für alle Aufgaben, nach Projekten sortiert. Am PC links in der Leiste, am Handy unter „Projekte“, außerdem über den Knopf „Kalender“ auf jeder Projektseite.",
    "Aufgaben und Projekte haben ein neues Feld „Beginn“. Damit reicht der Balken im Kalender vom Beginn bis zur Frist.",
  ] },
];

/** Fassungen als Zahlenfolge vergleichen: "1.0.9" ist kleiner als "1.0.23" */
export function fassungKleiner(a, b) {
  const za = String(a || "0").split(".").map(Number), zb = String(b || "0").split(".").map(Number);
  for (let n = 0; n < Math.max(za.length, zb.length); n++) {
    const x = za[n] || 0, y = zb[n] || 0;
    if (x !== y) return x < y;
  }
  return false;
}
