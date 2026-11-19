'use strict';
// AQ ID8 transport for the original Tank median/settling algorithm. The only
// vehicle member is the existing read-only KombiIF statusRangeTankStatus field.
// No DME/diagnostic transport is constructed. Manual fuel accounting is in main.
const { Tank, KOMBI } = require('./tank');
const FIELD = 'statusRangeTankStatus', POLL_MS = 2000, MAX_AGE_MS = 6000;
class TankID8 extends Tank {
    constructor(ctx) {
        if (!ctx.ui || !ctx.ui.id8) throw new Error('TankID8 requires the loaded ID8 UI marker');
        super({ log: ctx.log });
        this.ctx = ctx; this.sub = null; this.starting = false; this.closed = false; this.generation = 0;
        this.reader = null; this.odoAt = null; this.providerGeneration = null;
        this.fieldReader = require('./kit/readonly_signals').forHmi('ID8');
        this.sync = () => {
            const manual = ctx.settings && ctx.settings.get('id8TankInput') === 'manual';
            if (!this.closed && !manual && ctx.ui.isVisible('MAIN')) this.start(); else this.pause();
        };
        ctx.ui.onVisible(() => setImmediate(this.sync));
        if (ctx.settings && ctx.settings.onChange) ctx.settings.onChange(() => setImmediate(this.sync));
        if (ctx.app && ctx.app.on) ctx.app.on('shutdown', () => this.stop());
        this.sync();
    }
    clearReadings() {
        this.kombi = null; this.dme = null; this.odo = null; this.odoAt = null;
        this.recent = { dme1: [], kombi: [] }; this.seen = { dme1: 0, kombi: 0 };
        this.level = null; this.ignored = null; this.live = 0; this._judged = null; this._lastJudge = null;
    }
    start() {
        if (this.closed || this.sub || this.starting) return;
        this.starting = true; const token = this.generation;
        this.fieldReader.watch(KOMBI, '1', {
            [FIELD]: (s) => {
                if (this.closed || token !== this.generation) return;
                if (this.sub && this.providerGeneration !== this.sub.availabilityGeneration) {
                    this.clearReadings(); this.providerGeneration = this.sub.availabilityGeneration;
                }
                const v = s && s.fluidLevelFuelTank, km = s && s.mileageKilometre;
                if (!(typeof v === 'number' && isFinite(v) && v >= 0 && v <= 150)) {
                    this.clearReadings(); return;
                }
                this.kombi = { v, at: Date.now() };
                this.odo = typeof km === 'number' && isFinite(km) && km > 0 && km < 2000000 ? km : null;
                this.odoAt = this.odo === null ? null : Date.now();
            },
        }, this.log, { pollMs: POLL_MS }).then((result) => {
            if (this.closed || token !== this.generation) { if (result && result.shutdown) result.shutdown(); return; }
            this.starting = false; this.sub = result;
            this.providerGeneration = result && result.availabilityGeneration;
            if (result && result.error) this.log.warn('ID8 Kombi tank: ' + result.error);
        }, (e) => { if (token === this.generation) { this.starting = false; this.clearReadings(); this.log.warn('ID8 Kombi tank unavailable: ' + e); } });
    }
    fresh(now) {
        return !!(this.kombi && this.sub && this.sub.fresh(FIELD) && now - this.kombi.at >= 0 && now - this.kombi.at <= MAX_AGE_MS);
    }
    tick(now) { if (!this.fresh(now)) this.clearReadings(); }
    now(now) {
        if (!this.fresh(now)) { this.clearReadings(); return null; }
        // Original median, settling and plausible-consumption rules remain.
        // A loss of source resets their history so old values cannot reappear.
        return super.now(now);
    }
    _reader() { throw new Error('DME tank diagnostics are unavailable on ID8'); }
    async ask() { return null; }
    pause() {
        this.generation++; this.starting = false; this.clearReadings();
        const sub = this.sub; this.sub = null;
        if (sub && sub.shutdown) sub.shutdown();
    }
    stop() { this.closed = true; this.pause(); }
}
module.exports = { TankID8, FIELD, POLL_MS, MAX_AGE_MS };
