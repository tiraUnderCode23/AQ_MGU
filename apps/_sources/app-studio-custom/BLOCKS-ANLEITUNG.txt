BIMMER BLOCKS 1.1 – EIGENSTÄNDIGES BLOCKSPIEL

INSTALLATION
In App Studio 2.3.0 nur „Bimmer Blocks“ unter Unterhaltung auswählen.
Deutsch oder English wählen, Verbindung prüfen, Auswahl installieren.
Die Quellen sind enthalten; das Paket wird mit dem SDK deiner Headunit gebaut.
Im Fahrzeug die Kachel „Bimmer Blocks“ öffnen. Kein weiterer Flash nötig.

SPIEL
Sieben Steinformen, 10 x 20 Felder, zufällig gemischte Siebenergruppen.
Reihen vervollständigen, um sie aufzulösen. Nach zehn Reihen steigt das Level.
Punkte pro 1/2/3/4 Reihen: 100/300/500/800 mal aktuelles Level.
Absenken gibt einen Zusatzpunkt pro Feld, Fallenlassen zwei pro Feld.
Die Kontur zeigt, wo der Stein landen wird. Rechts ist der nächste Stein.
Rotation mit einfachen Wandkorrekturen; keine vollständige offizielle SRS-Regel.
Dies ist keine offizielle Tetris-App. Eigene Grafiken, keine externen Downloads.

STANDPRÜFUNG
Das Spiel benötigt Vehicle2.statusCarSpeed2. Bei Bewegung über 0,5 km/h,
ungültigem oder mehr als zehn Sekunden altem Signal pausiert es.
Ohne gültiges Signal ist kein Start möglich. Keine Abschaltoption dieser Prüfung.
Nach Rückkehr zum Stand bewusst „Pause / Weiter“ wählen. Nicht während der Fahrt
bedienen. Die Signalprüfung erkennt nicht, ob eine Parkstellung eingelegt ist.
Auch beim Verlassen der App oder Öffnen eines überlagernden Menüs pausiert das Spiel.

BEDIENUNG
Standard: Bildschirmtasten bzw. native Tasten über den iDrive-Fokus.
Links/Rechts: bewegen. Drehen: im Uhrzeigersinn. Absenken: ein Feld nach unten.
Fallen lassen: sofort bis zur Kontur fallen und ablegen.
Pause / Weiter: anhalten oder fortsetzen. Neues Spiel: starten.
Bei einer noch laufenden/pausierten Partie „Neues Spiel“ innerhalb von fünf Sekunden
nochmals drücken, um die bisherige Partie aufzugeben.

DIREKTSTEUERUNG
„iDrive Direkt / Direct“ ist nach diesem Update einmalig eingeschaltet und kann
in Einstellungen ausgeschaltet werden. Benötigt den GPU-Renderer
und die bereits installierte Controller-Unterstützung. Nur während einer aktiven
Partie wird der Controller übernommen:
- Drehen: Stein nach links/rechts.
- Drücken: Pause.
- Nach links/rechts kippen: Stein ein Feld bewegen.
- Nach unten kippen: sofort fallen lassen und ablegen.
- Nach oben kippen: Stein drehen.
Pause fortsetzen und neues Spiel über Bildschirm-/native Tasten wählen.
BACK und MENU bleiben der Fahrzeugoberfläche vorbehalten. Bei fehlenden direkten
Controllerereignissen zur Standardbedienung zurückkehren. Die Direktsteuerung
wurde lokal anhand der vorhandenen Runtime-Schnittstelle geprüft, nicht am Auto.

SPEICHERUNG
Highscore wird bei Pause, Spielende oder vor einem neuen Spiel im App-Datenordner
als blocks-highscore.json gespeichert, der vorige Stand als .bak.
Eine Partie selbst wird nicht über einen Headunit-Neustart hinweg fortgesetzt.
Deinstallation entfernt die App-Daten. Bei beschädigter Score-Datei wird sie nicht
überschrieben; eine Meldung erscheint. Abruptes Abschalten kann ungespeicherte Punkte
verlieren. Kein Login, keine Cloud und keine Online-Bestenliste.

PRÜFUNG / GRENZEN
23 Tests für Spielregeln, Controllerauswertung und Highscore bestanden.
42 Python-Tests des Programms sowie bestehende Fahrzeugpass-Tests bestanden.
Beide Sprachen gebaut, Bildschirmansichten aus dem echten App-Code gerendert.
Runtime-Simulator prüft Standblockierung, Bewegungs-/Ungültigsignal-Pause,
manuelles Fortsetzen, Hintergrundpause und Neustartbestätigung.
Die lokale Paketprüfung nutzt einen nicht ausführbaren SDK-Platzhalter, der NICHT
mitgeliefert wird. Das Programm verwendet beim Installieren das echte Fahrzeug-SDK.
Start, Steuerung, Lesbarkeit und Geschwindigkeit auf deiner MGU sind noch ungetestet.
Bitte den ersten Test im Stand durchführen. Bei Fehlern das App-/Installationslog senden.
