'use strict';
// A small low-poly car in 3D, drawn with filled polygons (painter's algorithm) and glowing
// lamp points. The same file runs in the head unit (kit canvas) and on the phone page
// (HTML canvas): it only calls painter.poly(points, rgba) and painter.dot(x, y, r, rgba).
// Vehicle frame as in lamps.js: x right, y up, z forward (metres).
(function (root) {
    // Cross-sections from front to rear: [z, bottom half-width, bottom y, belt half-width, belt y, roof half-width, roof y]
    var RINGS = [
        [2.42, 0.70, 0.28, 0.74, 0.60, 0.56, 0.72],
        [2.18, 0.88, 0.24, 0.93, 0.70, 0.72, 0.86],
        [1.30, 0.92, 0.22, 0.96, 0.82, 0.82, 0.93],
        [0.45, 0.93, 0.22, 0.96, 0.90, 0.64, 1.36],
        [-0.90, 0.93, 0.22, 0.96, 0.92, 0.64, 1.38],
        [-1.75, 0.92, 0.24, 0.95, 0.95, 0.80, 1.04],
        [-2.30, 0.86, 0.28, 0.89, 0.93, 0.72, 1.00],
        [-2.42, 0.74, 0.32, 0.77, 0.82, 0.62, 0.90]
    ];
    var WHEELS = [[-0.93, 0.34, 1.42], [0.93, 0.34, 1.42], [-0.93, 0.34, -1.48], [0.93, 0.34, -1.48]];

    function ring(r) {
        // closed polygon, counter-clockwise seen from the front
        return [[-r[1], r[2], r[0]], [r[1], r[2], r[0]], [r[3], r[4], r[0]], [r[5], r[6], r[0]],
            [-r[5], r[6], r[0]], [-r[3], r[4], r[0]]];
    }
    function buildMesh() {
        var faces = [], rings = RINGS.map(ring), i, k;
        for (i = 0; i < rings.length - 1; i++) {
            var a = rings[i], b = rings[i + 1];
            for (k = 0; k < a.length; k++) {
                var k2 = (k + 1) % a.length;
                // edge 2-3 / 4-5 are the side glass, 3-4 the roof or a window; 0-1 the floor
                var kind = k === 0 ? 'floor' : (k === 2 || k === 4) ? 'side' : k === 3 ? 'top' : 'body';
                if (kind === 'side' && i >= 2 && i <= 4) kind = 'glass';
                if (kind === 'top' && (i === 2 || i === 4)) kind = 'glass';
                faces.push({ pts: [a[k], a[k2], b[k2], b[k]], kind: kind });
            }
        }
        faces.push({ pts: rings[0].slice(), kind: 'nose' });
        faces.push({ pts: rings[rings.length - 1].slice().reverse(), kind: 'tail' });
        WHEELS.forEach(function (w) {
            var pts = [];
            for (var n = 0; n < 14; n++) {
                var t = n / 14 * Math.PI * 2;
                pts.push([w[0] + (w[0] < 0 ? -0.04 : 0.04), w[1] + Math.sin(t) * 0.34, w[2] + Math.cos(t) * 0.34]);
            }
            faces.push({ pts: w[0] < 0 ? pts.slice().reverse() : pts, kind: 'wheel' });
        });
        return faces;
    }
    var MESH = buildMesh();
    var FACING = -1;
    var PALETTE = {
        body: [92, 114, 150], nose: [84, 104, 138], tail: [84, 104, 138], floor: [24, 28, 34],
        glass: [20, 30, 46], top: [104, 126, 162], wheel: [14, 16, 20]
    };

    function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function norm(a) { var l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

    /** view: {x, y, w, h, yaw, pitch, scale?, dist?} -> camera with project(p) and the screen box */
    function camera(view) {
        var cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(-view.pitch), sp = Math.sin(-view.pitch);
        var dist = view.dist || 7.2, scale = view.scale || Math.min(view.w / 6.2, view.h / 3.3) * dist;
        var cx = view.x + view.w / 2, cyy = view.y + view.h * 0.60;
        function toCam(p) {
            // rotate around y (yaw), then around x (pitch); camera looks along -z
            var x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy, y = p[1] - 0.65;
            var y2 = y * cp - z * sp, z2 = y * sp + z * cp;
            return [x, y2, z2];
        }
        function project(p) {
            var c = toCam(p), d = dist - c[2];
            return [cx + c[0] * scale / d, cyy - c[1] * scale / d, c[2]];
        }
        return { toCam: toCam, project: project, dist: dist };
    }

    /**
     * Draw the car. lamps: [{points, hex|rgb, on, dim}] ; painter: {poly(pts, rgba), dot(x, y, r, rgba)}
     */
    function render(painter, view, lamps) {
        var cam = camera(view), light = norm([0.4, 0.9, 0.5]);
        var drawn = [];
        MESH.forEach(function (f) {
            var cs = f.pts.map(cam.toCam), ps = f.pts.map(cam.project);
            // back faces: screen-space winding (all faces are wound the same way seen from outside)
            var area = 0;
            for (var i = 0; i < ps.length; i++) { var q = ps[(i + 1) % ps.length]; area += ps[i][0] * q[1] - q[0] * ps[i][1]; }
            if (area * FACING >= 0) return;
            var depth = cs.reduce(function (s, p) { return s + p[2]; }, 0) / cs.length;
            var base = PALETTE[f.kind] || PALETTE.body;
            var wn = norm(cross(sub(f.pts[1], f.pts[0]), sub(f.pts[2], f.pts[0])));
            var lit = 0.5 + 0.5 * Math.max(0, -(wn[0] * light[0] + wn[1] * light[1] + wn[2] * light[2]));
            if (f.kind === 'glass') lit = 0.7 + 0.3 * lit;
            drawn.push({ depth: depth, pts: ps, rgba: [Math.round(base[0] * lit), Math.round(base[1] * lit), Math.round(base[2] * lit), 255] });
        });
        drawn.sort(function (a, b) { return a.depth - b.depth; });
        drawn.forEach(function (d) { painter.poly(d.pts.map(function (p) { return [p[0], p[1]]; }), d.rgba); });
        // lamps: only the ones facing the camera; glows on top
        var spots = [];
        (lamps || []).forEach(function (l) {
            var rgb = l.rgb || hexRgb(l.hex || '#ffffff');
            l.points.forEach(function (p) {
                var c = cam.toCam(p);
                var outward = norm([p[0] * 0.8, 0, p[2]]), ow = cam.toCam([outward[0], 0.65, outward[2]]);
                var facing = ow[2] > -0.15;
                if (!facing) return;
                var s = cam.project(p);
                spots.push({ depth: c[2], x: s[0], y: s[1], on: !!l.on, rgb: rgb, dim: l.dim });
            });
        });
        spots.sort(function (a, b) { return a.depth - b.depth; });
        var k = (view.scale ? 1 : Math.min(view.w / 6.2, view.h / 3.3) / 100);
        spots.forEach(function (s) {
            if (s.on) {
                painter.dot(s.x, s.y, 26 * k, [s.rgb[0], s.rgb[1], s.rgb[2], 46]);
                painter.dot(s.x, s.y, 14 * k, [s.rgb[0], s.rgb[1], s.rgb[2], 110]);
                painter.dot(s.x, s.y, 6 * k, [255, 255, 255, 255]);
            } else {
                painter.dot(s.x, s.y, 9 * k, [s.rgb[0], s.rgb[1], s.rgb[2], s.dim ? 30 : 60]);
                painter.dot(s.x, s.y, 3.6 * k, [s.rgb[0], s.rgb[1], s.rgb[2], s.dim ? 150 : 220]);
            }
        });
        return cam;
    }
    function hexRgb(h) {
        var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || '');
        return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
    }
    var Car3D = { render: render, camera: camera, mesh: MESH, hexRgb: hexRgb };
    if (typeof module !== 'undefined' && module.exports) module.exports = Car3D;
    else root.Car3D = Car3D;
})(this);
