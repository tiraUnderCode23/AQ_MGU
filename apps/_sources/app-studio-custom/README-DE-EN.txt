MGU APP STUDIO 2.4.0 – PORTABLE PROJEKTVERSION / PORTABLE SOURCE EDITION

DEUTSCH
Diese ZIP enthält die SSH-Quellen inklusive der vom SSH-Projekt mitgelieferten
Debug-Assets sowie den App-Baukasten, alle 25 App-Quellen und Vorschaubilder.
Separate Projektordner auf dem Desktop sind nicht mehr nötig.
Keine persönlichen Schlüssel, Fahrzeugdaten oder gespeicherten Einstellungen enthalten.

START
1. Den kompletten ZIP-Inhalt in einen beschreibbaren Ordner entpacken.
2. START.cmd unter Windows als Administrator starten.
3. Oben die Programmsprache Deutsch / English wählen.
4. Verbindung prüfen, App-Sprache und Apps wählen, Auswahl installieren.
   Der Erstflash bleibt eine separate, ausdrücklich zu bestätigende Option.
   Vor Erstflash Codierungsbackup anfertigen; Digital Keys können verloren gehen.
5. Nach erfolgreicher Registrierung erscheint die Abschlussmeldung.

Die Quellversion benötigt Python 3.10+ inklusive Tkinter, Node 18+,
PowerShell 7 und Windows OpenSSH (ssh, scp, ssh-keygen, ssh-keyscan).
Diese Programme sind auf deinem bisher verwendeten Rechner bereits weitgehend vorhanden.
Beim ersten Einsatz wird im integrierten SSH-Ordner eine Python-Umgebung erstellt;
cryptography wird bei Bedarf aus requirements.txt installiert (Internet erforderlich).
Der fahrzeugspezifische OAP-SDK wird weiterhin vom eigenen Fahrzeug ausgelesen.
Doom lädt beim ersten Build Freedoom nach. Die Quellversion ist daher NICHT vollständig offline.

WINDOWS-STANDALONE-EXE ERSTELLEN
Eine kompilierte Windows-EXE liegt dieser ZIP NICHT bei. Der Build muss einmal
auf Windows x64 ausgeführt werden. Auf dem Build-Rechner werden Python (als
python.exe), Node, PowerShell 7 und OpenSSH benötigt. PowerShell im entpackten
Ordner öffnen und ausführen:
  powershell -NoProfile -ExecutionPolicy Bypass -File .\BUILD-STANDALONE.ps1
Der Build installiert PyInstaller/cryptography nur in .build-env und kopiert
Node, PowerShell und OpenSSH aus der lokalen Installation in das Paket.
Er verbindet sich NICHT mit dem Fahrzeug. Internet wird für Build-Pakete benötigt.
Ergebnis: dist\MGU-App-Studio\MGU-App-Studio.exe
Den GANZEN Ergebnisordner verwenden/weitergeben, nicht nur die EXE.
Python/Tk/cryptography und die Werkzeuge liegen dann mit im Ergebnisordner.
Persönliche Schlüssel, SDK-Ausgaben und Protokolle werden vom Build ausgeschlossen.
Ein gebautes Paket enthält somit kein fahrzeugspezifisches Material.
Die EXE-Bauanleitung ist vorbereitet, hier aber nicht auf Windows ausgeführt/getestet.

SPRACHEN UND SPIELE
Programmsprache und App-Sprache sind unabhängig. Die Programmsprache wird gespeichert.
Technische Originalmeldungen in Protokollen/Fehlerdetails können Deutsch/Englisch bleiben.
Bestehende Apps nutzen das beiliegende DE-/EN-Paket.
Die acht zusätzlichen aurelm-Spiele bleiben IM FAHRZEUG zunächst Englisch,
auch bei App-Sprache Deutsch. Ihre Auswahlkarten sind in beiden Sprachen vorhanden.
Spielauswahl: Snake, Track Defender, Pit Wall, Lucky Sevens, Blackjack,
Solitaire, Apex Chase, Street Siege. Casino-Spiele verwenden nur Spielgeld.
Die Bilder stammen aus den mitgelieferten Projekt-Demos, nicht aus deinem Fahrzeug.
Spielsteuerung und Fahrzeugkompatibilität müssen am stehenden Fahrzeug geprüft werden.
Unterstütztes Ziel dieser Studio-Version: MGU iDrive 7. Keine ID8-Freigabe.

DATEN UND UPDATES
Schlüssel werden unter projects\ssh\data\enrollments\<VIN> gespeichert.
Logs stehen in logs. Diese Ordner nach Verwendung nicht öffentlich weitergeben.
Wenn du zuvor einen eigenen SSH-Schlüssel eingerichtet hast, übernimm den passenden
VIN-Ordner aus deinem bisherigen SSH-Projekt lokal in diesen Pfad.
Bei einem unveränderten Standard-Debug-Schlüssel kann das Tool ihn beim Aktivieren
selbst erzeugen. Es wird kein Erstflash automatisch als Ersatz für einen Loginfehler gestartet.
Geänderte Hostschlüssel benötigen weiterhin eine ausdrückliche Bestätigung.
Zum Aktualisieren eine frische ZIP in einen neuen Ordner entpacken.
Die alten Fahrzeugschlüssel/Logs bei Bedarf separat sichern; keine Test-SDKs kopieren.
Entfernen löscht ausgewählte Apps samt App-Daten. Ein Neustart kann nötig sein,
bis entfernte Kacheln verschwinden. Neustart wird nur einmal angefordert.
SSH/Debug deaktivieren lässt Apps installiert und prüft anschließend B7F8E5.

ENGLISH
This archive contains the SSH project/debug assets, the app toolkit, all 25 app
sources and preview pictures. No separate Desktop project folders are needed.
Extract everything into a writable folder and run START.cmd as administrator.
Choose the interface language, check the connection, select app language/apps,
and install. First flashing requires explicit confirmation and a coding backup.

This is a portable SOURCE edition, not a precompiled Windows executable.
It requires Python 3.10+ with Tk, Node 18+, PowerShell 7 and Windows OpenSSH.
The first SSH dependency setup and first Doom build require internet access.
The genuine OAP SDK is extracted from your own vehicle, not included in the ZIP.

To produce a standalone Windows folder, run BUILD-STANDALONE.ps1 on Windows x64.
It creates a private build environment and bundles Python/Tk/cryptography plus
locally installed Node/PowerShell/OpenSSH. The result is
  dist\MGU-App-Studio\MGU-App-Studio.exe
Keep the WHOLE output folder together. The Windows build has not been run here.
The builder excludes personal enrollment keys, logs and extracted SDK outputs.

The interface is available in German and English; original technical output
may remain in its source language. The eight new games currently use English
in-game text regardless of app language; selection cards are bilingual.
Vehicle support: MGU iDrive 7 only. No claim of iDrive 8 compatibility.
Vehicle installation, touch/controller input and the EXE need real Windows/car testing.
