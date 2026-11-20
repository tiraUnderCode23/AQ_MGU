# idrive7-motordaten

**Motordaten** als App für BMW mit **iDrive 7 (MGU)** – dieselbe App wie die
Motordaten-App für den G87 M2 (iDrive 8), nur auf dem MGU App Kit. Zeigt live die
Werte der Motorsteuerung: Drehzahl, Öl-/Kühlmittel-/Ansaug-/Abgas-/Getriebe­temperatur,
Lade- und Öldruck, Last, Leistung/Drehmoment, Klopfen, Bordnetz.

Angelegt für einen G20 (B58, Benziner G-Serie). Installiert und aktualisiert über
den [mgu-store](https://github.com/robertnisipeanu/mgu-store).

## Stand

- **Alle Seiten wie die iDrive-8-App:** Live, Maximalwerte, Logs, Fehler,
  Einstellungen (Tab-Leiste, Drehzahlband, Gauges, Spitzenwerte, Rekorde).
- **MHD Max Cooling:** Die App erkennt selbst, ob die DME mit MHD läuft (einmalige
  harmlose Abfrage „Max Cooling aus") und zeigt den Knopf nur dann. Einschalten nur
  bei laufendem Motor. Abschaltbar unter Einstellungen.
- **Live-Seite fürs iD7 (ab 0.4.0):** eigene, größere Aufteilung für den 10,25″-Bildschirm
  (`dash7.js`): Drehzahl, Öltemperatur, Ladedruck, Öldruck groß, darunter die übrigen Werte.
- **MHD-Abgasklappe (ab 0.4.0):** Knopf „Klappe: Auto / Auf / Zu" (`2F 02 00/01/02`, nur mit
  MHD-Echo). „Zu" gibt über 4.000 U/min an die Motorsteuerung ab und schließt unter 3.500 U/min
  wieder; ohne Drehzahl (2 s) ebenfalls an die Motorsteuerung. Schalter aus oder App-Ende: eine gehaltene
  Klappe geht an die Motorsteuerung zurück. Anfangs aus: einschalten unter Einstellungen › MHD-Tuning.
- **Öltemperatur:** erster glaubhafter Wert aus 4402, 5822 und dem Fahrzeugsignal (am G20
  lieferte 4402 0 °C).
- **Fehlerspeicher:** lesen bei allen Steuergeräten; **löschen** nur bei Zündung an
  und Motor aus, mit Bestätigung, Steuergerät für Steuergerät, nie die Headunit.
- **Bedienung (ab 0.3.0):** Antippen und Controller (drehen/drücken) auf allen
  Knöpfen und Tabs. Rekorde bleiben nach Neustart erhalten, Fehlertexte werden
  einmal mit Internet (Store-Uplink) geladen und dann offline genutzt.
- Diagnose-Abfragen laufen nur, solange die App sichtbar ist oder ein Log aufzeichnet.
- Nicht vorhanden: USB-Export der Logs (auf iDrive 7 nicht verfügbar).
- Gilt für G-Serie-Benziner mit DME8FF_R, also **B58 und S58** (auch B48/B38).

## Installieren

1. Im Store: **Einstellungen → Quelle hinzufügen**, `Prototype019/idrive7-motordaten`
   eingeben, **Branch main** wählen.
2. **Motordaten** installieren, Headunit einmal neu starten, App öffnen.

## Aufbau

```
apps/km_motordaten/
  app.json        Manifest: Signale (CDS, InternalTasu), Screen, Einstellungen
  main.js         Kit-Einstieg: Werte-Loop (UDS 0x22), MHD-Erkennung, Max Cooling,
                  Fehler lesen/löschen, Render dash.js → Bild, Eingabe
  dash.js, decode.js, limits.js, faults.js, logbook.js, records.js, kit_canvas.js …
                  die Zeichen-/Logik-Module der iDrive-8-App, 1:1 übernommen
                  (flach im App-Ordner, weil der Build alle Module flach ablegt)
  icon.png
kit/              MGU App Kit (fremd, MIT – siehe kit/UPSTREAM_COMMIT)
mgu-repo.json     sagt dem Store: Apps unter apps/*, Build mit kit/tools/build.py,
                  dazu die Tools GPU-Renderer und Controller-Gate
```

## Technik, kurz

`dash.js` zeichnet die Seiten (2880×764, wie am M2) als Vektor-Zeichenbefehle in den
Recorder des Kits, auf den ID7-Bildbereich (1600×520) skaliert und über `ui.image`
ausgegeben; die Knöpfe sind Kit-Ziele (`cv.target`), dadurch gehen Touch und
Controller. Pixelbilder würden vom nativen Renderer verworfen und sperren die
Eingabe. Schriften: Barlow als Kit-Atlanten (`kit/runtime/fonts/md_*.json`, OFL).
Die Werte liest `main.js` per UDS-Diagnose (`0x22 ReadDataByIdentifier`) aus der DME
(0x12), dem Getriebe (EGS 0x18) und einer OBD-PID – über `kit/diag.js`, dekodiert
mit `decode.js` (DME8FF_R). Alle Diagnose-Anfragen laufen nacheinander über eine
Warteschlange, damit ein Schreibbefehl nie mit dem Polling kollidiert. Das
MHD-Ergebnis wird gespeichert (bei „kein MHD" nach 7 Tagen neu geprüft).

## Grundlagen und Lizenzen

- `kit/` – **MGU App Kit** aus
  [cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps)
  (MIT), vollständig übernommen (Renderer + Controller-Gate werden mitinstalliert);
  Vorlage für den App-Aufbau war dort `car_vitals`.
- Die Zeichen-/Logik-Module (`dash.js` usw.) – unsere eigenen aus
  [Prototype019/motordaten](https://github.com/Prototype019/motordaten) (iDrive-8-App).
- DID-Tabellen/Decodierung aus dem genannten `idrive7-apps`-Projekt (DME8FF_R, aus
  der öffentlichen EdiabasX-Referenz).

## Rechtliches

Arbeit am eigenen Fahrzeug. Schreibzugriffe gibt es genau zwei, beide vom Fahrer
ausgelöst: MHD Max Cooling (nur mit MHD-DME) und Fehlerspeicher löschen.
Enthält keine BMW-Software und keine Fahrzeug-Identdaten.

## Lizenz

MIT (siehe [LICENSE](LICENSE)). Das Kit unter `kit/` behält seine eigene
MIT-Lizenz (`kit/LICENSE.kit`). Die Barlow-Schriften stehen unter der SIL OFL 1.1
(`apps/km_motordaten/LICENSE`, wird mit ausgeliefert).
