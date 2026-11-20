// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const { Recorder } = require('./kit_record.js');
const kit = require('./kit_record.js');
const { RenderClient } = require('./mgu_render_client.js');
const W = 1200;
const H = 510;
const ID = 'mazzahaker_xdrive_remover';
const TEXT = '#f3f6fc';
const MUTED = '#aebed0';
const ACCENT = '#70aaff';
const CARD = '#15191f';

class Drawn {
    constructor(log, onTab, onRefresh, client, onFrontOff, onInteractionLost = () => {}) {
        this.gpu = client || new RenderClient(ID, log, { kit, mode: 'layer' });
        this.onTab = onTab;
        this.onRefresh = onRefresh;
        this.onFrontOff = onFrontOff;
        this.onInteractionLost = onInteractionLost;
        this.visible = false;
        this.focus = 0;
        this.items = [];
        this.details = false;
        this.gpu.fps(24);
        this.gpu.on('ready', (_screen, info) => {
            this.info = info;
            const box = info && info.appArea;
            if (box && box.w > 0 && box.h > 0 && info.modes.includes('layer') && (info.touch || info.controller)) {
                const scale = Math.min(box.w / W, box.h / H);
                this.gpu.place({ x: box.x, y: box.y, w: box.w, h: box.h, scale,
                    ox: Math.round((box.w - W * scale) / 2), oy: Math.round((box.h - H * scale) / 2) });
                this.available = true;
            } else {
                this.available = false;
            }
            this.update();
        });
        this.gpu.on('tick', () => { if (this.dirty) this.draw(); });
        this.gpu.on('close', () => {
            this.available = false;
            this.loseInteraction();
        });
        this.gpu.on('closed', () => {
            this.dismissed = true;
            this.loseInteraction();
        });
        this.gpu.on('touch', (phase, x, y) => {
            if (!this.active) return;
            const hit = this.items.find(i => x >= i.x && x < i.x + i.w && y >= i.y && y < i.y + i.h);
            if (phase === 'down') this.down = hit && hit.action;
            if (phase === 'up') {
                const action = this.down;
                this.down = null;
                if (hit && hit.action === action) this.act(action);
            }
        });
        this.gpu.on('ccu', event => {
            const previous = this.ccu;
            this.ccu = event;
            if (!this.active || !previous || !this.items.length) return;
            const steps = ((event.knob - previous.knob + 0x18000) % 0x10000) - 0x8000;
            if (event.knob !== 0xffff && previous.knob !== 0xffff && Math.abs(steps) <= 24 && steps) {
                this.focus = Math.max(0, Math.min(this.items.length - 1, this.focus + steps));
                this.render(this.model);
            }
            if (event.press && event.press !== previous.press && event.seq !== previous.seq && this.items[this.focus]) {
                this.act(this.items[this.focus].action);
            }
        });
    }

    connect() { this.gpu.connect(); }

    reopen() {
        this.dismissed = false;
        this.unfocused = false;
        this.down = null;
        this.update();
    }

    setVisible(visible) {
        if (visible && !this.visible) this.dismissed = false;
        if (!visible) {
            this.down = null;
            this.ccu = null;
        }
        this.visible = visible;
        this.update();
    }

    setFocused(focused) {
        this.unfocused = !focused;
        if (focused) this.update();
        else this.loseInteraction();
    }

    loseInteraction() {
        this.down = null;
        this.ccu = null;
        this.update();
        this.onInteractionLost();
    }

    update() {
        const active = Boolean(this.visible && this.available && !this.dismissed && !this.unfocused);
        if (this.active === active) return;
        this.active = active;
        this.gpu.claim(active ? [{ x: 0, y: 0, w: W, h: H }] : []);
        this.gpu.grab(active && this.info.controller);
        if (active) this.draw();
        this.gpu.show(active);
        clearInterval(this.keepalive);
        if (active) this.keepalive = setInterval(() => this.draw(), 1000);
    }

    close() {
        this.setVisible(false);
        this.gpu.close();
    }

    render(model) {
        this.model = model;
        this.dirty = true;
        this.draw();
    }

    act(action) {
        if (action === 'drive' || action === 'diagnostics') {
            this.focus = 0;
            this.onTab(action);
        } else if (action === 'refresh') {
            this.onRefresh();
        } else if (action === 'details') {
            this.details = !this.details;
        } else if (action === 'front-off') {
            if (this.onFrontOff && this.model && this.model.tab === 'drive') this.onFrontOff();
        }
        this.render(this.model);
    }

    draw() {
        if (!this.active || !this.model || this.gpu.waiting) return;
        const model = this.model;
        const tab = model.tab;
        const r = new Recorder(W, H);
        this.items = [];
        r.clear('#000000');
        const label = (value, x, y, size, color, width) => {
            let s = String(value);
            while (width && s.length > 1 && r.textWidth(s, size) > width) s = s.slice(0, -2) + '…';
            r.text(s, x, y, size, color || TEXT);
        };
        const button = (title, action, x, y, w, selected) => {
            const h = 43;
            const focused = this.items.length === this.focus && this.info.controller;
            this.items.push({ action, x, y, w, h });
            r.roundRect(x, y, w, h, 9, focused ? '#41668f' : selected ? '#284d75' : CARD);
            label(title, x + 14, y + 28, 20, selected ? ACCENT : TEXT, w - 24);
        };
        for (const [i, name] of ['drive', 'diagnostics'].entries()) {
            button(name[0].toUpperCase() + name.slice(1), name, 32 + 165 * i, 22, 150, tab === name);
        }
        if (tab === 'diagnostics') button('Refresh', 'refresh', 1024, 22, 144);
        if (tab === 'drive') {
            label(model.mode, 32, 129, 46, TEXT, 1136);
            label(model.status, 34, 174, 22, MUTED, 1134);
            for (const [i, metric] of model.metrics.entries()) {
                const x = 32 + 578 * i;
                r.roundRect(x, 214, 558, 140, 14, CARD);
                label(metric[0], x + 23, 258, 22, MUTED, 512);
                label(metric[1], x + 23, 318, 40, TEXT, 512);
            }
            label(model.updated, 34, 395, 21, MUTED, 570);
            const front = model.front;
            front.lines.slice(0, 2).forEach((line, i) => label(line, 34, 423 + 19 * i, 17, MUTED, 550));
            button(front.title, 'front-off', 610, 398, 320, front.confirming);
        } else if (tab === 'diagnostics') {
            r.roundRect(32, 100, 558, 328, 14, CARD);
            r.roundRect(610, 100, 558, 328, 14, CARD);
            label('Control units', 55, 145, 29, ACCENT);
            label('Vehicle signals', 633, 145, 29, ACCENT);
            const rows = this.details ? model.details : model.diagnostics;
            rows.forEach((value, i) => label(value, 55, 188 + 39 * i, 22, TEXT, 512));
            model.signals.forEach((value, i) => label(value, 633, 188 + 39 * i, 20, TEXT, 512));
            button(this.details ? 'Hide details' : 'Details', 'details', 55, 369, 178);
            const front = model.front || { title: 'Front drive OFF', lines: [], confirming: false };
            front.lines.slice(0, 2).forEach((line, i) => label(line, 55, 332 + 20 * i, 17, front.confirming ? ACCENT : MUTED, 512));

        }
        r.text('Created by mazzahaker', 1168, 477, 17, MUTED, { align: 'right' });
        this.focus = Math.min(this.focus, this.items.length - 1);
        this.dirty = !this.gpu.frame(r);
    }
}

module.exports = { Drawn };
