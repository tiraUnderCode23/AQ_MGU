/*
 * Vitals: the fragment shader cluster-render runs for the widget (an `effect` layer,
 * GLSL ES 1.00, `varying vec2 v_uv` with its origin top-left). It draws every shape:
 * the three temperature bars, the divider and the four tyres; the text comes from two
 * 8-bit textures text.js fills (u_texV: values in white, u_texL: labels in grey).
 * The geometry comes from layout.js, written into the source as constants.
 *
 * The widget has no backdrop: alpha is 0 wherever nothing is drawn.
 *
 * Uniforms (view.js): u_size, u_accA/u_accB (the fill's two ends), u_cool/u_oil/u_gbox
 * (fraction, valid, warn), u_warnAt (the warn points as fractions), u_tFL..u_tRR (tyre colour
 * rgb + valid), samplers u_texV and u_texL.
 *
 * Works in Node (module.exports) and in a browser (window.VITALS_SHADER).
 */
(function (root) {
    var L = typeof module !== 'undefined' && module.exports ? require('./layout.js') : root.VITALS_LAYOUT;

    function f(n) { var s = String(n); return s.indexOf('.') < 0 && s.indexOf('e') < 0 ? s + '.0' : s; }
    function v2(x, y) { return 'vec2(' + f(x) + ', ' + f(y) + ')'; }

    var UNI = { coolant: 'u_cool', oil: 'u_oil', gearbox: 'u_gbox' };
    var WARN = { coolant: 'x', oil: 'y', gearbox: 'z' };

    function build() {
        var B = L.bar, T = L.tyre, D = L.divider;
        var bar = function (g) {
            var segs = (g.max - g.min) / B.step;
            return '    bar(p, ' + f(g.y + B.dy) + ', ' + f((B.x1 - B.x0) / segs) + ', ' + UNI[g.key] + ', u_warnAt.' + WARN[g.key] + ', col, a);';
        };
        var tyre = function (c) {
            return '    tyre(p - ' + v2(c.x, c.y) + ', u_t' + c.key + ', col, a);';
        };
        return [
            'precision mediump float;',
            'varying vec2 v_uv;',
            'uniform vec2 u_size;',
            'uniform vec3 u_accA;',
            'uniform vec3 u_accB;',
            'uniform vec3 u_cool;',
            'uniform vec3 u_oil;',
            'uniform vec3 u_gbox;',
            'uniform vec3 u_warnAt;',
            'uniform vec4 u_tFL;',
            'uniform vec4 u_tFR;',
            'uniform vec4 u_tRL;',
            'uniform vec4 u_tRR;',
            'uniform sampler2D u_texV;',
            'uniform sampler2D u_texL;',
            '',
            'const float X0 = ' + f(B.x0) + ';',
            'const float X1 = ' + f(B.x1) + ';',
            'const float HH = ' + f(B.hh) + ';',
            'const float SLANT = ' + f(Math.round(Math.tan(B.slant * Math.PI / 180) * 10000) / 10000) + ';',
            'const float GAP = ' + f(B.gap) + ';',
            'const vec3 TRACK = vec3(0.150, 0.158, 0.178);',
            'const vec3 RED = vec3(0.90, 0.17, 0.12);',
            '',
            'float aa(float d) { return 1.0 - smoothstep(-0.75, 0.75, d); }',
            'void over(inout vec3 col, inout float a, vec3 c, float m) { col = mix(col, c, m); a = max(a, m); }',
            'float sdBox(vec2 p, vec2 b, float r) {',
            '    vec2 q = abs(p) - b + r;',
            '    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;',
            '}',
            '',
            '/* a temperature bar of slanted segments: track, fill (accent, all red when warned), warn tick and zone.',
            '   Everything is worked out on x sheared back by the slant, so every edge leans forward. */',
            'void bar(vec2 p, float y, float seg, vec3 g, float warnAt, inout vec3 col, inout float a) {',
            '    if (abs(p.y - y) > HH + 10.0 || p.x < X0 - 16.0 || p.x > X1 + 16.0) return;',
            '    vec2 s = vec2(p.x + (p.y - y) * SLANT, p.y);',
            '    float k = 1.0 / sqrt(1.0 + SLANT * SLANT);         /* sheared x distances -> true distances */',
            '    float t = (s.x - X0) / (X1 - X0);',
            '    float d = max((abs(s.x - (X0 + X1) * 0.5) - (X1 - X0) * 0.5) * k, abs(p.y - y) - HH);',
            '    /* a gap at every step, slanted with the segments */',
            '    float sx = mod(s.x - X0 + GAP * 0.5, seg);',
            '    float gap = (s.x > X0 + GAP && s.x < X1 - GAP) ? 1.0 - smoothstep(GAP - 0.6, GAP + 0.6, sx) : 0.0;',
            '    float m = aa(d) * (1.0 - gap);',
            '    over(col, a, TRACK, m * 0.9);',
            '    if (g.y > 0.5 && g.x > 0.002) {',
            '        float fx = X0 + g.x * (X1 - X0);',
            '        vec3 fill = g.z > 0.5 ? RED : mix(u_accA, u_accB, clamp(t / max(g.x, 0.001), 0.0, 1.0));',
            '        float fm = m * aa((s.x - fx) * k);',
            '        over(col, a, fill, fm);',
            '        /* a soft glow round the fill end */',
            '        float glow = exp(-max(length(vec2(max(s.x - fx, 0.0), (p.y - y) * 1.4)) - HH, 0.0) / 6.0) * 0.45 * (1.0 - aa(d));',
            '        over(col, a, fill, glow * step(X0, s.x) * step(s.x, X1 + 12.0));',
            '    }',
            '    /* the warn zone: a thin line under the bar from the warn point on */',
            '    float wx = X0 + warnAt * (X1 - X0);',
            '    float ly = y + HH + 4.0;',
            '    float lx = p.x + (ly - y) * SLANT;',
            '    if (lx >= wx && lx <= X1) over(col, a, RED * 0.85, aa(abs(p.y - ly) - 0.75));',
            '    /* the warn point: a tick across the bar, slanted like it */',
            '    over(col, a, RED, aa(max(abs(s.x - wx) * k - 1.0, abs(p.y - y) - HH - 5.0)) * 0.95);',
            '}',
            '',
            '/* a tyre seen from above: dark rubber, rounded across its width, with a centre groove and V-shaped',
            '   sipes; its temperature only tints it faintly (t.w 0: no reading, plain rubber) */',
            'void tyre(vec2 q, vec4 t, inout vec3 col, inout float a) {',
            '    if (abs(q.x) > ' + f(T.hw + 4) + ' || abs(q.y) > ' + f(T.hh + 4) + ') return;',
            '    float d = sdBox(q, ' + v2(T.hw, T.hh) + ', ' + f(T.r) + ');',
            '    float amt = t.w > 0.5 ? 0.22 : 0.0;',
            '    vec3 tint = t.w > 0.5 ? t.rgb : vec3(0.5);',
            '    vec3 rubber = mix(vec3(0.075, 0.078, 0.085), tint, amt);',
            '    float ax = abs(q.x) / ' + f(T.hw) + ';',
            '    vec3 c = rubber * (0.55 + 0.75 * (1.0 - ax * ax));             /* the round profile */',
            '    float sp = abs(fract((q.y + abs(q.x) * 0.7 + 100.0) / 8.0) - 0.5) * 8.0;',
            '    float sipe = (1.0 - smoothstep(0.7, 1.5, sp)) * step(3.5, abs(q.x)) * step(abs(q.x), ' + f(T.hw - 3.5) + ');',
            '    float groove = 1.0 - smoothstep(0.9, 1.7, abs(q.x));',
            '    c = mix(c, c * 0.3, max(sipe * 0.8, groove * 0.9));',
            '    c += tint * amt * 0.35 * smoothstep(' + f(T.hw - 5) + ', ' + f(T.hw - 1) + ', abs(q.x));     /* the shoulders catch the tint */',
            '    over(col, a, c, aa(d));',
            '    over(col, a, mix(vec3(0.30, 0.31, 0.34), tint, amt * 1.6), aa(abs(d) - 0.7) * 0.85);',
            '}',
            '',
            'void main() {',
            '    vec2 p = v_uv * u_size;',
            '    vec3 col = vec3(0.0);',
            '    float a = 0.0;',
            '',
            L.gauges.map(bar).join('\n'),
            '',
            '    /* the divider, fading at its ends */',
            '    float dx = clamp(min(p.x - ' + f(D.x0) + ', ' + f(D.x1) + ' - p.x) / 60.0, 0.0, 1.0);',
            '    over(col, a, vec3(0.30, 0.31, 0.34), aa(abs(p.y - ' + f(D.y) + ') - 0.5) * dx);',
            '',
            L.corners.map(tyre).join('\n'),
            '',
            '    /* text: labels grey, values white (red on a warned bar) */',
            '    float tl = texture2D(u_texL, v_uv).r;',
            '    over(col, a, vec3(0.56, 0.58, 0.62), tl);',
            '    float tv = texture2D(u_texV, v_uv).r;',
            '    vec3 vc = vec3(0.97);',
            L.gauges.map(function (g) {
                var cy = g.y + B.dy;
                return '    if (' + UNI[g.key] + '.z > 0.5 && p.x > ' + f(B.x1 + 20) + ' && p.y > ' + f(cy - B.hh - 8) + ' && p.y < ' + f(cy + B.hh + 8) + ') vc = vec3(1.0, 0.42, 0.36);';
            }).join('\n'),
            '    over(col, a, vc, tv);',
            '',
            '    /* straight alpha (cluster-render blends that way): over() mixed col from black where nothing',
            '       was under it, so take that back out, or edges and faint text come out too dark */',
            '    gl_FragColor = vec4(a > 0.001 ? min(col / a, vec3(1.0)) : vec3(0.0), a);',
            '}',
        ].join('\n');
    }

    var API = { build: build };
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
    else root.VITALS_SHADER = API;
})(this);
