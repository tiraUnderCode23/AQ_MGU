'use strict';
/** AQ ID8 adaptation. Original ID7 geometry remains the artwork coordinate system.
 * Only destinations change. No dimensions of a particular car are assumed:
 * cluster-render's proto-1 hello is authoritative for map/hud dimensions.
 * The cluster uses the map slot on ID8, never the unavailable panel target.
 */
const geom = require('./geom');
const MAX_TARGET_SIZE = 16384;

function profile(backend, text) {
    const targets = Object.create(null), problems = Object.create(null);
    if (backend !== 'id8') return { valid: false, targets, problems, reason: 'ID8 requires an ID8 renderer hello' };
    if (typeof text !== 'string' || text.length > 4096) return { valid: false, targets, problems, reason: 'Invalid renderer target description' };
    const seen = Object.create(null);
    text.split(',').forEach((entry) => {
        const match = /^([a-zA-Z][\w-]*):([1-9]\d*)x([1-9]\d*)$/.exec(entry.trim());
        const name = entry.split(':')[0].trim();
        if (name !== 'map' && name !== 'hud') return;
        if (seen[name]) { delete targets[name]; problems[name] = 'Duplicate target in renderer hello'; return; }
        seen[name] = true;
        const width = match ? Number(match[2]) : 0, height = match ? Number(match[3]) : 0;
        if (!(width > 0 && height > 0 && width <= MAX_TARGET_SIZE && height <= MAX_TARGET_SIZE)) {
            problems[name] = 'Invalid target size in renderer hello'; return;
        }
        targets[name] = [width, height];
    });
    ['map', 'hud'].forEach((name) => { if (!targets[name] && !problems[name]) problems[name] = 'Target not advertised by the renderer'; });
    const valid = !!(targets.map || targets.hud);
    return { valid, targets, problems, reason: valid ? '' : 'No valid ID8 map or HUD target advertised' };
}

function contain(rect, virtualSize, actualSize) {
    if (!rect || !virtualSize || !actualSize) return null;
    if (![rect.x, rect.y, rect.w, rect.h].every((n) => typeof n === 'number' && isFinite(n)) ||
        rect.x < 0 || rect.y < 0 || rect.w <= 0 || rect.h <= 0 ||
        rect.x + rect.w > virtualSize[0] || rect.y + rect.h > virtualSize[1]) return null;
    const scale = Math.min(actualSize[0] / virtualSize[0], actualSize[1] / virtualSize[1]);
    const ox = (actualSize[0] - virtualSize[0] * scale) / 2, oy = (actualSize[1] - virtualSize[1] * scale) / 2;
    const x = Math.round(ox + rect.x * scale), y = Math.round(oy + rect.y * scale);
    const right = Math.round(ox + (rect.x + rect.w) * scale), bottom = Math.round(oy + (rect.y + rect.h) * scale);
    if (right <= x || bottom <= y) return null;
    return { target: rect.target, x, y, w: right - x, h: bottom - y };
}

function layersFor(cfg, display, sel, hello, warn) {
    if (!hello || !hello.valid) return [];
    // Original 'both' applies the author's map offset. Its HUD layers are
    // discarded when only the cluster was selected; artwork itself is unchanged.
    const virtual = geom.layersFor(cfg, display === 'cluster' ? 'both' : display, sel, warn)
        .filter((layer) => display !== 'cluster' || layer.which === 'cluster');
    const out = [];
    virtual.forEach((layer) => {
        const target = layer.which === 'cluster' ? 'map' : 'hud';
        if (!hello.targets[target]) return;
        const rect = contain(layer.rect, geom.TARGETS[target], hello.targets[target]);
        if (!rect) { if (warn) warn('ID8 ' + target + ': virtual artwork does not fit; layer omitted'); return; }
        // spec.rect and spec.geom stay virtual for shader uniforms and image pixels.
        out.push(Object.assign({}, layer, { outputRect: rect }));
    });
    return out;
}

module.exports = { profile, contain, layersFor, MAX_TARGET_SIZE };
