'use strict';
/**
 * mock-jellyfin.js - a stand-in for one Jellyfin server, for the tests and for trying the service and the app on a PC
 * without a server. It speaks only what the Drivefin service asks (native/clucraft-jellyfin/jellyfin.js), over plain
 * HTTP on 127.0.0.1, with an invented library and abstract posters (tools/mock/posters).
 *
 *   const mock = await createMock({ port: 0 });
 *   mock.url            'http://127.0.0.1:<port>'
 *   mock.link()         "the owner entered the Quick Connect code in their Jellyfin": the code then signs in
 *                       (GET /mock/link does the same from outside this process: the emulator with MOCK_LINKED=0)
 *   mock.state          { reports: [...], played: {...}, sessions: {...}, stopped: [...], requests: n, tokenInUrl: n, ... }
 *   mock.ids            { movies: [...], shows: [...] } and mock.find(title) -> the item
 *   mock.close()
 *
 *   node tools/mock-jellyfin.js [port]      runs it by itself (a Quick Connect code is approved at once)
 *
 * Options: linked (a code is approved at once), quick: false (Quick Connect is switched off: a name and password,
 * USER / PASSWORD below), legacy: true (answers as Jellyfin 10.8 did: the older addresses of four requests, Quick
 * Connect begun with a GET), whole: false (a playlist that only lists what follows the start asked for),
 * segmentFail(n, session) -> an HTTP status to fail segment n with, refuse: 'NotAllowed' (playing is refused),
 * noStopAddress (no /Videos/ActiveEncodings), filmSeconds (every film and episode is that long).
 *
 * A film's stream here is not a film: each "segment" is `bytesPerSecond x seconds` of filler bytes, which the tests'
 * stand-in player (test/fake-player.js) counts instead of decoding. As the real server does, the addresses it hands
 * out carry the token (api_key=...): the service must take it out again, and state.tokenInUrl counts each request
 * that arrived with one in its address.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const TOKEN = 'mocktoken0123456789abcdef01234567';
const USER = 'Driver', PASSWORD = 'open-sesame';
const SEG_S = 2;
const BYTES_PER_S = 20000;
const TICKS = 10000000;
const SOURCE_KBPS = 6200;
const POSTERS = path.join(__dirname, 'mock', 'posters');
const id = (s) => crypto.createHash('md5').update('drivefin-mock:' + s).digest('hex');
const USER_ID = id('user'), SERVER_ID = id('server');

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
const EPISODES = [
    ['Arrivals', 'A stranger steps off the last boat with one bag and no return ticket.'],
    ['The Manifest', 'The cargo list is one line too long, and nobody will say who added it.'],
    ['Slack Water', 'For an hour between the tides nothing moves, which is when things go missing.'],
    ['What the Gauge Said', 'The reading was fine. That turned out to be the problem.'],
    ['Night Signals', 'Three flashes from the point, where there has been no light for years.'],
    ['Second Shift', 'The day crew hands over a quiet board. It does not stay quiet.'],
    ['A Borrowed Key', 'A door that should be locked is not, and a key is back on the wrong hook.'],
    ['The Long Count', 'The numbers come out one short, however often they are counted.'],
    ['Weather Coming', 'Everyone can feel it in their knees before the forecast admits it.'],
    ['Dead Reckoning', 'No instruments, a guess at the speed, and a clock that may be wrong.'],
    ['Lamp Oil', 'The old supply runs out the week somebody remembers why it mattered.'],
    ['Returns', 'What left at the start comes back, and it is not as it was.'],
];
const LIBS = [
    { Id: id('lib-movies'), Name: 'Movies', CollectionType: 'movies', Type: 'CollectionFolder' },
    { Id: id('lib-shows'), Name: 'TV Shows', CollectionType: 'tvshows', Type: 'CollectionFolder' },
    { Id: id('lib-music'), Name: 'Music', CollectionType: 'music', Type: 'CollectionFolder' },
    { Id: id('lib-playlists'), Name: 'Playlists', CollectionType: 'playlists', Type: 'UserView' },
];

/** the library: items by id. The mock's own fields: lib, kind order (n), poster, children, pos (s), played, lastPlayed */
function library() {
    const items = {};
    const now = Date.now();
    let n = 0;
    const add = (it) => { it.n = ++n; items[it.Id] = it; return it; };
    MOVIES.forEach((m, i) => {
        add({ Id: id('movie-' + i), Type: 'Movie', Name: m[0], ProductionYear: m[1], seconds: m[2] * 60, Overview: m[3], lib: LIBS[0].Id,
            OfficialRating: ['PG', 'PG-13', 'R'][i % 3], CommunityRating: 6.1 + (i * 7 % 30) / 10, created: now - i * 86400000 * 3, Genres: [['Drama', 'Mystery', 'Comedy'][i % 3]],
            Studios: [{ Name: 'Tidewater Pictures', Id: id('studio') }], poster: i % 12, played: i % 4 === 0, pos: i === 1 ? 41 * 60 : i === 5 ? 12 * 60 : 0,
            lastPlayed: i === 1 ? now - 3600000 : i === 5 ? now - 7200000 : i % 4 === 0 ? now - (i + 2) * 86400000 : 0 });
    });
    SHOWS.forEach((s, si) => {
        const show = add({ Id: id('show-' + si), Type: 'Series', Name: s[0], ProductionYear: s[1], Overview: s[2], lib: LIBS[1].Id, created: now - si * 86400000 * 5,
            OfficialRating: 'TV-14', CommunityRating: 7 + si / 4, Genres: ['Drama'], poster: (si * 5 + 3) % 12, children: [], episodes: [] });
        s[3].forEach((se, sn) => {
            const season = add({ Id: id('season-' + si + '-' + sn), Type: 'Season', Name: 'Season ' + (sn + 1), IndexNumber: sn + 1, show, lib: LIBS[1].Id, created: show.created,
                poster: show.poster, children: [] });
            show.children.push(season);
            for (let e = 0; e < se[0]; e++) {
                // Harbor Lights: three watched, the fourth begun. Small Hours: two watched, none begun (its third is "next up")
                const seen = (si === 0 && sn === 0 && e < 3) || (si === 4 && sn === 0 && e < 2);
                const about = EPISODES[(e + sn * 3) % EPISODES.length];
                const ep = add({ Id: id('ep-' + si + '-' + sn + '-' + e), Type: 'Episode', Name: about[0], IndexNumber: e + 1, ParentIndexNumber: sn + 1,
                    show, season, lib: LIBS[1].Id, seconds: (42 + (e * 3) % 9) * 60, ProductionYear: s[1] + sn, created: show.created + e * 3600000, poster: show.poster,
                    Overview: about[1],
                    played: seen, pos: si === 0 && sn === 0 && e === 3 ? 17 * 60 : 0, lastPlayed: seen ? now - (10 - e) * 86400000 : si === 0 && sn === 0 && e === 3 ? now - 1800000 : 0 });
                season.children.push(ep); show.episodes.push(ep);
            }
        });
    });
    return items;
}
const tag = (it) => id('tag-' + it.Id).slice(0, 32);
const streams = () => [
    { Index: 0, Type: 'Video', Codec: 'h264', BitDepth: 8, Width: 1920, Height: 1080, IsInterlaced: false, Profile: 'High', Level: 41, DisplayTitle: '1080p H264 SDR', VideoRangeType: 'SDR' },
    { Index: 1, Type: 'Audio', Codec: 'ac3', Channels: 6, Language: 'eng', IsDefault: true, DisplayTitle: 'English - Dolby Digital - 5.1 - Default' },
    { Index: 2, Type: 'Audio', Codec: 'aac', Channels: 2, Language: 'fre', DisplayTitle: 'French - AAC - Stereo' },
    { Index: 3, Type: 'Subtitle', Codec: 'subrip', Language: 'eng', IsTextSubtitleStream: true, DisplayTitle: 'English - SUBRIP' },
    { Index: 4, Type: 'Subtitle', Codec: 'subrip', Language: 'ger', IsTextSubtitleStream: true, DisplayTitle: 'German - SUBRIP' },
];
/** what the server sends of an item (BaseItemDto), for this user */
function dto(it, fields) {
    const has = (f) => fields.indexOf(f) >= 0;
    const o = { Id: it.Id, Name: it.Name, Type: it.Type, ServerId: SERVER_ID, ImageTags: { Primary: tag(it) }, BackdropImageTags: [], IsFolder: !!it.children };
    ['ProductionYear', 'IndexNumber', 'ParentIndexNumber', 'OfficialRating', 'CommunityRating'].forEach((k) => { if (it[k] !== undefined) o[k] = it[k]; });
    if (it.seconds) o.RunTimeTicks = it.seconds * TICKS;
    if (has('Overview') && it.Overview) o.Overview = it.Overview;
    if (has('DateCreated')) o.DateCreated = new Date(it.created).toISOString();
    if (has('Genres') && it.Genres) o.Genres = it.Genres;
    if (has('Studios') && it.Studios) o.Studios = it.Studios;
    o.UserData = { PlaybackPositionTicks: Math.round((it.pos || 0) * TICKS), PlayCount: it.played ? 1 : 0, Played: !!it.played, IsFavorite: false, Key: it.Id };
    if (it.Type === 'Series' || it.Type === 'Season') {
        const eps = it.Type === 'Series' ? it.episodes : it.children, left = eps.filter((e) => !e.played).length;
        o.UserData.UnplayedItemCount = left; o.UserData.Played = left === 0; o.UserData.PlayCount = 0; o.UserData.PlaybackPositionTicks = 0;
        if (has('RecursiveItemCount')) o.RecursiveItemCount = eps.length;
        if (has('ChildCount')) o.ChildCount = it.children.length;
    }
    if (it.Type === 'Season') { o.SeriesId = it.show.Id; o.SeriesName = it.show.Name; o.SeriesPrimaryImageTag = tag(it.show); }
    if (it.Type === 'Episode') {
        o.SeriesId = it.show.Id; o.SeriesName = it.show.Name; o.SeriesPrimaryImageTag = tag(it.show); o.SeasonId = it.season.Id; o.SeasonName = it.season.Name;
    }
    if (has('MediaSources') && it.seconds) {
        o.MediaSources = [{ Id: it.Id, Name: it.Name, Container: 'mkv', Protocol: 'File', Bitrate: SOURCE_KBPS * 1000, RunTimeTicks: it.seconds * TICKS, SupportsTranscoding: true,
            DefaultAudioStreamIndex: 1, MediaStreams: streams() }];
    }
    return o;
}

function createMock(opts) {
    const o = Object.assign({ port: 0, whole: true, linked: false, quick: true, legacy: false }, opts || {});
    const items = library();
    const all = Object.keys(items).map((k) => items[k]).sort((a, b) => a.n - b.n);
    // o.filmSeconds: every film and episode is that long (and so is its stream), so a test plays one to its end in a moment
    if (o.filmSeconds) all.forEach((it) => { if (it.seconds) { it.seconds = o.filmSeconds; if (it.pos) it.pos = Math.min(it.pos, Math.round(o.filmSeconds * 0.6)); } });
    const state = { token: TOKEN, reports: [], played: {}, sessions: {}, stopped: [], pings: 0, requests: 0, tokenInUrl: 0, codes: {}, linked: !!o.linked, playbackInfos: 0,
        logins: [], loggedOut: 0, images: [], paths: {} };
    let base = null, codeNo = 123455, sessionNo = 0;

    const sendJson = (res, code, v) => { const b = Buffer.from(JSON.stringify(v)); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length }); res.end(b); };
    const done = (res, code) => { res.writeHead(code || 204); res.end(); };
    const list = (a) => String(a || '').split(',').filter(Boolean);
    const page = (arr, q, fields) => {
        const start = Number(q.startindex) || 0, size = q.limit !== undefined ? Number(q.limit) : arr.length;
        return { Items: arr.slice(start, start + size).map((it) => dto(it, fields)), TotalRecordCount: arr.length, StartIndex: start };
    };
    const authResult = () => ({ User: { Name: USER, Id: USER_ID, ServerId: SERVER_ID, HasPassword: true }, AccessToken: TOKEN, ServerId: SERVER_ID, SessionInfo: { Id: id('session') } });
    const sortName = (it) => it.Name.replace(/^(The|A) /, '');
    function playlist(s) {
        const n = Math.ceil(s.duration / SEG_S), first = o.whole ? 0 : Math.floor(s.offset / SEG_S);
        let t = '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:' + SEG_S + '\n#EXT-X-MEDIA-SEQUENCE:0\n';
        // (as the real server: each segment's address repeats the playlist's own query, the token included)
        for (let i = first; i < n; i++) t += '#EXTINF:' + Math.min(SEG_S, s.duration - i * SEG_S).toFixed(6) + ', nodesc\nhls1/main/' + i + '.ts?' + s.query + '&runtimeTicks=' + i * SEG_S * TICKS + '\n';
        return t + '#EXT-X-ENDLIST\n';
    }
    function endSession(sid) { if (state.sessions[sid]) { state.stopped.push(sid); delete state.sessions[sid]; } }
    function body(req) {
        return new Promise((resolve) => {
            const parts = [];
            req.on('data', (d) => parts.push(d));
            req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch (e) { resolve({}); } });
        });
    }

    const server = http.createServer(async (req, res) => {
        state.requests++;
        const u = url.parse(req.url, true), p = decodeURIComponent(u.pathname), P = p.toLowerCase();
        const q = {};
        Object.keys(u.query).forEach((k) => { q[k.toLowerCase()] = u.query[k]; });
        state.paths[req.method + ' ' + p.replace(/[0-9a-f]{32}/g, '{id}').replace(/\/\d+\.ts$/, '/{n}.ts')] = true;
        if (/[?&](api_key|apikey)=/i.test(req.url)) state.tokenInUrl++;
        const token = (/Token="([^"]*)"/.exec(String(req.headers.authorization || '')) || [])[1] || null;
        const client = /^MediaBrowser Client="[^"]+", Device="[^"]+", DeviceId="[^"]+", Version="[^"]+"/.test(String(req.headers.authorization || ''));
        const fields = list(q.fields);
        let m;

        /* ----- anyone ----- */
        if (P === '/system/info/public') return sendJson(res, 200, { LocalAddress: base, ServerName: 'Jupiter', Version: o.legacy ? '10.8.13' : '10.11.0', ProductName: 'Jellyfin Server', Id: SERVER_ID, StartupWizardCompleted: true });
        if (P === '/quickconnect/enabled') return sendJson(res, 200, o.quick !== false);
        if (P === '/mock/link') { state.linked = true; return sendJson(res, 200, { linked: true }); }      // (the mock's own: no Jellyfin has it)
        if (P === '/quickconnect/initiate') {
            if (req.method !== (o.legacy ? 'GET' : 'POST')) return done(res, 405);
            if (o.quick === false) return sendJson(res, 401, { title: 'Quick connect is not active on this server.' });
            if (!client) return sendJson(res, 400, { title: 'No device' });
            const secret = crypto.randomBytes(16).toString('hex'), code = String(++codeNo);
            state.codes[secret] = { code, at: Date.now() };
            return sendJson(res, 200, { Authenticated: false, Secret: secret, Code: code, DeviceName: 'BMW iDrive 7', AppName: 'Drivefin', DateAdded: new Date().toISOString() });
        }
        if (P === '/quickconnect/connect') {
            const c = state.codes[q.secret];
            if (!c || (o.codeMs && Date.now() - c.at > o.codeMs)) return sendJson(res, 404, { title: 'Unknown quick connect secret.' });
            return sendJson(res, 200, { Authenticated: state.linked, Secret: q.secret, Code: c.code });
        }
        if (P === '/users/authenticatewithquickconnect' && req.method === 'POST') {
            const b = await body(req);
            if (!state.codes[b.Secret] || !state.linked) return sendJson(res, 401, { title: 'Unauthorized' });
            delete state.codes[b.Secret];
            return sendJson(res, 200, authResult());
        }
        if (P === '/users/authenticatebyname' && req.method === 'POST') {
            const b = await body(req);
            state.logins.push(String(b.Username));
            if (String(b.Username).toLowerCase() !== USER.toLowerCase() || b.Pw !== PASSWORD) return sendJson(res, 401, { title: 'Invalid username or password entered.' });
            return sendJson(res, 200, authResult());
        }
        if ((m = /^\/items\/([0-9a-f]{32})\/images\/(primary|backdrop|thumb)$/.exec(P)) && req.method === 'GET') {
            const it = items[m[1]];
            if (!it) return sendJson(res, 404, { title: 'Item not found.' });
            state.images.push({ id: m[1], w: Number(q.fillwidth), h: Number(q.fillheight), format: q.format, tag: q.tag });
            let b;
            try { b = fs.readFileSync(path.join(POSTERS, ('0' + (it.poster + 1)).slice(-2) + '.jpg')); } catch (e) { return sendJson(res, 404, {}); }
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': b.length });
            return res.end(b);
        }

        /* ----- the signed-in user ----- */
        if (token !== TOKEN) return done(res, 401);
        if (o.forbid && o.forbid(p)) return sendJson(res, 403, { title: 'Forbidden' });
        const L = !!o.legacy, uid = '/users/' + USER_ID;
        const route = (modern, older) => P === (L ? older : modern);

        if (P === '/users/me') return sendJson(res, 200, { Name: USER, Id: USER_ID, ServerId: SERVER_ID, Policy: { EnableMediaPlayback: true, EnableVideoPlaybackTranscoding: true } });
        if (P === '/sessions/logout') { state.loggedOut++; return done(res); }
        if (route('/userviews', uid + '/views')) return sendJson(res, 200, { Items: LIBS, TotalRecordCount: LIBS.length });
        if (route('/useritems/resume', uid + '/items/resume')) {
            return sendJson(res, 200, page(all.filter((it) => it.pos > 0).sort((a, b) => b.lastPlayed - a.lastPlayed), q, fields));
        }
        if (P === '/shows/nextup') {
            const next = [];
            all.filter((it) => it.Type === 'Series').forEach((s) => {
                let last = -1;
                s.episodes.forEach((e, i) => { if (e.played) last = i; });
                const e = last >= 0 ? s.episodes[last + 1] : null;
                if (e && !(q.enableresumable === 'false' && e.pos > 0)) next.push(e);
            });
            return sendJson(res, 200, page(next, q, fields));
        }
        if (route('/items/latest', uid + '/items/latest')) {
            const types = list(q.includeitemtypes);
            const latest = all.filter((it) => (it.Type === 'Movie' && types.indexOf('Movie') >= 0) || (it.Type === 'Series' && types.indexOf('Episode') >= 0)).sort((a, b) => b.created - a.created);
            return sendJson(res, 200, latest.slice(0, Number(q.limit) || 20).map((it) => dto(it, fields)));
        }
        if ((m = /^\/shows\/([0-9a-f]{32})\/seasons$/.exec(P))) {
            const s = items[m[1]];
            if (!s || s.Type !== 'Series') return sendJson(res, 404, { title: 'Not Found' });
            return sendJson(res, 200, page(s.children, {}, fields));
        }
        if ((m = /^\/shows\/([0-9a-f]{32})\/episodes$/.exec(P))) {
            const s = items[m[1]];
            if (!s || s.Type !== 'Series') return sendJson(res, 404, { title: 'Not Found' });
            let eps = q.seasonid ? ((items[q.seasonid] || {}).children || []) : s.episodes;
            if (q.startitemid) { const i = eps.findIndex((e) => e.Id === q.startitemid); eps = i >= 0 ? eps.slice(i) : []; }
            return sendJson(res, 200, page(eps, q, fields));
        }
        if (P === '/items' && req.method === 'GET') {
            const types = list(q.includeitemtypes);
            let arr;
            if (q.ids) arr = list(q.ids).map((k) => items[k]).filter(Boolean);
            else if (q.searchterm !== undefined) { const s = String(q.searchterm).toLowerCase(); arr = all.filter((it) => types.indexOf(it.Type) >= 0 && it.Name.toLowerCase().indexOf(s) >= 0); }
            else {
                arr = all.filter((it) => it.lib === q.parentid && types.indexOf(it.Type) >= 0);
                if (list(q.filters).indexOf('IsUnplayed') >= 0) arr = arr.filter((it) => (it.episodes ? it.episodes.some((e) => !e.played) : !it.played));
                const by = list(q.sortby)[0], desc = list(q.sortorder)[0] === 'Descending' ? -1 : 1;
                const val = by === 'DateCreated' ? (it) => it.created : by === 'ProductionYear' ? (it) => it.ProductionYear : by === 'DatePlayed' ? (it) => it.lastPlayed || 0 : null;
                arr.sort((a, b) => (val ? (val(a) - val(b)) * desc : 0) || sortName(a).localeCompare(sortName(b)));
            }
            return sendJson(res, 200, page(arr, q, fields));
        }
        if (((m = /^\/userplayeditems\/([0-9a-f]{32})$/.exec(P)) && !L) || ((m = new RegExp('^' + uid + '/playeditems/([0-9a-f]{32})$').exec(P)) && L)) {
            const it = items[m[1]];
            if (!it) return sendJson(res, 404, { title: 'Item not found.' });
            const on = req.method === 'POST';
            (it.episodes || it.children || [it]).forEach((x) => { x.played = on; x.pos = 0; });
            it.played = on; it.pos = 0;
            state.played[m[1]] = on;
            return sendJson(res, 200, dto(it, []).UserData);
        }

        /* ----- playing ----- */
        if ((m = /^\/items\/([0-9a-f]{32})\/playbackinfo$/.exec(P)) && req.method === 'POST') {
            const it = items[m[1]], b = await body(req);
            if (!it || !it.seconds) return sendJson(res, 404, { title: 'Item not found.' });
            state.playbackInfos++;
            if (o.refuse) return sendJson(res, 200, { MediaSources: [], PlaySessionId: null, ErrorCode: o.refuse });
            const sid = id('play-' + (++sessionNo) + '-' + Date.now()), kbps = Math.round((Number(b.MaxStreamingBitrate) || 4000000) / 1000);
            const sub = b.SubtitleStreamIndex !== undefined && Number(b.SubtitleStreamIndex) >= 0;
            const reasons = ['ContainerNotSupported', 'AudioCodecNotSupported'].concat(kbps < SOURCE_KBPS ? ['ContainerBitrateExceedsLimit'] : []).concat(sub ? ['SubtitleCodecNotSupported'] : []);
            const query = 'DeviceId=' + encodeURIComponent((/DeviceId="([^"]*)"/.exec(req.headers.authorization) || [])[1] || '') + '&MediaSourceId=' + it.Id + '&VideoCodec=h264&AudioCodec=aac' +
                '&AudioStreamIndex=' + (b.AudioStreamIndex !== undefined ? b.AudioStreamIndex : 1) + (sub ? '&SubtitleStreamIndex=' + b.SubtitleStreamIndex + '&SubtitleMethod=Encode' : '') +
                '&VideoBitrate=' + Math.max(100, kbps - 192) * 1000 + '&AudioBitrate=192000&TranscodingMaxAudioChannels=2&PlaySessionId=' + sid + '&api_key=' + TOKEN +
                '&SegmentContainer=ts&MinSegments=1&BreakOnNonKeyFrames=False&TranscodeReasons=' + reasons.join(',');
            state.sessions[sid] = { key: it.Id, offset: Math.round((Number(b.StartTimeTicks) || 0) / TICKS), duration: it.seconds, info: b, query, segments: [], lists: 0 };
            return sendJson(res, 200, { PlaySessionId: sid, MediaSources: [{ Id: it.Id, Container: 'mkv', SupportsDirectPlay: false, SupportsDirectStream: false, SupportsTranscoding: true,
                TranscodingUrl: '/videos/' + it.Id + '/master.m3u8?' + query, TranscodingSubProtocol: 'hls', TranscodingContainer: 'ts', DefaultAudioStreamIndex: 1, MediaStreams: streams() }] });
        }
        if ((m = /^\/videos\/([0-9a-f]{32})\/(master|main)\.m3u8$/.exec(P))) {
            const s = state.sessions[q.playsessionid];
            if (!s || s.key !== m[1]) return sendJson(res, 404, { title: 'Not Found' });
            res.writeHead(200, { 'Content-Type': 'application/x-mpegURL' });
            if (m[2] === 'master') return res.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=' + ((Number(q.videobitrate) || 0) + 192000) + ',AVERAGE-BANDWIDTH=' + ((Number(q.videobitrate) || 0) + 192000) +
                ',CODECS="avc1.640029,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=24\nmain.m3u8?' + s.query + '\n');
            s.lists++;
            return res.end(playlist(s));
        }
        if ((m = /^\/videos\/([0-9a-f]{32})\/hls1\/main\/(\d+)\.ts$/.exec(P))) {
            const s = state.sessions[q.playsessionid], n = Number(m[2]);
            if (!s || s.key !== m[1]) return sendJson(res, 404, { title: 'Not Found' });
            const bad = o.segmentFail ? o.segmentFail(n, Object.assign({ id: q.playsessionid }, s)) : 0;
            if (bad) return done(res, bad);
            s.segments.push(n);
            const secs = Math.max(0, Math.min(SEG_S, s.duration - n * SEG_S));
            const b = Buffer.alloc(Math.round(secs * BYTES_PER_S), n % 64);     // (never 0x47, which MPEG-TS packets begin with)
            res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': b.length });
            return res.end(b);
        }
        if ((m = /^\/sessions\/playing(\/progress|\/stopped)?$/.exec(P)) && req.method === 'POST') {
            const b = await body(req), kind = m[1] ? m[1].slice(1) : 'start', it = items[b.ItemId], time = Math.round((Number(b.PositionTicks) || 0) / TICKS * 10) / 10;
            state.reports.push({ kind, key: b.ItemId, session: b.PlaySessionId || null, time, paused: !!b.IsPaused, audio: b.AudioStreamIndex, subtitle: b.SubtitleStreamIndex, method: b.PlayMethod });
            if (it) {
                it.lastPlayed = Date.now();
                // as the server: a film left past nine tenths of it is watched, and is not resumed
                if (kind === 'stopped' && it.seconds && time > it.seconds * 0.9) { it.played = true; it.pos = 0; } else it.pos = time;
            }
            if (kind === 'stopped' && b.PlaySessionId) endSession(b.PlaySessionId);
            return done(res);
        }
        if (P === '/sessions/playing/ping' && req.method === 'POST') { state.pings++; return done(res); }
        if (P === '/videos/activeencodings' && req.method === 'DELETE' && !o.noStopAddress) { endSession(q.playsessionid); return done(res); }
        return sendJson(res, 404, { title: 'the mock has no ' + req.method + ' ' + p });
    });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(o.port, '127.0.0.1', () => {
            base = 'http://127.0.0.1:' + server.address().port;
            const of = (type) => all.filter((it) => it.Type === type);
            resolve({ url: base, port: server.address().port, state, items, options: o, libs: LIBS.map((l) => l.Id), movies: of('Movie'), shows: of('Series'),
                find: (title) => all.filter((it) => it.Name === title)[0] || null,
                link() { state.linked = true; }, close() { return new Promise((r) => server.close(r)); } });
        });
    });
}

if (require.main === module) {
    createMock({ port: Number(process.argv[2]) || 8096, linked: true, filmSeconds: Number(process.env.MOCK_FILM_S) || 0 }).then((m) => {
        console.log('mock Jellyfin server at ' + m.url + '  (user ' + USER + ', password ' + PASSWORD + '; a Quick Connect code is approved at once)');
    }, (e) => { console.error(e.message); process.exit(1); });
}

module.exports = { createMock, TOKEN, USER, PASSWORD, USER_ID, SERVER_ID, SEG_S, BYTES_PER_S };
