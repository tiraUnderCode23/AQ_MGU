'use strict';
/**
 * mock-plex.js - a stand-in for plex.tv and one Plex Media Server, for the tests and for trying the service and the
 * app on a PC without an account. It speaks only what the Drive-In service asks (native/clucraft-plex/plex.js), over
 * plain HTTP on 127.0.0.1, with an invented library and abstract posters (tools/mock/posters).
 *
 *   const mock = await createMock({ port: 0 });
 *   mock.url            'http://127.0.0.1:<port>'   (plex.tv and the server share it: PLEXD_TV=<url>)
 *   mock.link()         "the owner typed the code at plex.tv/link": the pin then has the account's token
 *   mock.state          { timeline: [...], scrobbled: {...}, sessions: {...}, requests: n, token }
 *   mock.close()
 *
 *   node tools/mock-plex.js [port]      runs it by itself (the code is linked at once)
 *
 * A film's stream here is not a film: each "segment" is `bytesPerSecond x seconds` of filler bytes, which the tests'
 * stand-in player (test/fake-player.js) counts instead of decoding. o.whole: the playlist lists the whole film
 * whatever the offset (as Plex does with copyts); else only what follows the offset. o.segmentFail(n) may make
 * segment n fail (returns an HTTP status) to try the reader's retries.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');

const TOKEN = 'mock-token-0123456789';
const SHARED_TOKEN = 'mock-shared-token';
const SEG_S = 2;
const BYTES_PER_S = 20000;
const POSTERS = path.join(__dirname, 'mock', 'posters');

/* ---------- an invented library ---------- */
const MOVIES = [
    ['The Long Way Round', 2019, 118, 'Two estranged brothers drive a failing delivery van the length of the coast to scatter their father\'s ashes, and argue about every turn.'],
    ['Night Freight', 2021, 96, 'A dispatcher on the last shift of a closing rail yard hears a train on the radio that is not on any schedule.'],
    ['Paper Lanterns', 2016, 104, 'A retired lighthouse keeper teaches a runaway to build lanterns for the harbour festival neither of them plans to attend.'],
    ['Salt and Iron', 2023, 131, 'When the mine reopens, a town that learned to live without it has to decide what it still owes the company.'],
    ['Quiet Machines', 2018, 89, 'An engineer discovers that the factory robots she maintains have been leaving each other small repairs.'],
    ['Under Glass', 2020, 112, 'A botanist locked into a research dome for a year finds a plant in the collection that nobody catalogued.'],
    ['The Cartographer\'s Daughter', 2014, 124, 'She inherits a map with one island too many, and a boat that has been waiting for her.'],
    ['Slow Thunder', 2022, 99, 'A storm chaser past his best season takes one more student, who turns out to be better at it than he ever was.'],
    ['Half Light', 2017, 93, 'A wedding photographer keeps finding the same stranger in the background of other people\'s happiest days.'],
    ['Station Eleven North', 2024, 137, 'Six people winter over at a polar station. The supply plane is late, and the generator has opinions.'],
    ['A Field in Winter', 2015, 101, 'A farmer and the surveyor sent to take his land walk its boundary together, one fence post at a time.'],
    ['Good Company', 2020, 108, 'Three laid-off accountants open a bakery to launder nothing at all, and are investigated anyway.'],
    ['Open Water', 2013, 91, 'A ferry captain makes her last crossing with a passenger list that includes everyone she has ever left behind.'],
    ['The Understudy', 2019, 115, 'On opening night the lead is missing, the understudy knows why, and the curtain goes up regardless.'],
];
const SHOWS = [
    ['Harbor Lights', 2020, 'The crew of a small-town harbour patrol, the fog, and everything it hides.', [[8, 'Fog'], [8, 'Tide']]],
    ['Low Orbit', 2022, 'A salvage crew works the debris belt for a company that may no longer exist.', [[10, 'Salvage']]],
    ['The Allotment', 2018, 'Twelve garden plots, twelve neighbours, and one prize marrow.', [[6, 'Spring'], [6, 'Summer'], [6, 'Autumn']]],
    ['Counterweight', 2023, 'A lift engineer inherits the keys to a building with more floors than it has storeys.', [[8, 'Going Up']]],
    ['Small Hours', 2021, 'The night shift at a regional radio station, call by call.', [[12, 'After Midnight'], [12, 'Before Dawn']]],
    ['Kiln', 2019, 'A family pottery, three generations, and the order that could save or sink it.', [[6, 'Clay']]],
];
const EP_TITLES = ['Arrivals', 'The Manifest', 'Slack Water', 'What the Gauge Said', 'Night Signals', 'Second Shift', 'A Borrowed Key', 'The Long Count',
    'Weather Coming', 'Dead Reckoning', 'Lamp Oil', 'Returns'];

function library() {
    const items = {};
    let rk = 100;
    const now = Math.floor(Date.now() / 1000);
    const media = (durMs, rk2) => [{
        id: rk2 + 5000, duration: durMs, bitrate: 6200, width: 1920, height: 1080, videoResolution: '1080', videoCodec: 'h264', audioCodec: 'ac3', audioChannels: 6, container: 'mkv',
        Part: [{ id: rk2 + 9000, key: '/library/parts/' + (rk2 + 9000) + '/file.mkv', duration: durMs, container: 'mkv', Stream: [
            { id: rk2 * 10 + 1, streamType: 1, codec: 'h264', bitDepth: 8, displayTitle: '1080p (H.264)' },
            { id: rk2 * 10 + 2, streamType: 2, codec: 'ac3', channels: 6, selected: true, languageCode: 'eng', displayTitle: 'English (AC3 5.1)' },
            { id: rk2 * 10 + 3, streamType: 2, codec: 'aac', channels: 2, languageCode: 'fra', displayTitle: 'French (AAC Stereo)' },
            { id: rk2 * 10 + 4, streamType: 3, codec: 'srt', languageCode: 'eng', displayTitle: 'English (SRT)' },
        ] }],
    }];
    MOVIES.forEach((m, i) => {
        const k = String(++rk);
        items[k] = { ratingKey: k, key: '/library/metadata/' + k, type: 'movie', title: m[0], year: m[1], duration: m[2] * 60000, summary: m[3],
            thumb: '/library/metadata/' + k + '/thumb/' + (1700000000 + i), art: '/library/metadata/' + k + '/art/' + (1700000000 + i), librarySectionID: 1,
            contentRating: ['PG', 'PG-13', 'R'][i % 3], audienceRating: 6.1 + (i * 7 % 30) / 10, addedAt: now - i * 86400 * 3, viewCount: i % 4 === 0 ? 1 : 0,
            viewOffset: i === 1 ? 41 * 60000 : i === 5 ? 12 * 60000 : undefined, Genre: [{ tag: ['Drama', 'Mystery', 'Comedy'][i % 3] }], Media: media(m[2] * 60000, rk), poster: i % 12 };
    });
    SHOWS.forEach((s, si) => {
        const showKey = String(++rk);
        let leaves = 0;
        const show = items[showKey] = { ratingKey: showKey, key: '/library/metadata/' + showKey + '/children', type: 'show', title: s[0], year: s[1], summary: s[2],
            thumb: '/library/metadata/' + showKey + '/thumb/' + (1700001000 + si), librarySectionID: 2, childCount: s[3].length, addedAt: now - si * 86400 * 5,
            contentRating: 'TV-14', audienceRating: 7 + si / 4, poster: (si * 5 + 3) % 12, children: [] };
        s[3].forEach((se, sn) => {
            const seasonKey = String(++rk);
            const season = items[seasonKey] = { ratingKey: seasonKey, key: '/library/metadata/' + seasonKey + '/children', type: 'season', title: 'Season ' + (sn + 1), index: sn + 1,
                parentRatingKey: showKey, parentTitle: s[0], thumb: show.thumb, parentThumb: show.thumb, leafCount: se[0], viewedLeafCount: sn === 0 && si === 0 ? 3 : 0,
                librarySectionID: 2, addedAt: show.addedAt, poster: show.poster, children: [] };
            show.children.push(seasonKey);
            for (let e = 0; e < se[0]; e++) {
                const k = String(++rk);
                const durMs = (42 + (e * 3) % 9) * 60000;
                items[k] = { ratingKey: k, key: '/library/metadata/' + k, type: 'episode', title: EP_TITLES[(e + sn * 3) % EP_TITLES.length], index: e + 1, parentIndex: sn + 1,
                    parentRatingKey: seasonKey, parentTitle: season.title, grandparentRatingKey: showKey, grandparentTitle: s[0], grandparentThumb: show.thumb,
                    thumb: '/library/metadata/' + k + '/thumb/' + (1700002000 + e), duration: durMs, year: s[1] + sn, librarySectionID: 2,
                    summary: 'In which ' + s[0] + ' has a ' + EP_TITLES[(e + sn * 3) % EP_TITLES.length].toLowerCase() + ' sort of week.', addedAt: show.addedAt + e * 3600,
                    viewCount: si === 0 && sn === 0 && e < 3 ? 1 : 0, viewOffset: si === 0 && sn === 0 && e === 3 ? 17 * 60000 : undefined, Media: media(durMs, rk), poster: show.poster };
                season.children.push(k);
                leaves++;
            }
        });
        show.leafCount = leaves; show.viewedLeafCount = si === 0 ? 3 : 0;
    });
    return items;
}
/** what the server sends of an item (the mock's own fields left out) */
function out(it, full) {
    const o = {};
    Object.keys(it).forEach((k) => { if (k !== 'children' && k !== 'poster' && (full || (k !== 'Media' && k !== 'Genre')) && it[k] !== undefined) o[k] = it[k]; });
    return o;
}

function createMock(opts) {
    const o = Object.assign({ port: 0, whole: true, linked: false, relayOnly: false }, opts || {});
    const items = library();
    const all = Object.keys(items).map((k) => items[k]);
    // o.filmSeconds: every film and episode is that long (and so is its stream), so a test plays one to its end in a moment
    if (o.filmSeconds) all.forEach((it) => { if (it.duration) { it.duration = o.filmSeconds * 1000; if (it.viewOffset) it.viewOffset = Math.min(it.viewOffset, Math.round(o.filmSeconds * 600)); (it.Media || []).forEach((m) => { m.duration = it.duration; }); } });
    const state = { token: TOKEN, timeline: [], scrobbled: {}, sessions: {}, stopped: [], pings: 0, requests: 0, pins: {}, linked: !!o.linked, streams: [], decisions: 0 };
    let base = null, pinId = 1000;

    const sendJson = (res, code, v) => { const b = Buffer.from(JSON.stringify(v)); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': b.length }); res.end(b); };
    const mc = (res, v) => sendJson(res, 200, { MediaContainer: v });
    const page = (list, q) => {
        const start = Number(q['X-Plex-Container-Start']) || 0, size = Number(q['X-Plex-Container-Size']) || list.length;
        return { size: Math.min(size, Math.max(0, list.length - start)), totalSize: list.length, offset: start, Metadata: list.slice(start, start + size).map((it) => out(it)) };
    };
    function playlist(session) {
        const s = state.sessions[session];
        const n = Math.ceil(s.duration / SEG_S), first = o.whole ? 0 : Math.floor(s.offset / SEG_S);
        let t = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:' + SEG_S + '\n#EXT-X-MEDIA-SEQUENCE:0\n';
        for (let i = first; i < n; i++) t += '#EXTINF:' + Math.min(SEG_S, s.duration - i * SEG_S).toFixed(3) + ',\n' + ('0000' + i).slice(-5) + '.ts\n';
        return t + '#EXT-X-ENDLIST\n';
    }

    const server = http.createServer((req, res) => {
        state.requests++;
        const u = url.parse(req.url, true), p = decodeURIComponent(u.pathname), q = u.query;
        const token = req.headers['x-plex-token'];
        let m;

        /* ----- plex.tv ----- */
        if (p === '/api/v2/pins' && req.method === 'POST') {
            const id = String(++pinId);
            state.pins[id] = { code: 'AB' + String(pinId).slice(-2), at: Date.now() };
            return sendJson(res, 201, { id: Number(id), code: state.pins[id].code.toLowerCase(), expiresAt: new Date(Date.now() + (o.pinMs || 900000)).toISOString(), authToken: null });
        }
        if ((m = /^\/api\/v2\/pins\/(\d+)$/.exec(p))) {
            const pin = state.pins[m[1]];
            if (!pin) return sendJson(res, 404, { errors: [{ message: 'Code not found or expired' }] });
            return sendJson(res, 200, { id: Number(m[1]), code: pin.code, authToken: state.linked ? TOKEN : null });
        }
        if (p === '/api/v2/user') {
            if (token !== TOKEN) return sendJson(res, 401, { errors: [{ message: 'User could not be authenticated' }] });
            return sendJson(res, 200, { id: 4242, username: 'driver', friendlyName: 'Driver', email: 'driver@example.com' });
        }
        if (p === '/api/v2/resources') {
            if (token !== TOKEN) return sendJson(res, 401, { errors: [{ message: 'User could not be authenticated' }] });
            const cons = [{ protocol: 'http', address: '10.255.255.1', port: 32400, uri: 'http://10.255.255.1:32400', local: true, relay: false }];
            if (!o.relayOnly) cons.push({ protocol: 'http', address: '127.0.0.1', port: server.address().port, uri: base, local: false, relay: false });
            cons.push({ protocol: 'http', address: '127.0.0.1', port: server.address().port, uri: base + '/', local: false, relay: true });
            return sendJson(res, 200, [
                { name: 'Driver\'s phone', clientIdentifier: 'phone-1', provides: 'client,player', owned: true, connections: [] },
                { name: 'Jupiter', clientIdentifier: 'srv-1', provides: 'server', owned: true, presence: true, accessToken: TOKEN, connections: cons },
                { name: 'A friend\'s server', clientIdentifier: 'srv-2', provides: 'server', owned: false, presence: true, accessToken: SHARED_TOKEN, connections: cons },
            ]);
        }

        /* ----- the server ----- */
        if (p === '/identity') return mc(res, { machineIdentifier: 'srv-1', version: '1.41.0' });
        if (token !== TOKEN && token !== SHARED_TOKEN) return sendJson(res, 401, { errors: [{ message: 'Unauthorized' }] });
        if (o.forbid && o.forbid(p)) return sendJson(res, 403, { errors: [{ message: 'Remote playback needs a Plex Pass' }] });

        if (p === '/library/sections') return mc(res, { Directory: [{ key: '1', title: 'Movies', type: 'movie' }, { key: '2', title: 'TV Shows', type: 'show' }, { key: '3', title: 'Music', type: 'artist' }] });
        if (p === '/library/onDeck') return mc(res, page(all.filter((it) => it.viewOffset), q));
        if (p === '/library/recentlyAdded') return mc(res, page(all.filter((it) => it.type === 'movie' || it.type === 'season').sort((a, b) => b.addedAt - a.addedAt), q));
        if ((m = /^\/library\/sections\/(\d+)\/all$/.exec(p))) {
            let list = all.filter((it) => String(it.librarySectionID) === m[1] && it.type === (q.type === '2' ? 'show' : 'movie'));
            if (q.unwatched === '1') list = list.filter((it) => !it.viewCount);
            if (q.unwatchedLeaves === '1') list = list.filter((it) => (it.viewedLeafCount || 0) < (it.leafCount || 0));
            if (/^addedAt/.test(q.sort || '')) list.sort((a, b) => b.addedAt - a.addedAt);
            else if (/^year/.test(q.sort || '')) list.sort((a, b) => b.year - a.year);
            else list.sort((a, b) => a.title.replace(/^(The|A) /, '').localeCompare(b.title.replace(/^(The|A) /, '')));
            return mc(res, page(list, q));
        }
        if ((m = /^\/library\/metadata\/(\d+)\/children$/.exec(p))) {
            const it = items[m[1]];
            if (!it || !it.children) return sendJson(res, 404, {});
            return mc(res, { size: it.children.length, Metadata: it.children.map((k) => out(items[k])) });
        }
        if ((m = /^\/library\/metadata\/(\d+)$/.exec(p))) {
            const it = items[m[1]];
            if (!it) return sendJson(res, 404, {});
            return mc(res, { size: 1, Metadata: [out(it, true)] });
        }
        if (p === '/hubs/search') {
            const s = String(q.query || '').toLowerCase();
            const hit = (type) => all.filter((it) => it.type === type && it.title.toLowerCase().indexOf(s) >= 0).slice(0, Number(q.limit) || 10).map((it) => out(it));
            return mc(res, { Hub: [{ type: 'movie', Metadata: hit('movie') }, { type: 'show', Metadata: hit('show') }, { type: 'episode', Metadata: hit('episode') }, { type: 'actor', Metadata: [] }] });
        }
        if (p === '/photo/:/transcode') {
            const mm = /^\/library\/metadata\/(\d+)\//.exec(String(q.url || ''));
            const it = mm && items[mm[1]];
            if (!it) return sendJson(res, 404, {});
            let b;
            try { b = fs.readFileSync(path.join(POSTERS, ('0' + (it.poster + 1)).slice(-2) + '.jpg')); } catch (e) { return sendJson(res, 404, {}); }
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': b.length });
            return res.end(b);
        }
        if (p === '/:/scrobble' || p === '/:/unscrobble') {
            const it = items[q.key];
            if (it) { it.viewCount = p === '/:/scrobble' ? (it.viewCount || 0) + 1 : 0; if (p === '/:/scrobble') delete it.viewOffset; state.scrobbled[q.key] = p === '/:/scrobble'; }
            res.writeHead(200); return res.end();
        }
        if ((m = /^\/library\/parts\/(\d+)$/.exec(p)) && req.method === 'PUT') { state.streams.push({ part: m[1], audio: q.audioStreamID || null, subtitle: q.subtitleStreamID != null ? q.subtitleStreamID : null }); res.writeHead(200); return res.end(); }
        if (p === '/:/timeline') {
            state.timeline.push({ key: q.ratingKey, state: q.state, time: Number(q.time), duration: Number(q.duration) });
            const it = items[q.ratingKey];
            if (it && q.state !== 'buffering') { it.viewOffset = Number(q.time); if (it.duration && Number(q.time) > it.duration * 0.9) { it.viewCount = (it.viewCount || 0) + 1; delete it.viewOffset; } }
            return mc(res, { size: 0 });
        }

        /* ----- the transcoder ----- */
        if (p === '/video/:/transcode/universal/decision') {
            state.decisions++;
            if (o.refuse) return mc(res, { generalDecisionCode: 2000, generalDecisionText: o.refuse });
            return mc(res, { generalDecisionCode: 1001, generalDecisionText: 'Direct play not available; Conversion OK.', transcodeDecisionCode: 1001, transcodeDecisionText: 'Conversion OK.',
                Metadata: [{ Media: [{ Part: [{ Stream: [{ streamType: 1, decision: Number(q.maxVideoBitrate) >= 6200 ? 'copy' : 'transcode' }, { streamType: 2, decision: 'transcode' }] }] }] }] });
        }
        if (p === '/video/:/transcode/universal/start.m3u8') {
            const it = items[String(q.path || '').replace('/library/metadata/', '')];
            if (!it || !q.session) return sendJson(res, 400, {});
            state.sessions[q.session] = { key: it.ratingKey, offset: Number(q.offset) || 0, duration: Math.round(it.duration / 1000), args: q, segments: [] };
            res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
            return res.end('#EXTM3U\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=' + (Number(q.maxVideoBitrate) || 4000) * 1000 + ',RESOLUTION=' + (q.videoResolution || '1280x720') + '\nsession/' + q.session + '/base/index.m3u8\n');
        }
        if ((m = /^\/video\/:\/transcode\/universal\/session\/([^/]+)\/base\/index\.m3u8$/.exec(p))) {
            if (!state.sessions[m[1]]) return sendJson(res, 404, {});
            res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
            return res.end(playlist(m[1]));
        }
        if ((m = /^\/video\/:\/transcode\/universal\/session\/([^/]+)\/base\/(\d+)\.ts$/.exec(p))) {
            const s = state.sessions[m[1]], n = Number(m[2]);
            if (!s) return sendJson(res, 404, {});
            const bad = o.segmentFail ? o.segmentFail(n, s) : 0;
            if (bad) { res.writeHead(bad); return res.end(); }
            s.segments.push(n);
            const secs = Math.max(0, Math.min(SEG_S, s.duration - n * SEG_S));
            const b = Buffer.alloc(Math.round(secs * BYTES_PER_S), n & 0xff);
            res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': b.length });
            return res.end(b);
        }
        if (p === '/video/:/transcode/universal/stop') { state.stopped.push(q.session); delete state.sessions[q.session]; res.writeHead(200); return res.end(); }
        if (p === '/video/:/transcode/universal/ping') { state.pings++; res.writeHead(200); return res.end(); }
        sendJson(res, 404, { errors: [{ message: 'the mock has no ' + p }] });
    });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(o.port, '127.0.0.1', () => {
            base = 'http://127.0.0.1:' + server.address().port;
            resolve({ url: base, state, items, options: o, link() { state.linked = true; }, close() { return new Promise((r) => server.close(r)); } });
        });
    });
}

if (require.main === module) {
    createMock({ port: Number(process.argv[2]) || 32499, linked: true, filmSeconds: Number(process.env.MOCK_FILM_S) || 0 }).then((m) => {
        console.log('mock plex.tv and server at ' + m.url + '  (PLEXD_TV=' + m.url + ' PLEXD_SYSTEM_DNS=1)');
    }, (e) => { console.error(e.message); process.exit(1); });
}

module.exports = { createMock, TOKEN, SEG_S, BYTES_PER_S };
