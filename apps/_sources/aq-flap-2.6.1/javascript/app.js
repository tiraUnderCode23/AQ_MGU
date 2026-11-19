'use strict';

// AQ///Bimmer — exhaust flap.  OEM-style layout (same design system as Car Vitals).
// Single tap, no confirm, no dialogs / no hex / no dev text in the log.
// LTR header: logo + title on the left; M tricolour stripe along the bottom bar.

const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { Diag } = require('./kit/diag');
const { FlapController } = require('./flap_controller');

const W = 1600, H = 520;
const URL = 'uds.aqbimmer.com';

function drawMLogo(cv, t, x, y, s) {
    // three diagonal M tricolour stripes + the M letter (small OEM mark)
    const stripes = t.stripes || ['#81c4ff', '#16588e', '#e7222e'];
    stripes.forEach((col, i) => {
        const x0 = x + i * s * 0.42;
        cv.line(x0, y + s, x0 + s * 0.42, y, s * 0.2, col);
    });
    cv.text('M', x + s * 1.35, y + s * 0.92, s * 0.85, t.text, { font: 'bold' });
}

function draw(cv, t, ctl) {
    // ---- M tricolour stripe along the bottom bar, flush with the button bar ----
    const stripes = t.stripes || ['#81c4ff', '#16588e', '#e7222e'];
    const bh = 6, bw = W / stripes.length;
    stripes.forEach((col, i) => cv.fillRect(Math.round(i * bw), H - bh, Math.ceil(bw), bh, col));

    // ---- header: logo + title on the left ----
    drawMLogo(cv, t, 24, 8, 46);
    cv.text('AQ///Bimmer', 24 + 90 + 14, 42, 36, t.text, { align: 'left', font: 'label' });
    cv.text(URL, W - 24, 30, 19, t.dim, { align: 'right', font: 'label' });

    // ---- flap status ------------------------------------------------------------
    G.panel(cv, t, 24, 68, 1552, 168, 'FLAP STATUS');
    const val = ctl.state === 'AUTO' ? 'AUTO' : ctl.state === 'OPEN' ? 'OPEN' : 'CLOSE';
    const col = ctl.state === 'AUTO' ? t.ok : ctl.state === 'OPEN' ? t.crit : t.accent2;
    cv.text(val, 52, 180, 108, col, { font: 'gear' });
    cv.text(ctl.overrideActive ? 'MANUAL OVERRIDE' : 'AUTOMATIC CONTROL', 52, 220, 26, t.dim, { font: 'label' });

    // ---- three action cards -----------------------------------------------------
    const actions = [
        { key: 'OPEN',  label: 'OPEN' },
        { key: 'CLOSE', label: 'CLOSE' },
        { key: 'AUTO',  label: 'AUTO' },
    ];
    const gap = 24, y = 252, h = 216, w = (1552 - 2 * gap) / 3;
    actions.forEach((a, i) => {
        const x = 24 + i * (w + gap);
        G.panel(cv, t, x, y, w, h, a.label);
        const on = (a.key === ctl.state && ctl.overrideActive) || (a.key === 'AUTO' && !ctl.overrideActive);
        const c = a.key === 'OPEN' ? t.crit : a.key === 'CLOSE' ? t.accent2 : t.ok;
        cv.text(a.label, x + w / 2, y + 120, 58, on ? c : t.dim, { align: 'center', font: 'bold' });
        cv.text(on ? 'ACTIVE' : 'TAP', x + w / 2, y + 168, 22, on ? c : t.dim, { align: 'center', font: 'bold', spacing: 2 });
    });
}

mgu.run({
    async start(ctx) {
        ctx.log.info('starting');
        const diag = await new Diag(ctx.signals, ctx.log).init();
        diag.quiet = true;   // no per-request hex in the log
        const controller = new FlapController(diag, ctx.log);
        const t = ctx.theme();

        async function render() {
            const cv = ctx.canvas(W, H).clear(t.bg);
            draw(cv, t, controller);
            await ctx.ui.image('MAIN_GFX', cv);
            await ctx.ui.text('BTN_PAGE', 'OPEN');
            await ctx.ui.text('BTN_PREV', 'CLOSE');
            await ctx.ui.text('BTN_SETTINGS', 'AUTO');
        }

        ctx.ui.onClick('BTN_PAGE', async () => { await controller.executeFlapCommand('OPEN'); await render(); });
        ctx.ui.onClick('BTN_PREV', async () => { await controller.executeFlapCommand('CLOSE'); await render(); });
        ctx.ui.onClick('BTN_SETTINGS', async () => { await controller.restoreEcuControl(); await render(); });

        await controller.identifyDme();
        await render();
        ctx.log.info('ready');
    },
});