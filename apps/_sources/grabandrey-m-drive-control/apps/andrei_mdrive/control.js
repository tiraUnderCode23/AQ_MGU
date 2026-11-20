'use strict';
// MHD wire values from the MIT MGU kit's real_adapters.js / tune.js.
// Accepted means a positive echo, not physical read-back. Never replay on startup.
const VALUES = { map: [1,2,3,4], flap: ['OEM','OPEN','CLOSED'], cooling: [false,true] };
class Control {
    constructor(options) {
        this.o = options; this.link = null; this.busy = false; this.epoch = 0;
        this.state = { map:null, flap:null, cooling:null };
        this.mapAck = null;
        this.note = 'Enable MHD+ in Settings to use vehicle controls';
    }
    reset() { this.epoch++; this.mapAck = null; this.state = {map:null,flap:null,cooling:null}; this.note = 'State unknown - select a control'; }
    async send(kind, value) {
        if (!VALUES[kind] || VALUES[kind].indexOf(value) < 0) throw new Error('Invalid control value');
        if (this.busy) return false;
        const demo = this.o.demo();
        if (!demo && !this.o.enabled()) { this.note = 'Enable MHD+ in Settings first'; if(kind==='map')this.mapAck={slot:value,status:'disabled'}; return false; }
        if (!demo && (!this.link || !this.link.available)) { this.note = 'Diagnostic link unavailable'; if(kind==='map')this.mapAck={slot:value,status:'unavailable'}; return false; }
        if (!demo && kind === 'cooling' && value && !(this.o.rpm() > 500)) {
            this.note = 'Max cooling needs fresh engine data above 500 rpm'; return false;
        }
        const fn = { map:1, flap:2, cooling:3 }[kind];
        const raw = kind === 'map' ? value - 1 : kind === 'flap' ? VALUES.flap.indexOf(value) : value ? 1 : 0;
        const epoch = this.epoch;
        if(kind==='map')this.mapAck={slot:value,status:'sending'};
        this.busy = true; this.note = demo ? 'Simulating...' : 'Sending to DME...';
        // Clear the old state: a timeout does not establish whether the command took effect.
        this.state[kind] = null;
        try {
            if (!demo) {
                const r = await this.link.sendToDme(0x2f,[fn,raw],3000);
                if (!r || !r.ok || r.sid !== 0x6f || !r.data || r.data[0] !== fn || r.data[1] !== raw)
                    throw new Error(r && r.reason || 'No matching DME acknowledgement');
            }
            if (epoch !== this.epoch) return false;
            this.state[kind] = value;
            if(kind==='map')this.mapAck={slot:value,status:demo?'demo':'accepted'};
            this.note = demo ? 'Demo selection - no command sent' : 'Accepted by DME - no state read-back';
            return true;
        } catch(e) {
            if (epoch === this.epoch) {
                this.note = 'Not confirmed: ' + String(e.message || e).slice(0,95);
                if(kind==='map')this.mapAck={slot:value,status:'unconfirmed'};
            }
            return false;
        } finally { this.busy = false; }
    }
}
module.exports = { Control };
