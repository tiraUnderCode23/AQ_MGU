/*
 * Vitals: the widget's geometry, in layer pixels (632 x 572, the iDrive 8 widget's safe rect).
 * One place for it: shader.js draws the graphics from it, view.js places the text with it.
 * Works in Node (module.exports) and in a browser (window.VITALS_LAYOUT).
 *
 * Top: three temperature bars (water, engine oil, gearbox oil), iDrive 8 style: segments slanted
 * forward like the car's own gauges.
 * No backdrop: everything outside the shapes and text is transparent.
 * Bottom: the four tyres, front at the top, each coloured by its temperature, with its
 * temperature and pressure, each with its unit, beside it.
 */
(function (root) {
    var L = {
        W: 632, H: 572,
        /* the bars: label above on the left, the bar under it (a segment per 10 C, 2 x hh tall, slanted by `slant`
         * degrees), its value in line with it on the right, as tall as the bar (baseline valueDy under its middle) */
        bar: { x0: 40, x1: 446, dy: 26, hh: 17, step: 10, slant: 24, gap: 5, valueX: 556, unitX: 562, valueDy: 17 },
        gauges: [
            { key: 'coolant', label: 'WATER', y: 42, min: 40, max: 140 },
            { key: 'oil', label: 'ENGINE OIL', y: 116, min: 40, max: 160 },
            { key: 'gearbox', label: 'GEARBOX OIL', y: 190, min: 40, max: 140 },
        ],
        divider: { y: 250, x0: 40, x1: 592 },
        tyreHead: { y: 280 },
        /* the tyres: centres dx either side of cx, a front and a rear row; half size, corner radius */
        tyre: { cx: 316, dx: 66, yFront: 352, yRear: 466, hw: 18, hh: 42, r: 9 },
        /* the text beside a tyre: gap px from the tyre's outer edge; temperature and pressure baselines */
        tyreText: { gap: 22, dyT: 2, dyP: 42 },
    };
    L.corners = [
        { key: 'FL', x: L.tyre.cx - L.tyre.dx, y: L.tyre.yFront, side: 'left' },
        { key: 'FR', x: L.tyre.cx + L.tyre.dx, y: L.tyre.yFront, side: 'right' },
        { key: 'RL', x: L.tyre.cx - L.tyre.dx, y: L.tyre.yRear, side: 'left' },
        { key: 'RR', x: L.tyre.cx + L.tyre.dx, y: L.tyre.yRear, side: 'right' },
    ];
    if (typeof module !== 'undefined' && module.exports) module.exports = L;
    else root.VITALS_LAYOUT = L;
})(this);
