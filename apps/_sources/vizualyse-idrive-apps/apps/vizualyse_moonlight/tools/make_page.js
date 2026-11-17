// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Yousaf Khan
/* Writes the page (application.xml and uiDescription.json) from one list,
 * so the two always agree.  node tools/make_page.js <staged tree> */
'use strict';
const fs = require('fs');
const path = require('path');
const T = process.argv[2];
/* [id, type, widget, name, focusable, first text] */
const C = [
    [20, 'label', 'LT_Label_1Row', 'moonlightStatus', 0, 'Connecting...'],
    /* the touch screen again (the app opens it by itself on entry) */
    [24, 'button', 'LT_Button_1Row', 'moonlightTouch', 3, 'Touch screen'],
    [21, 'label', 'LT_Label_1Graphic_Scalable', 'moonlightQr', 0, null],
    [22, 'label', 'LT_Label_1Row', 'moonlightLink', 0, ''],
    [23, 'label', 'LT_Label_1Row', 'moonlightHint', 0, ''],
    [30, 'button', 'LT_Button_1Row', 'moonlightEnable', 3, 'Moonlight: on'],
    /* where the picture goes; rows: OUTPUTS in vizualyse_moonlight.js */
    [34, 'dropDownMenu', 'LT_DropDownMenu_1Row_2Col3070', 'moonlightOutput', 3, 'Picture on', ['Centre console', 'Cluster', 'HUD']],
    [31, 'button', 'LT_Button_1Row', 'moonlightStop', 3, 'Stop'],
    [32, 'button', 'LT_Button_1Row', 'moonlightQuit', 3, 'Quit game'],
    [33, 'button', 'LT_Button_1Row', 'moonlightResume', 3, 'Resume last'],
    [40, 'label', 'LT_Label_1Row', 'moonlightInfo', 0, ''],
];
const dir = path.join(T, 'rhmiData', 'uiDescriptions', 'ID7');
let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- SPDX-License-Identifier: GPL-3.0-or-later -->\n<!-- Copyright (C) 2026 Yousaf Khan -->\n<application>\n' +
    '    <container id="1" type="state" widget="LT_State_Wide">\n        <layoutGroup id="100" name="Titlebar">\n' +
    '            <component id="10" type="title">\n                <property id="2" value="1"/>\n            </component>\n        </layoutGroup>\n' +
    '        <layoutGroup id="200" name="List">\n            <property id="3" value="1"/>\n';
C.forEach(([id, type, widget, , focus]) => {
    xml += `            <component id="${id}" type="${type}" widget="${widget}">\n                <property id="2" value="1"/>\n                <property id="3" value="${focus}"/>\n            </component>\n`;
});
/* The screen state (2, ParentState 1): opened while the touch screen (the
 * tool's) covers the app area: the app opens it on entry. Nothing focusable
 * or touchable on it, because the HMI still gets every touch on the touch
 * screen and would press whatever lies under it. BACK (the arrow outside
 * the touch screen) returns to the main page. */
xml += '        </layoutGroup>\n    </container>\n' +
    '    <container id="2" type="state" widget="LT_State_Wide">\n        <property id="9" value="1"/>\n' +
    '        <layoutGroup id="101" name="Titlebar">\n' +
    '            <component id="50" type="title">\n                <property id="2" value="1"/>\n            </component>\n        </layoutGroup>\n' +
    '        <layoutGroup id="201" name="List">\n            <property id="3" value="1"/>\n' +
    '            <component id="51" type="label" widget="LT_Label_1Row">\n                <property id="2" value="1"/>\n                <property id="3" value="0"/>\n            </component>\n' +
    '        </layoutGroup>\n    </container>\n</application>\n';
fs.writeFileSync(path.join(dir, 'application.xml'), xml);
const vis = { Visible: { value: 1, type: 'UInt' } };
const comps = { 10: { type: 'title', name: 'moonlightTitle', properties: vis, rows: [{ Text: { value: 'SID_MOONLIGHT_TITLE', type: 'StringId' } }] } };
C.forEach(([id, type, , name, focus, text, items]) => {
    const properties = Object.assign({}, vis, { Focusable: { value: focus, type: 'UInt' } });
    /* a drop-down: its header and choice in cells, one row per item (as upstream's Waze "Show on") */
    comps[id] = items ? { type: type, name: name, properties: properties,
        cells: { HeaderText: { value: text, type: 'Text' }, SelectedItem: { value: 0, type: 'UInt' } },
        rows: items.map((t) => ({ ItemText: { value: t, type: 'Text' } })) }
        : { type: type, name: name, properties: properties, rows: [text === null ? {} : { Text: { value: text, type: 'Text' } }] };
});
fs.writeFileSync(path.join(dir, 'uiDescription.json'),
    JSON.stringify({ schemaVersion: '1.3.0', containers: {
        1: { type: 'state', name: 'ST_OnlineApps_VizualyseMoonlight', components: comps },
        2: { type: 'state', name: 'ST_OnlineApps_VizualyseMoonlightScreen', components: {
            50: { type: 'title', name: 'moonlightScreenTitle', properties: vis, rows: [{ Text: { value: 'SID_MOONLIGHT_TITLE', type: 'StringId' } }] },
            51: { type: 'label', name: 'moonlightScreenNote', properties: Object.assign({}, vis, { Focusable: { value: 0, type: 'UInt' } }),
                rows: [{ Text: { value: 'The touch screen is up. List (top right) or Back shows the list.', type: 'Text' } }] },
        } },
    } }, null, 2) + '\n');
console.log('page: ' + C.length + ' rows');
