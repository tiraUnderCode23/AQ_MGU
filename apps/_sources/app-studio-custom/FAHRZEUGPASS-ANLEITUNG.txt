BIMMER FAHRZEUGPASS 1.1 – WARTUNG, REIFEN UND FAHRZEUGPROFIL

INSTALLATION / UPDATE
App Studio 2.3.0 öffnen, „Bimmer Fahrzeugpass“ wählen, Sprache wählen,
Verbindung prüfen, Auswahl installieren. Im Fahrzeug heißt die Kachel „Bimmer Pass“.
Bei einem Update NICHT vorher deinstallieren: Deinstallation entfernt die App-Daten.
Die bestehende Wartungshistorie aus Version 1.0 wird beim Einlesen übernommen.
Beim ersten Speichern im neuen Format bleibt zusätzlich vehicle-pass.json.v1.bak
als Kopie der alten Datei erhalten. Vor späteren Änderungen wird die vorige Datei
als vehicle-pass.json.bak gesichert. Diese lokalen Kopien ersetzen kein externes Backup.
Kein erneuter Flash für dein bereits eingerichtetes Fahrzeug nötig.

ÜBERSICHT
Drei Karten wie im Designentwurf: nächste eigene Erinnerung, manueller Kilometerstand
und letzter Service. Darunter Eintrag hinzufügen und Kilometerstand bearbeiten.
Das Modell oben kommt aus deinem Fahrzeugprofil. Die App startet ohne Beispieldaten.
Kilometerstand regelmäßig manuell aktualisieren. Kein Zugriff auf den Kilometerzähler.

WARTUNG
Bis zu 500 Einträge: Arbeit, Datum, Kilometerstand, eigene Erinnerung nach km und/oder
Datum sowie Notiz bis 80 Zeichen. Hinzufügen, Bearbeiten und Löschen mit Bestätigung.
Die neueste Wartung je Kategorie bestimmt deren Erinnerung. Ein neuer Eintrag ohne
Erinnerung hebt eine alte Erinnerung derselben Kategorie auf.
Die Erinnerungen erscheinen in der geöffneten App, nicht als System-Pushmeldungen.
Datum und Kilometer einer Erinnerung müssen nach der dokumentierten Wartung liegen.
Es gibt keine voreingestellten Wartungsintervalle und keine CBS-Änderung.

REIFENÜBERSICHT
Drei getrennte Reifensätze: Sommer, Winter, Ganzjahr.
Für jeden Satz hinterlegst du:
- Reifengröße vorne und hinten (je 48 Zeichen).
- Montagezeitpunkt als Datum.
- Eigene Soll-Drücke vorne und hinten in bar (Schritte 0,1 bar).
- Beladung oder Hinweise (100 Zeichen).
Mit „Diesen Satz aktiv setzen“ bestimmst du den aktuellen Satz. Die Angaben der
anderen Sätze bleiben gespeichert. Beim Öffnen wird zunächst der aktive Satz angezeigt.
Die Drücke sind KEINE Live-Messung und keine Empfehlung der App. Werte aus deinen
Fahrzeugunterlagen passend zu Reifen und Beladung übernehmen. Leere Werte sind erlaubt.
Die Plausibilitätsprüfung der App ersetzt keine Prüfung auf technische Eignung.

FAHRZEUGPROFIL
- Fahrzeug / Modell: 60 Zeichen.
- Umbauten: 240 Zeichen.
- Verwendetes Motoröl: 80 Zeichen.
- Öl-Freigabe / Spezifikation: 80 Zeichen.
- Teilenummern: 240 Zeichen (mehrere Angaben mit Komma oder Semikolon trennen;
  bei Tastatur ohne Semikolon Komma verwenden).
Alle Angaben sind selbst gepflegt. Keine automatische Prüfung einer Freigabe oder
Teilezuordnung. Längere Texte lassen sich in der Profilansicht durch Auswahl der
jeweiligen Zeile vollständig anzeigen. Texte bleiben beim Sprachwechsel erhalten.
Ein ergänzender Zeichensatz stellt deutsche Umlaute auch in der englischen App dar.

EINGABE UND STEUERUNG
Mit Touch oder iDrive-Fokus Feld auswählen. Textfelder öffnen eine Bildschirmtastatur.
Aa wechselt Groß-/Kleinschreibung; Zeichen löschen entfernt das letzte Zeichen.
Fertig übernimmt den Text in den Entwurf. Erst Speichern speichert den ganzen Datensatz.
Abbrechen verwirft die Änderungen der aktuellen Eingabeseite.
-/+ ändern Zahlen und Datumsfelder. Kilometer-Schritte: 1, 100 oder 1000.
Datums-Schritte: 1, 30 oder 365 Tage. Beim leeren Datum setzt der erste Schritt heute.
Wert leeren entfernt optionale Erinnerungen, Druckwerte, Montagezeitpunkt oder Text.
Eine neue Montage oder eine Änderung der Drücke schreibt nicht automatisch einen
Wartungseintrag; diesen kannst du zusätzlich in der Historie anlegen.

Native Tasten als Rückfall:
Page: nächste Hauptseite; in Details Löschbestätigung; in Tastatur Groß-/Kleinschreibung.
Next: nächstes Feld; in der Historie nächster Eintrag; in Reifen nächster Reifensatz;
      in der Tastatur nächstes Zeichen, bei Kilometer-Eingabe nächste Schrittweite.
-/+: Wert ändern bzw. in der Tastatur Zeichen auswählen.
Save: ausgewählten Eintrag öffnen / Datensatz speichern; in Tastatur Zeichen einfügen.
Back: zurück / Entwurf verwerfen; in Tastatur Text in den Entwurf übernehmen.
Die vollständige Bedienung über die gezeichneten Schaltflächen setzt den vorhandenen
GPU-Renderer und dessen Touch-/Controllerfokus voraus.

DATEN, BILDER UND GRENZEN
Daten liegen lokal im App-Datenordner unter vehicle-pass.json. Beschädigte oder
unbekannte Datenformate werden nicht überschrieben; die App meldet den Fehler.
Sicherungen vor Deinstallation/Flash extern kopieren. Kein Cloud-Dienst.
Bilder im Vorschauordner enthalten ausdrücklich Beispieldaten, keine Druck- oder
Ölempfehlungen für deinen BMW. Die installierte App erhält diese Daten nicht.
Das neue App-Symbol und Vorschaubild gehören zum Paket. Bei alter Anzeige nach
einem erfolgreichen Update die Headunit einmal neu starten und den Start abwarten.

KOMPATIBILITÄT UND PRÜFUNG
Diese Version ist für die bestehende iDrive-7-Umgebung gebaut. iDrive 8 ist nicht
bestätigt. SSH-Unterstützung für ID8 ist kein Nachweis für App-/Renderer-Kompatibilität.
42 Python-Tests des Programms, 24 Fahrzeugpass-Tests und 23 Blockspiel-Tests bestanden.
Bedienabläufe und Ansichten wurden in beiden Sprachen lokal im Simulator geprüft.
Die lokale Paketprüfung nutzt einen nicht ausführbaren SDK-Platzhalter, der NICHT
mitgeliefert wird. Der Installer baut mit dem echten SDK deiner Headunit.
Die Änderungen sind noch nicht auf einem realen Fahrzeug getestet. Erster Test im Stand.
