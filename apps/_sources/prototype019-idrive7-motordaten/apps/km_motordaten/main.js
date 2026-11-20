'use strict';
/**
 * Motordaten fuer BMW iDrive 7 (MGU), auch ID8 - dieselbe App wie die M2-Version
 * (Prototype019/motordaten, iDrive 8), nur auf dem MGU App Kit (kit/, MIT).
 *
 * ANZEIGE: dash.js (das Design der iDrive-8-App, 2880x764) zeichnet direkt in den
 * Kit-Recorder, ueber eine Transformation (cv.xf) in den sichtbaren Bereich einge-
 * passt. Vektor statt Pixelbild: der Store-Renderer (mgu-render/1) zeigt keine
 * Pixelbilder, und nur mit Recorder fuehrt das Kit den Bildschirm. Schriften sind
 * die der M2-App (Barlow) als Kit-Atlanten kit/runtime/fonts/md_*.json.
 * EINGABE: jedes Feld aus dash.targets() ist ein Kit-Ziel (cv.target) - Antippen
 * und Druecken mit dem Dreh-Drueck-Steller rufen es auf, Drehen springt weiter.
 *
 * WERTE: UDS 0x22 aus DME (0x12), EGS (0x18) und OBD 01 42 ueber kit/diag.js,
 * gestaffelt wie die M2-App, nur solange die App sichtbar ist oder aufnimmt. Werte,
 * Spitzen, Rekorde und Aufnahme laufen in einem eigenen 100-ms-Takt (wie die M2-App),
 * nicht im Zeichen-Takt.
 *
 * Zwei Schreib-Aktionen wie in der M2-App, mit denselben Schutzregeln:
 *  - MHD Max Cooling (2F 03 01/00 nur an die DME). Ob die DME mit MHD laeuft, fragt
 *    die App EINMAL je Auto ab ("Max Cooling aus", Echo 6F 03 00) - Ergebnis wird
 *    gemerkt (data/mhd.json, ein "nein" nach 7 Tagen neu geprueft). An nur > 500 U/min.
 *  - Fehlerspeicher loeschen (14 FF FF FF): nur Zuendung an + Motor aus, mit
 *    Bestaetigung, Steuergeraet fuer Steuergeraet, nie die Headunit (0x63).
 *
 * iDrive-7-Laufzeit = Node 8: kein ?./??/Spread/import/Klassenfelder.
 */
var fs = require('fs');
var path = require('path');
var mgu = require('./kit/mgu');
var Car = require('./kit/car');
var Diag = require('./kit/diag').Diag;

var dash = require('./dash.js');
var dash7 = require('./dash7.js');
var decode = require('./decode.js');
var Limits = require('./limits.js');
var clock = require('./clock.js');
var Records = require('./records.js').Records;
var logbook = require('./logbook.js');
var faults = require('./faults.js');
var DtcTexts = require('./dtctext.js').DtcTexts;

var DME = 0x12, EGS = 0x18;
var HOLD_MS = 4000, RPM_RUN = 400, PEAK_AFTER_MS = 5000, GLIDE_MS = 90;
var CYCLE_MS = 250;          // Diagnose-Runde
var TICK_MS = 100;           // Werte, Spitzen, Rekorde, Aufnahme (wie die M2-App)
var DRAW_MS = 66;            // hoechstens ~15 Bilder/s (der GPU-Renderer tickt bis 60/s)
var SLOW_EVERY = 12, ENGINE2_EVERY = 6;
var COOLING_MIN_RPM = 500;
var TEXTS_EVERY_MS = 300000;
var MHD_RETRY_MS = 7 * 24 * 3600 * 1000;
var SW = dash.W, SH = dash.H;                       // 2880 x 764 (dash.js)

// Sichtbarer Bereich der 1600x520-Seite im GPU-Vollbild (display.js FULL.src): oben 38 px, seitlich 12 px weg.
var VIS = { x: 12, y: 38, w: 1576, h: 482 };
var K = VIS.w / SW;                                  // dash -> Seite
var OX = VIS.x, OY = VIS.y + (VIS.h - SH * K) / 2;
// Live-Seite (dash7.js): rechts der Tab-Leiste bis zum rechten Rand, in Seiten-Pixeln
var LIVE_BOX = { x0: Math.round(OX + dash.RAIL * K + 26), x1: VIS.x + VIS.w - 16 };
var FONT = { label: 'md_label', scale: 'md_scale', num: 'md_num', bold: 'md_label', light: 'md_label', gear: 'md_num' };

// DID-Gruppen wie die M2-App ([Schluessel, DID]), Benziner G-Serie DME8FF_R (B58/S58).
var FAST = [['rpm', 0x4807], ['torque', 0x5891], ['boostAbs', 0x4205], ['boostTargetAbs', 0x4AB0],
    ['oilPressAbs', 0x4436], ['airMass', 0x4ABC], ['load', 0x5813]];
var ENGINE = [['lambda', 0x5889], ['lambdaTarget', 0x5816], ['rail', 0x5658], ['railTarget', 0x56C1],
    ['fuelLowAbs', 0x58F3], ['ignition', 0x59FA], ['pedal', 0x480B]];
var CYLINDER_DIDS = [0x4A49, 0x4A4A, 0x4A4C, 0x4A4D, 0x4A4E, 0x4A4F];
var KNOCK = [['knock', 0x554C]].concat(CYLINDER_DIDS.map(function (id, i) { return ['ign' + (i + 1), id]; }));
var ENGINE2 = [['throttle', 0x4600], ['fuelFlow', 0x4521], ['fuelTemp', 0x4AD5]];
var COOLING = [['coolTarget', 0x4310], ['fanDuty', 0x587F], ['fanRpm', 0x594F], ['thermostat', 0x4A74],
    ['pumpTarget', 0x5910], ['pumpRpm', 0x58EA], ['pumpCharge', 0x5912], ['fanSet', 0x5594]];
var BATTERY = [['battSoc', 0x5425]];
var SLOW = [['intake', 0x580F], ['ambient', 0x4201], ['exhaust', 0x582F], ['oil', 0x4402], ['coolant', 0x4300],
    ['charge', 0x59D4]];
// eigene Anfrage: kennt eine DME 5822 nicht, bleibt die SLOW-Gruppe davon unberuehrt
var OILSUMP = [['oilSump', 0x5822]];
var MAXK = ['rpm', 'power', 'torque', 'boost', 'oilPress', 'oil', 'coolant', 'gearbox', 'intake', 'charge', 'exhaust', 'knock'];

var isNum = function (v) { return typeof v === 'number' && isFinite(v); };

mgu.run({
    start: function (ctx) {
        var log = ctx.log, ui = ctx.ui;
        // vor allem anderen: Records/Limits/Logbook/Fehlertexte lesen ihren Ordner ueber KM_DATA_DIR
        if (ctx.dataDir) { try { process.env.KM_DATA_DIR = ctx.dataDir; } catch (e) { } }
        var dataDir = process.env.KM_DATA_DIR || '';
        var t0 = Date.now();

        var cfg = Limits.load();
        function saveCfg() { try { Limits.save(cfg); } catch (e) { log.warn('limits save: ' + e); } }

        // ---- MHD-Ergebnis (je Auto einmal fragen) ----
        var MHD_FILE = dataDir ? path.join(dataDir, 'mhd.json') : null;
        var mhd = null;                                  // true / false / null = noch offen
        try {
            var mj = MHD_FILE ? JSON.parse(fs.readFileSync(MHD_FILE, 'utf8')) : null;
            if (mj && mj.mhd === true) mhd = true;
            else if (mj && mj.mhd === false && Date.now() - (mj.at || 0) < MHD_RETRY_MS) mhd = false;
        } catch (e) { }
        function saveMhd(v) { try { if (MHD_FILE) fs.writeFileSync(MHD_FILE, JSON.stringify({ mhd: v, at: Date.now() })); } catch (e) { } }

        var cooling = { state: null }, coolingTimer = null, probeAt = 0, probeTries = 0, probing = false;
        // MHD-Abgasklappe: AUTO (DME entscheidet) / OPEN / CLOSED; paused = "Zu" ueber FLAP_OPEN_RPM an die DME abgegeben
        var flap = { state: 'AUTO', busy: false, paused: false }, flapTimer = null;
        var recordsConfirm = false;

        // Alle Diagnose-Anfragen nacheinander (Polling, Fehler lesen/loeschen, Max Cooling)
        var chain = Promise.resolve();
        function serial(fn) { var p = chain.then(fn, fn); chain = p.then(function () { }, function () { }); return p; }

        var m = {}, mAt = {};
        var cds = { oil: null, coolant: null, rpm: null };
        var peak = {}, trip = {}, startedAt = 0, running = false;
        var bars = { rpm: null, boost: null };
        var lastFrame = 0, lastV = null, lastDraw = 0;
        var page = 'main';
        var extra = {};
        var records = new Records();
        var texts = new DtcTexts(log, dataDir || undefined), textsTimer = null;
        var rec = null, faultsBusy = false, clearing = false;

        function visible() { return ui.isVisible('MAIN'); }
        // auch bei gehaltener Klappe "Zu": die Drehzahlgrenze (FLAP_OPEN_RPM) braucht die Drehzahl
        function active() { return visible() || !!rec || flap.state === 'CLOSED'; }

        // ---- Werte-Quellen ----
        var car = new Car(ctx, ['rpm', 'temps']);
        car.onSample(function () {
            try {
                var d = car.data();
                if (d && !d.demo) { cds.rpm = d.rpm; cds.oil = d.oil; cds.coolant = d.coolant; }   // nie Kit-Demo-Werte
            } catch (e) { log.warn('car: ' + e); }
        });
        var link = new Diag(ctx.signals, log);
        link.quiet = true; link.busyLog = false;
        var diagReady = false, diagErr = null;
        link.init().then(function () { diagReady = true; if (!link.p) diagErr = link.error || 'kein Diagnose-Dienst'; },
            function (e) { diagErr = String(e && e.message || e); });

        // Uhr des Autos (Zeitzone/Sommerzeit) aus der Anzeige im Kombi - fuer Rekord- und Log-Zeiten
        ctx.signals.watch('de.bmw.infotainment.KombiIF', '1', {
            statusShowTimeDate: function (v) {
                try { if (clock.setCluster(v)) log.info('Uhr: UTC' + (clock.offset() >= 0 ? '+' : '') + (clock.offset() / 60) + ' h'); } catch (e) { }
            }
        }, log).then(function (s) { if (s && s.error) log.warn('Kombi-Uhr: ' + s.error); }, function () { });

        function keep(key, v) {
            var now = Date.now();
            if (isNum(v)) { m[key] = v; mAt[key] = now; }
            else if (mAt[key] && now - mAt[key] > HOLD_MS) { m[key] = null; }
        }
        // eine 22-Anfrage fuer eine Gruppe (bis 8 DIDs); angenommen nur die Antwort, die mit der ersten DID beginnt
        function readGroup(ecu, pairs) {
            var data = [], dids = [];
            for (var i = 0; i < pairs.length; i++) {
                data.push(pairs[i][1] >> 8, pairs[i][1] & 0xFF);
                var d = decode.didById(pairs[i][1]); if (d) dids.push(d);
            }
            var first = pairs[0][1];
            var acc = function (u) { return (u[0] === 0x62 && ((u[1] << 8) | u[2]) === first) || (u[0] === 0x7F && u[1] === 0x22); };
            return link.physical(ecu, 0x22, data, 700, acc).then(function (uds) {
                var got = uds ? decode.didNumbers(dids, uds) : null, n = 0;
                for (var k = 0; k < pairs.length; k++) {
                    var v = got ? got[pairs[k][1]] : null;
                    if (isNum(v)) n++;
                    keep(pairs[k][0], v);
                }
                return n;
            }, function () { for (var k = 0; k < pairs.length; k++) keep(pairs[k][0], null); return 0; });
        }
        function readEgs() {
            var acc = function (u) { return (u[0] === 0x62 && u[1] === 0x60 && u[2] === 0x00) || (u[0] === 0x7F && u[1] === 0x22); };
            return link.physical(EGS, 0x22, [0x60, 0x00], 700, acc).then(function (uds) {
                keep('gearbox', uds ? decode.didNumber(decode.didById(0x6000), uds) : null);
            }, function () { keep('gearbox', null); });
        }
        function readVoltage() {
            var acc = function (u) { return (u[0] === 0x41 && u[1] === 0x42) || (u[0] === 0x7F && u[1] === 0x01); };
            return link.physical(DME, 0x01, [0x42], 700, acc).then(function (uds) {
                keep('voltage', uds ? decode.obdNumber(decode.pidById(0x42), uds) : null);
            }, function () { keep('voltage', null); });
        }

        // ---- Diagnose-Runde (gestaffelt wie die M2-App), nur sichtbar oder beim Aufnehmen ----
        var round = 0, sampling = false;
        function sampleOnce() {
            if (sampling || !diagReady || !link.p || faultsBusy || clearing || !active()) return;
            sampling = true; round++;
            var r = round, slow = r % SLOW_EVERY === 0 || !isNum(m.ambient) || !isNum(m.gearbox);
            serial(function () {
                return readGroup(DME, FAST).then(function (answered) {
                    var seq = Promise.resolve();
                    var add = function (fn) { seq = seq.then(fn); };
                    if (answered > 0) {
                        if (r % 2 === 0) add(function () { return readGroup(DME, KNOCK); });
                        if (rec && r % 2 === 1) add(function () { return readGroup(DME, ENGINE); });
                        if (rec && r % ENGINE2_EVERY === 3) add(function () { return readGroup(DME, ENGINE2); });
                        if (slow || (rec && r % 4 === 2)) add(function () { return readGroup(DME, COOLING); });
                        if (slow) add(function () { return readGroup(DME, BATTERY); });
                    }
                    if (slow) {
                        add(function () { return readGroup(DME, SLOW); });
                        add(function () { return readGroup(DME, OILSUMP); });
                        add(readEgs); add(readVoltage);
                    }
                    return seq;
                });
            }).then(function () { sampling = false; probeMhd(); }, function () { sampling = false; });
        }
        setInterval(function () { try { sampleOnce(); } catch (e) { sampling = false; log.warn('runde: ' + e); } }, CYCLE_MS);

        // ---- MHD erkennen: einmal je Auto die DME harmlos fragen (Max Cooling AUS = 2F 03 00) ----
        var accCool = function (u) { return (u[0] === 0x6F && u[1] === 0x03) || (u[0] === 0x7F && u[1] === 0x2F); };
        function probeMhd() {
            if (mhd !== null || probing || probeTries >= 5 || !visible() || !isNum(m.rpm) || Date.now() - probeAt < 20000) return;
            probing = true; probeAt = Date.now(); probeTries++;
            serial(function () { return link.physical(DME, 0x2F, [0x03, 0x00], 2500, accCool); }).then(function (u) {
                probing = false;
                if (u && u[0] === 0x6F && u[1] === 0x03 && u[2] === 0x00) {
                    mhd = true; saveMhd(true); cooling.state = 'OFF';
                    // Max Cooling beim ersten Erkennen einschalten; die Klappe bleibt aus, bis der Fahrer sie
                    // unter Einstellungen > MHD-Tuning einschaltet (mhdFlapOn, Standard 0)
                    if (!cfg.mhdCoolingOn) { cfg.mhdCoolingOn = 1; saveCfg(); }
                    log.info('MHD erkannt: Max Cooling verfuegbar');
                } else if (u && u[0] === 0x7F && (u[2] === 0x11 || u[2] === 0x12 || u[2] === 0x31)) {
                    mhd = false; saveMhd(false); log.info('kein MHD (DME: ' + u[2].toString(16) + ')');
                }
            }, function () { probing = false; });
        }

        // ---- Ableitungen (wie die M2-App) ----
        var PS_PER_KW = 1.35962;
        function airPowerPs(air, load) {
            if (!isNum(air) || air <= 0 || !isNum(load)) return null;
            var share = Math.max(0, Math.min(1, (load - 10) / 60));
            return air * (11.94 / 14.7) * 0.315 * share * PS_PER_KW;
        }
        function rpmNow() {
            var now = Date.now();
            if (isNum(m.rpm) && now - (mAt.rpm || 0) < 400) { return m.rpm < 200 ? 0 : m.rpm; }
            if (isNum(cds.rpm)) { return cds.rpm; }
            return isNum(m.rpm) ? m.rpm : null;
        }
        function peakOf(key, val) {
            if (isNum(val) && Date.now() - startedAt > PEAK_AFTER_MS) { peak[key] = Math.max(isNum(peak[key]) ? peak[key] : val, val); }
            return isNum(peak[key]) ? peak[key] : null;
        }
        function pick(a, b) { return isNum(a) ? a : (isNum(b) ? b : null); }
        function num(v) { return isNum(v) ? v : null; }
        /* Oeltemperatur: am G20 (iD7) lieferte 4402 "Oel nach Filter" 0 °C bei 106 °C Kuehlmittel (Feldfoto
         * 17.11.). Darum die erste glaubhafte von 4402, 5822 (Oelsumpf) und dem Fahrzeugsignal (CDS):
         * im Bereich -40..200 °C, und kein Wert um 0 °C, waehrend das Kuehlmittel schon ueber 40 °C hat. */
        function oilNow(coolant) {
            var ok = function (t) { return isNum(t) && t > -40 && t < 200 && !(t < 2 && isNum(coolant) && coolant > 40); };
            var c = [m.oil, m.oilSump, cds.oil];
            for (var i = 0; i < c.length; i++) if (ok(c[i])) return c[i];
            return null;
        }

        function buildV() {
            var ambient = isNum(m.ambient) ? m.ambient / 1000 : null;            // hPa -> bar
            var above = function (abs) { return (isNum(abs) && isNum(ambient)) ? abs - ambient : null; };
            var coolant = pick(m.coolant, cds.coolant);
            var v = {
                rpm: rpmNow(), oil: oilNow(coolant), coolant: coolant,
                intake: num(m.intake), charge: num(m.charge), boost: above(m.boostAbs), boostTarget: above(m.boostTargetAbs),
                oilPress: above(m.oilPressAbs), gearbox: num(m.gearbox), exhaust: num(m.exhaust), voltage: num(m.voltage),
                // nur beim Aufnehmen gelesen (ENGINE/ENGINE2): fuer die Logs
                lambda: num(m.lambda), lambdaTarget: num(m.lambdaTarget), rail: num(m.rail), railTarget: num(m.railTarget),
                fuelLow: above(m.fuelLowAbs), knock: num(m.knock), ignition: num(m.ignition), pedal: num(m.pedal), load: num(m.load),
                airMass: num(m.airMass), throttle: num(m.throttle), fuelFlow: num(m.fuelFlow), fuelTemp: num(m.fuelTemp),
                battSoc: (isNum(m.battSoc) && m.battSoc >= 0 && m.battSoc <= 100) ? m.battSoc : null,
                coolTarget: num(m.coolTarget), fanDuty: num(m.fanDuty), fanRpm: num(m.fanRpm), thermostat: num(m.thermostat),
                pumpTarget: num(m.pumpTarget), pumpRpm: num(m.pumpRpm), pumpCharge: num(m.pumpCharge),
                pumpPct: isNum(m.pumpTarget) ? m.pumpTarget / 255 * 100 : null,
                pumpChargePct: isNum(m.pumpCharge) ? m.pumpCharge / 255 * 100 : null,
                fan: isNum(m.fanDuty) ? m.fanDuty : num(m.fanSet),
                battCurrent: null, battTemp: null, battVoltage: null     // Sensor-DIDs verweigert die DME (wie M2)
            };
            // jeder Zylinder unter dem fruehesten: was die Klopfregelung dort zuruecknimmt (nur bei laufendem Motor)
            var ang = CYLINDER_DIDS.map(function (id, i) { return m['ign' + (i + 1)]; });
            v.knockCyl = null;
            if (ang.every(isNum) && isNum(v.rpm) && v.rpm > 600) {
                var top = Math.max.apply(null, ang);
                ang.forEach(function (a, i) { v['knockCyl' + (i + 1)] = top - a; });
                var worst = ang.indexOf(Math.min.apply(null, ang));
                v.knockCyl = top - ang[worst] > 0.4 ? worst + 1 : null;
            }
            // Leistung/Drehmoment: Luftmassen-Schaetzung vs. DME-Drehmoment (Schub: 0)
            var rpm = isNum(v.rpm) ? Math.max(0, v.rpm) : null;
            var dmeTq = isNum(m.torque) ? Math.max(0, m.torque) : null;
            var dmePw = (dmeTq !== null && rpm !== null) ? dmeTq * rpm / 9549 * PS_PER_KW : null;
            var airPw = airPowerPs(m.airMass, m.load);
            if (airPw !== null && (dmePw === null || airPw > dmePw) && rpm !== null && rpm > 500) {
                v.power = airPw; v.torque = airPw / PS_PER_KW * 9549 / rpm;
            } else { v.power = dmePw; v.torque = dmeTq; }
            // Motor-Start-Flanke -> Spitzen dieser Fahrt neu
            if (isNum(rpm)) {
                var run = rpm >= RPM_RUN;
                if (run && running === false) { startedAt = Date.now(); peak = {}; trip = {}; }
                running = run;
            }
            v.rpmPeak = peakOf('rpm', v.rpm); v.torquePeak = peakOf('torque', v.torque);
            v.powerPeak = peakOf('power', v.power); v.boostPeak = peakOf('boost', v.boost);
            v.oilPressPeak = peakOf('oilPress', v.oilPress);
            // Maximalwerte dieser Fahrt + Rekorde ueber alle Fahrten (Zeit als Millisekunden, wie M2)
            if (Date.now() - startedAt > PEAK_AFTER_MS) {
                for (var mi = 0; mi < MAXK.length; mi++) {
                    var mk = MAXK[mi], mv = v[mk];
                    if (isNum(mv) && (!isNum(trip[mk]) || mv > trip[mk])) { trip[mk] = mv; records.offer(mk, mv, clock.wall().getTime()); }
                }
            }
            // Statuszeile
            v.status = ''; v.statusErr = false;
            if (diagErr || (!diagReady && Date.now() - t0 > 15000)) { v.status = 'Diagnose nicht erreichbar' + (diagErr ? ': ' + diagErr : ''); v.statusErr = true; }
            else if (diagReady && link.p && round > 2 && FAST.every(function (p) { return !isNum(m[p[0]]); })) {
                v.status = 'Keine Antwort der DME – Zündung an?';
            }
            return v;
        }

        function glide(v) {
            var now = Date.now(), dt = Math.min(100, now - (lastFrame || now)); lastFrame = now;
            var k = 1 - Math.exp(-dt / GLIDE_MS);
            ['rpm', 'boost'].forEach(function (key) {
                var to = v[key], from = bars[key], snap = key === 'rpm' ? 5 : 0.005;
                if (!isNum(to)) { bars[key] = null; }
                else if (!isNum(from) || Math.abs(to - from) < snap) { bars[key] = to; }
                else { bars[key] = from + (to - from) * k; }
            });
            v.rpmBar = bars.rpm; v.boostBar = bars.boost;
        }

        // ---- 100-ms-Takt: Werte, Spitzen, Rekorde, Aufnahme (unabhaengig vom Zeichnen) ----
        setInterval(function () {
            try {
                if (!active()) return;
                lastV = buildV();
                flapGuard(lastV.rpm);
                if (rec) {
                    if (rec.sample(lastV) === false) { stopRecording(); }
                    else { extra.recording = { ms: Date.now() - rec.started }; }
                }
            } catch (e) { log.warn('takt: ' + e); }
        }, TICK_MS);

        // ---- Fehlerspeicher lesen (19 02 an alle Steuergeraete) + Texte ----
        function annotateFaults() {
            var f = extra.faults;
            if (!f || !f.scan) return;
            f.scan.forEach(function (u) { u.entries.forEach(function (e) { e.text = texts.text(e.ecu, e.code); }); });
            extra.faults = Object.assign({}, f, { texts: texts.count() });
        }
        function syncTexts(first) {
            clearTimeout(textsTimer); textsTimer = null;
            Promise.resolve().then(function () { return texts.sync(first); }).then(function (n) { if (n) annotateFaults(); },
                function (e) { log.warn('Fehlertexte: ' + (e && e.message)); }).then(function () {
                if (!texts.complete()) textsTimer = setTimeout(function () { syncTexts(); }, TEXTS_EVERY_MS);
            });
        }
        function readFaults(note) {
            if (faultsBusy || clearing || !diagReady || !link.p) return;
            faultsBusy = true;
            var addrs = faults.addresses();
            var scan = addrs.map(function (a) { return { addr: a, name: faults.unitName(a), state: 'wait', entries: [] }; });
            extra.faults = { reading: true, scan: scan, progress: 0 };
            var replied = {};
            serial(function () {
                return link.functional(0x19, [0x02, 0x0D], { maxMs: 7000, onReply: function () { if (extra.faults) extra.faults.progress = (extra.faults.progress || 0) + 1; } });
            }).then(function (map) {
                var reps = new Map();
                if (map && map.forEach) { map.forEach(function (uds, ecu) { reps.set(ecu, uds); replied[ecu] = 1; }); }
                var entries = (faults.parse(reps) || {}).entries || [];
                scan.forEach(function (u) {
                    u.entries = entries.filter(function (e) { return e.ecu === u.addr; });
                    u.state = replied[u.addr] ? (u.entries.length ? 'faults' : 'ok') : 'none';
                });
                var n = note ? note + (entries.length ? ' Noch ' + entries.length + ' Einträge.' : ' Keine Einträge mehr.') : null;
                extra.faults = { scan: scan, units: addrs.length, entries: entries, at: clock.wall(), note: n };
                faultsBusy = false;
                annotateFaults();
                syncTexts(Object.keys(replied).map(Number).filter(function (a) { return entries.some(function (e) { return e.ecu === a; }); }));
            }, function (e) {
                extra.faults = { scan: scan, units: addrs.length, entries: [], at: clock.wall(), error: String(e && e.message || e) };
                faultsBusy = false;
            });
        }

        // ---- MHD Max Cooling (wie die M2-App): an nur bei laufendem Motor, aus jederzeit ----
        function coolingNote(note) {
            clearTimeout(coolingTimer);
            cooling = Object.assign({}, cooling, { note: note, confirm: false });
            coolingTimer = setTimeout(function () { cooling = Object.assign({}, cooling, { note: null }); }, 3000);
        }
        function sendCooling(on) {
            if (mhd !== true || !cfg.mhdCoolingOn || cooling.busy) return;
            var rpm = lastV && lastV.rpm;
            if (on && !(isNum(rpm) && rpm > COOLING_MIN_RPM)) { coolingNote('Erst Motor starten'); return; }
            clearTimeout(coolingTimer);
            cooling = Object.assign({}, cooling, { busy: true, confirm: false, note: null });
            var want = on ? 0x01 : 0x00;
            serial(function () { return link.physical(DME, 0x2F, [0x03, want], 2500, accCool); }).then(function (u) {
                var echoed = !!(u && u[0] === 0x6F && u[1] === 0x03 && u[2] === want);
                cooling = { state: echoed ? (on ? 'ON' : 'OFF') : cooling.state, busy: false };
                log.info('MHD Max Cooling ' + (on ? 'an' : 'aus') + ': ' + (echoed ? 'bestaetigt' : 'keine Bestaetigung'));
                if (!echoed) coolingNote('Kein MHD-Echo');
            }, function (e) {
                cooling = Object.assign({}, cooling, { busy: false });
                coolingNote('Nicht gesendet');
                log.warn('max cooling: ' + (e && e.message));
            });
        }
        function coolingPressed() {
            if (mhd !== true || !cfg.mhdCoolingOn || cooling.busy) return;
            sendCooling(cooling.state !== 'ON');
        }

        // ---- MHD-Abgasklappe: 2F 02 00 Auto / 01 Auf / 02 Zu, angenommen nur mit dem Echo 6F 02 nn ----
        // (wie MHDs eigene App, mitgeschnitten in cauliflowermossgrape/idrive7-apps live_adjustments, MIT).
        // "Zu" gibt ueber FLAP_OPEN_RPM an die DME ab (die oeffnet bei Last selbst) und schliesst unter
        // FLAP_CLOSE_RPM wieder - wie dort; "Auf" und "Auto" gelten immer.
        var FLAP_CODE = { AUTO: 0x00, OPEN: 0x01, CLOSED: 0x02 };
        var FLAP_NEXT = { AUTO: 'OPEN', OPEN: 'CLOSED', CLOSED: 'AUTO' };
        var FLAP_OPEN_RPM = 4000, FLAP_CLOSE_RPM = 3500;
        var accFlap = function (u) { return (u[0] === 0x6F && u[1] === 0x02) || (u[0] === 0x7F && u[1] === 0x2F); };
        function flapNote(note) {
            clearTimeout(flapTimer);
            flap = Object.assign({}, flap, { note: note });
            flapTimer = setTimeout(function () { flap = Object.assign({}, flap, { note: null }); }, 3000);
        }
        /* code an die DME; ok(true) nur mit dem passenden Echo */
        function sendFlap(code) {
            return serial(function () { return link.physical(DME, 0x2F, [0x02, code], 2500, accFlap); })
                .then(function (u) { return !!(u && u[0] === 0x6F && u[1] === 0x02 && u[2] === code); }, function () { return false; });
        }
        var FLAP_NO_RPM_MS = 2000, FLAP_RETRY_MS = 1000;       // ohne Drehzahl so lange: "Zu" an die DME; ohne Echo: neuer Versuch danach
        var flapRetryAt = 0, flapNoRpm = 0, flapBackTries = 0;
        /*
         * want: AUTO / OPEN / CLOSED. guard: aus flapGuard ({ pause }: "Zu" an die DME abgeben oder wieder schliessen,
         * der Zustand bleibt CLOSED). force: auch bei ausgeschaltetem Schalter (Klappe an die DME zurueckgeben).
         */
        function setFlap(want, guard, force) {
            if (mhd !== true || (!force && !cfg.mhdFlapOn) || flap.busy) return;
            var rpm = lastV && lastV.rpm;
            var paused = want === 'CLOSED' && (guard ? !!guard.pause : isNum(rpm) && rpm > FLAP_OPEN_RPM);   // ueber der Grenze: erst Auto
            clearTimeout(flapTimer);
            flap = Object.assign({}, flap, { busy: true, note: null });
            sendFlap(paused ? FLAP_CODE.AUTO : FLAP_CODE[want]).then(function (ok) {
                log.info('Klappe ' + want + (paused ? ' (an die DME abgegeben)' : '') + ': ' + (ok ? 'bestaetigt' : 'keine Bestaetigung'));
                flap = ok ? { state: want, busy: false, paused: paused } : Object.assign({}, flap, { busy: false });
                if (!ok) { flapRetryAt = Date.now() + FLAP_RETRY_MS; flapNote('Kein MHD-Echo'); }
            });
        }
        function flapPressed() {
            if (mhd !== true || !cfg.mhdFlapOn || flap.busy) return;
            setFlap(FLAP_NEXT[flap.state] || 'AUTO', null, false);
        }
        /*
         * im 100-ms-Takt: eine gehaltene Klappe bei ausgeschaltetem Schalter zurueck an die DME (auch wenn der Schalter
         * aus ging, waehrend ein Befehl unterwegs war; nach 3 Versuchen ohne Echo aufgegeben); "Zu" ueber
         * FLAP_OPEN_RPM und nach FLAP_NO_RPM_MS ohne Drehzahl an die DME, unter FLAP_CLOSE_RPM wieder schliessen.
         */
        function flapGuard(rpm) {
            if (flap.state === 'AUTO') { flapBackTries = 0; flapNoRpm = 0; }
            if (mhd !== true || flap.state === 'AUTO' || flap.busy || Date.now() < flapRetryAt) return;
            if (!cfg.mhdFlapOn) {
                if (++flapBackTries > 3) {
                    log.warn('Klappe: Rueckgabe ohne Bestaetigung aufgegeben');
                    flap = { state: 'AUTO', busy: false, paused: false }; flapBackTries = 0;
                    return;
                }
                setFlap('AUTO', null, true);
                return;
            }
            flapBackTries = 0;
            if (flap.state !== 'CLOSED') { flapNoRpm = 0; return; }
            if (!isNum(rpm)) {
                flapNoRpm = flapNoRpm || Date.now();
                if (!flap.paused && Date.now() - flapNoRpm > FLAP_NO_RPM_MS) {
                    log.warn('Klappe: keine Drehzahl, Zu an die DME abgegeben');
                    setFlap('CLOSED', { pause: true }, true);
                }
                return;
            }
            flapNoRpm = 0;
            var pause = rpm > FLAP_OPEN_RPM ? true : rpm < FLAP_CLOSE_RPM ? false : flap.paused;
            if (pause !== flap.paused) setFlap('CLOSED', { pause: pause }, true);
        }
        // Beenden (MainApp: "shutdown", das Kit ruft 200 ms spaeter process.exit): eine gehaltene Klappe noch an die
        // DME zurueck, hoechstens 600 ms warten
        var realExit = process.exit, exiting = false;
        process.exit = function (code) {
            if (!exiting && mhd === true && flap.state !== 'AUTO') {
                exiting = true;
                var done = function () { realExit.call(process, code); };
                setTimeout(done, 600);
                sendFlap(FLAP_CODE.AUTO).then(done, done);
                return;
            }
            return realExit.apply(process, arguments);
        };

        // ---- Fehlerspeicher loeschen (wie die M2-App) ----
        var NO_CLEAR = [0x63];
        var acc14 = function (u) { return u[0] === 0x54 || (u[0] === 0x7F && u[1] === 0x14); };
        function clearBlocked() {
            var fresh = Date.now() - (mAt.rpm || 0) < 3000;
            var rpm = fresh ? m.rpm : cds.rpm;
            if (!isNum(rpm)) return 'Löschen nur bei Zündung an: keine Drehzahl vom Motor.';
            if (rpm >= 200) return 'Löschen nur bei Motor aus. Motor abstellen, Zündung an lassen.';
            return null;
        }
        function clearFaults() {
            var f = extra.faults || {};
            if (clearing || faultsBusy || !f.confirmClear) return;              // nur nach der Bestaetigung, nie doppelt
            var why = clearBlocked();
            if (why) { extra.faults = Object.assign({}, f, { note: why, warn: true, confirmClear: false }); return; }
            var units = [];
            (f.entries || []).forEach(function (e) { if (units.indexOf(e.ecu) < 0) units.push(e.ecu); });
            var skipped = units.filter(function (u) { return NO_CLEAR.indexOf(u) >= 0; });
            var todo = units.filter(function (u) { return NO_CLEAR.indexOf(u) < 0; });
            clearing = true;
            extra.faults = Object.assign({}, f, { clearing: true, confirmClear: false, note: null, warn: false });
            var cleared = 0, failed = 0;
            todo.reduce(function (p, u) {
                return p.then(function () {
                    return serial(function () { return link.physical(u, 0x14, [0xFF, 0xFF, 0xFF], 8000, acc14); })
                        .then(function (r) { if (r && r[0] === 0x54) cleared++; else failed++; }, function () { failed++; });
                });
            }, Promise.resolve()).then(function () {
                var parts = ['Gelöscht in ' + cleared + ' ' + (cleared === 1 ? 'Steuergerät' : 'Steuergeräten')];
                if (failed) parts.push(failed + ' ohne Bestätigung');
                if (skipped.length) parts.push('Headunit ausgelassen');
                log.info('Fehler geloescht: ' + cleared + ', ohne Bestaetigung: ' + failed);
                clearing = false;
                extra.faults = { reading: false };
                readFaults(parts.join(', ') + '.');
            });
        }

        // ---- Logs / Aufnahme ----
        function showLogs() { try { extra.logs = logbook.list().map(function (l) { return logbook.summary(l.name); }).filter(Boolean); } catch (e) { extra.logs = []; } }
        function openLog(i) {
            var l = extra.logs && extra.logs[i];
            if (!l) return;
            try { extra.log = logbook.load(l.name); extra.logName = l.name; extra.channel = 'rpm'; extra.confirmDelete = false; page = 'log'; } catch (e) { log.warn('log load: ' + e); }
        }
        function stopRecording() {
            if (!rec) return;
            try { rec.stop(); } catch (e) { log.warn('aufnahme stop: ' + e); }
            rec = null; extra.recording = null; showLogs();
        }
        function toggleRecord() {
            if (rec) { stopRecording(); return; }
            try { rec = new logbook.Recording(); extra.recording = { ms: 0 }; }       // ohne Argument wie die M2-App (ms intern)
            catch (e) { rec = null; log.warn('aufnahme start: ' + e); }
        }

        function onEnter(p) {
            if (p === 'faults') { if (!extra.faults || (!extra.faults.reading && !extra.faults.scan)) readFaults(); }
            else if (p === 'logs') { showLogs(); }
        }
        function resetConfirms() {
            recordsConfirm = false; extra.confirmDelete = false; extra.confirmDeleteAll = false; extra.usb = null;
            if (extra.faults && extra.faults.confirmClear) extra.faults = Object.assign({}, extra.faults, { confirmClear: false });
            if (cooling.confirm) cooling = Object.assign({}, cooling, { confirm: false });
        }

        // ---- Eingabe: Aktion zu einem dash-Ziel ----
        function act(id) {
            if (id.indexOf('tab:') === 0) { resetConfirms(); page = id.slice(4); onEnter(page); return; }
            if (id.indexOf('menu:') === 0) { page = id.slice(5); return; }
            if (id === 'settings:back') { page = 'settings'; return; }
            if (id === 'reset') { peak = {}; trip = {}; return; }
            if (id === 'record') { toggleRecord(); return; }
            if (id === 'cooling' || id === 'cooling!') { coolingPressed(); return; }
            if (id === 'flap') { flapPressed(); return; }
            if (id === 'faults:read') { readFaults(); return; }
            if (id === 'faults:clear') {
                if (clearing || faultsBusy) return;
                var why = clearBlocked(), f = extra.faults || {};
                extra.faults = why ? Object.assign({}, f, { note: why, warn: true, confirmClear: false })
                    : Object.assign({}, f, { confirmClear: true, note: null, warn: false });
                return;
            }
            if (id === 'faults:clear!') { clearFaults(); return; }
            if (id.indexOf('unit:') === 0) { extra.unit = parseInt(id.slice(5), 10); page = 'faultunit'; return; }
            if (id === 'faults:back') { page = 'faults'; return; }
            if (id === 'records:clear') { recordsConfirm = true; return; }
            if (id === 'records:clear!') { if (recordsConfirm) records.clear(); recordsConfirm = false; return; }
            if (id.indexOf('open:') === 0) { openLog(parseInt(id.slice(5), 10)); return; }
            if (id.indexOf('chan:') === 0) { extra.channel = id.slice(5); return; }
            if (id === 'delete') { extra.confirmDelete = true; return; }
            if (id === 'delete!') { if (extra.confirmDelete && extra.logName) { try { logbook.remove(extra.logName); } catch (e) { } } extra.confirmDelete = false; extra.log = null; page = 'logs'; showLogs(); return; }
            if (id === 'deleteAll') { extra.confirmDeleteAll = true; return; }
            if (id === 'deleteAll!') { if (extra.confirmDeleteAll) { try { logbook.removeAll(); } catch (e) { } } extra.confirmDeleteAll = false; showLogs(); return; }
            if (id === 'back') { page = (page === 'faultunit') ? 'faults' : 'logs'; if (page === 'logs') showLogs(); return; }
            if (id === 'usb') { extra.usb = { text: 'USB-Export auf iDrive 7 nicht verfügbar.' }; return; }
            if (id.indexOf('dec:') === 0) { cfg = Limits.stepped(cfg, id.slice(4), -1); saveCfg(); return; }
            if (id.indexOf('inc:') === 0) { cfg = Limits.stepped(cfg, id.slice(4), 1); saveCfg(); return; }
            if (id.indexOf('toggle:') === 0) { cfg = Limits.toggled(cfg, id.slice(7)); saveCfg(); return; }
            if (id === 'defaults') { cfg = Limits.reset(cfg, page === 'ready' ? 'ready' : 'limits'); saveCfg(); return; }
        }

        // ---- Zeichnen: dash.js als Vektor in den Kit-Recorder ----
        // Umleiter fuer dash.js: dieselben 7 Zeichenbefehle, von dash-Koordinaten (2880x764) auf die Seite
        // skaliert (selbst, nicht per cv.xf: xf heisst im Kit "nur GPU" - ohne Renderer bliebe die Seite leer),
        // Texte woertlich (keine Kit-Uebersetzung) in unseren Schriften. Breiten gehen in dash-Einheiten zurueck.
        // k/ox/oy: ohne Angabe dash-Koordinaten (2880x764 -> Seite); painter(cv, 1, 0, 0) zeichnet in Seiten-Pixeln (dash7.js)
        function painter(cv, k, ox, oy) {
            var KK = k || K, OXX = ox != null ? ox : OX, OYY = oy != null ? oy : OY;
            var X = function (x) { return OXX + x * KK; }, Y = function (y) { return OYY + y * KK; }, S = function (v) { return v * KK; };
            var opts = function (o) {
                var r = {}; if (o) { for (var k in o) r[k] = o[k]; }
                r.font = FONT[r.font || 'label'] || 'md_label'; r.literal = true;
                if (r.spacing) r.spacing = S(r.spacing);
                return r;
            };
            var P = {
                w: SW, h: SH,
                clear: function (c) { cv.fillRect(OX, OY, S(SW), S(SH), c); return P; },
                fillRect: function (x, y, w, h, c) { cv.fillRect(X(x), Y(y), S(w), S(h), c); return P; },
                roundRect: function (x, y, w, h, r, c) { cv.roundRect(X(x), Y(y), S(w), S(h), S(r), c); return P; },
                strokeRoundRect: function (x, y, w, h, r, lw, c) { cv.strokeRoundRect(X(x), Y(y), S(w), S(h), S(r), S(lw), c); return P; },
                polyline: function (pts, lw, c) { cv.polyline(pts.map(function (p) { return [X(p[0]), Y(p[1])]; }), S(lw), c); return P; },
                text: function (s, x, y, size, c, o) { return cv.text(s, X(x), Y(y), S(size), c, opts(o)) / KK; },
                textWidth: function (s, size, o) { return cv.textWidth(s, S(size), opts(o)) / KK; }
            };
            return P;
        }
        var bg = dash.C.asphalt;
        ctx.loop('MAIN', 15, function () {
            var now = Date.now();
            if (now - lastDraw < DRAW_MS && lastV) return;                     // GPU-Renderer tickt bis 60/s: begrenzen
            lastDraw = now;
            if (!lastV) lastV = buildV();
            var v = Object.assign({}, lastV); glide(v);
            // Max-Cooling-Knopf nur, wenn MHD erkannt ist und die Option an ist
            extra.cooling = (mhd === true && cfg.mhdCoolingOn) ? Object.assign({}, cooling) : null;
            extra.flap = (mhd === true && cfg.mhdFlapOn) ? Object.assign({}, flap) : null;
            if (page === 'records') extra.maxima = { trip: trip, rec: records.best, confirm: recordsConfirm };
            var cv = ctx.canvas(1600, 520).clear(bg);
            var noUi = { focus: null, pressed: null };
            // Live: die Tab-Leiste wie auf jeder Seite (dash.js, skaliert), der Inhalt gross in Seiten-Pixeln (dash7.js)
            try {
                if (page === 'main') {
                    cv.fillRect(VIS.x, VIS.y, VIS.w, VIS.h, bg);
                    dash.rail(painter(cv), 'main', noUi);
                    dash7.live(painter(cv, 1, 0, 0), v, cfg, noUi, extra, LIVE_BOX);
                } else {
                    dash.draw(painter(cv), page, v, cfg, noUi, extra);
                }
            } catch (e) { log.warn('draw ' + page + ': ' + e); }
            // jedes antippbare Feld als Kit-Ziel (Seiten-Pixel); Schluessel ohne "!", damit der Controller-Fokus
            // beim Bestaetigen (cooling -> cooling!) auf dem Knopf bleibt
            var tg = [];
            try {
                tg = (page === 'main' ? dash.targets('main', extra).filter(function (t) { return t.id.indexOf('tab:') === 0; })
                    : dash.targets(page, extra)) || [];
            } catch (e) { log.warn('targets ' + page + ': ' + e); }
            tg.forEach(function (t) {
                var id = t.id;
                cv.target(OX + t.x * K, OY + t.y * K, t.w * K, t.h * K, function () { act(id); }, id.replace(/!$/, ''));
            });
            if (page === 'main') {
                try {
                    dash7.targets(extra, LIVE_BOX).forEach(function (t) {
                        var id = t.id;
                        cv.target(t.x, t.y, t.w, t.h, function () { act(id); }, id.replace(/!$/, ''));
                    });
                } catch (e) { log.warn('targets live: ' + e); }
            }
            return ui.image('MAIN_GFX', cv);
        });

        // Beim Verlassen offene Bestaetigungen zurueck; beim Wiederkommen gleich eine Runde
        ui.onVisible(function (name, vis) {
            if (name !== 'MAIN') return;
            if (!vis) resetConfirms(); else { try { sampleOnce(); } catch (e) { } }
        });
        // Beim Beenden noch speichern (die Laufzeit beendet den Prozess selbst)
        process.on('exit', function () {
            try { records.flush(); } catch (e) { }
            try { if (rec) rec.stop(); } catch (e) { }
        });

        log.info('Motordaten (ID7) gestartet');
    }
});
