'use strict';
/**
 * shots.js - the app's pages as PNGs, drawn on this computer (no car, no Plex account):
 *
 *   node tools/shots.js [outDir]        default docs/
 *
 * The real store and ui of apps/clucraft_plex, the real service (native/clucraft-plex) against tools/mock-plex.js
 * (an invented library with abstract posters) and the tests' stand-in player; the kit's software canvas draws
 * them (tools/stage.js). The film's picture is a stand-in: the software path has no video.
 */
const fs = require('fs');
const path = require('path');
const { createStage, ROOT } = require('./stage');

const out = path.resolve(process.argv[2] || path.join(ROOT, 'docs'));
const quietLog = console.log;
console.log = (s) => { if (/^shot /.test(String(s))) quietLog(s); };   // (the service's own log lines are not wanted here)

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const st = await createStage({ linked: false, speed: 1 });
    const S = st.S;
    const save = (name) => { st.frame(); fs.writeFileSync(path.join(out, name + '.png'), st.png()); console.log('shot ' + name + '.png  (' + S.page + ')'); };
    const posters = () => st.settle(900);

    await st.settle(300);
    st.tap('ln_get');
    await st.until(() => S.st.link && S.st.link.code, 5000, 'the code');
    save('signin');

    st.mock.link();
    await st.until(() => S.page === 'home' && S.connected() && S.home.at, 10000, 'home');
    S.toast = null;
    await posters();
    save('home');

    st.tap('rail_lib1');
    await st.until(() => S.lib && S.lib.items.length, 5000, 'the library');
    await posters();
    save('library');

    st.tap('rail_lib2');
    await st.until(() => S.lib && S.lib.type === 'show' && S.lib.items.length, 5000, 'the shows');
    S.open(S.lib.items.filter((x) => x.title === 'Harbor Lights')[0]);
    await st.until(() => S.show && S.show.seasons.length && S.show.episodes[S.show.seasons[S.show.sel].key] && S.show.episodes[S.show.seasons[S.show.sel].key].items, 5000, 'the episodes');
    await posters();
    save('show');

    S.back();
    st.tap('rail_lib1'); await st.settle(200);
    S.open(S.lib.items.filter((x) => x.title === 'Night Freight')[0]);
    await st.until(() => S.detail && S.detail.item, 5000, 'the film');
    await posters();
    save('film');
    st.tap('d_subs'); st.frame();
    save('subtitles');
    S.picker = null;

    S.top('search');
    'light'.split('').forEach((c) => S.key(c));
    S.runSearch();
    await st.until(() => S.search.results, 5000, 'the search');
    save('search');

    // the player, parked: its controls over the picture
    S.back(); S.open(S.lib.items.filter((x) => x.title === 'Night Freight')[0]);
    await st.until(() => S.detail && S.detail.item, 5000, 'the film');
    st.frame(); st.tap('d_resume');
    await st.until(() => S.pb() && S.pb().state === 'playing', 10000, 'playing');
    await st.settle(1200);
    S.overlayUntil = Date.now() + 60000;
    save('player');

    // driving, the setting off: the sound plays on, the picture is off
    st.car.parked = false;
    save('player-driving');

    // the passenger disclaimer (Settings: Video while driving), asked with the car parked
    st.car.parked = true;
    S.back(); st.values.motion = true; S.page = 'consent';
    save('disclaimer');
    await st.close();
    process.exit(0);
})().catch((e) => { console.error('shots: ' + (e && e.stack || e)); process.exit(1); });
