'use strict';
/*
 * Writes packages/seatlights/app/package/ (the staged OAP package tree MGU Store builds on the head unit) from one
 * description, so application.xml and uiDescription.json always agree: node packages/seatlights/app/tools/gen_package.js
 *
 * The package has no javascript of its own: MGU Store links src/ against the car's oap-sdk into javascript/app.js.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package');
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'mgu-app.json'), 'utf8'));
const ID = app.id, VERSION = app.version;

/* fixed ids: an entry point's uuid must stay the same across versions */
const UUID = {
    application: '83c02e71-00fc-4ea8-87e4-2ee1e1c7835b',
    stringBundle: '7e2d9d29-6d80-4191-a97b-f342a69f4967',
    resourceBundle: '6075963d-1c4b-4d11-9b42-bbf4254a379d',
    entryPoint: '4897df30-db67-41f4-869a-4aec38a93109',
};

const LANGS = ['ar_AE', 'cs_CZ', 'da_DK', 'de_DE', 'el_GR', 'en_GB', 'en_US', 'es_ES', 'es_MX', 'fi_FI', 'fr_CA', 'fr_FR',
    'he_IL', 'hu_HU', 'id_ID', 'it_IT', 'ja_JP', 'ko_KR', 'nl_BE', 'nl_NL', 'no_NO', 'pl_PL', 'pt_BR', 'pt_PT', 'ro_RO',
    'ru_RU', 'sk_SK', 'sl_SI', 'sv_SE', 'th_TH', 'tr_TR', 'uk_UA', 'vi_VN', 'zh_CN', 'zh_TW', 'zh_yue_Hans_CN', 'zh_yue_Hant_CN'];
const STRINGS = { SID_SL_TITLE: 'Seat Lights' };
const STATE = 'ST_OnlineApps_SeatLights';

/* the one screen: title, status line, the switch */
const ROWS = [[21, 'slSwitch', 'Seat lights']];

function write(rel, data) {
    const f = path.join(PKG, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n');
}

/* ---- rhmiData/uiDescriptions/ID8 ---- */
const button = (name, label) => ({
    type: 'button', name: name,
    properties: { Visible: { value: 1, type: 'UInt' }, Focusable: { value: 3, type: 'UInt' } },
    rows: [{
        PrimaryText: { value: label, type: 'Text' },
        FrequencyText: { value: '', type: 'Text' },
        FrequencyVisible: { value: false, type: 'Bool' },
        IconVisible: { value: false, type: 'Bool' },
        ProgressVisible: { value: false, type: 'Bool' },
        IsPlaying: { value: false, type: 'Bool' },
    }],
});
const components = {
    10: { type: 'title', name: STATE + '_Title', properties: { Visible: { value: 1, type: 'UInt' } },
        rows: [{ Text: { value: 'SID_SL_TITLE', type: 'StringId' } }] },
    20: { type: 'label', name: 'slStatus', properties: { Visible: { value: 1, type: 'UInt' }, Focusable: { value: 0, type: 'UInt' } },
        rows: [{ Text: { value: '', type: 'Text' } }] },
};
ROWS.forEach(([id, name, label]) => { components[id] = button(name, label); });
write('rhmiData/uiDescriptions/ID8/uiDescription.json', {
    schemaVersion: '1.3.0',
    containers: { 1: { type: 'state', name: STATE, components: components } },
});

const comp = (id, type, widget, visible, focusable) =>
    `            <component id="${id}" type="${type}"${widget ? ` widget="${widget}"` : ''}>\n` +
    `                <property id="2" value="${visible}"/>\n` +
    (focusable === null ? '' : `                <property id="3" value="${focusable}"/>\n`) +
    '            </component>\n';
write('rhmiData/uiDescriptions/ID8/application.xml',
    '<?xml version="1.0" encoding="UTF-8"?>\n<application>\n' +
    '    <container id="1" type="state" widget="LT_State_Wide_List">\n' +
    '        <layoutGroup id="102" name="Titlebar">\n' +
    comp(10, 'title', null, 1, null) +
    '        </layoutGroup>\n' +
    '        <layoutGroup id="103" name="List">\n' +
    '            <property id="3" value="1"/>\n' +
    comp(20, 'label', 'LT_ScrollLabel', 1, 0) +
    ROWS.map(([id]) => comp(id, 'button', 'LT_Button_MediaEntry_1Row', 1, 3)).join('') +
    '        </layoutGroup>\n' +
    '    </container>\n</application>\n');

/* ---- rhmiData/application.json ---- */
write('rhmiData/application.json', {
    schemaVersion: '1.3.0',
    application: {
        uuid: UUID.application, type: 'OnlineApp', name: ID, vendor: 'SeatLights', version: VERSION, defaultLanguage: 'en_GB',
        uiDescriptions: [{ applicationFilePath: './uiDescriptions/ID8/application.xml',
            uiDescriptionFilePath: './uiDescriptions/ID8/uiDescription.json', hmi: ['ID8'] }],
        stringBundleUuid: UUID.stringBundle,
        resourceBundleUuid: UUID.resourceBundle,
        variantGroups: [{ stringsPath: './variantGroups/Common/texts', resourcesPath: './variantGroups/Common/images',
            hmi: ['ID8'], brands: ['BMW'] }],
        entryPoints: [{
            name: ID, uuid: UUID.entryPoint, textId: 'SID_SL_TITLE', icon: 'seatlights_icon.png',
            insertionStateId: 20974, insertionFocusId: 2, insertionMode: 'INSERT_BELOW', insertionOrder: 0,
            insertionPriority: 0, previewType: 'NONE', bookmarkable: true, private: null, appearance: 'DEFAULT',
            isGroupHeader: false, insertionGroup: 0,
        }],
    },
});
LANGS.forEach((l) => write(`rhmiData/variantGroups/Common/texts/${l}.json`, STRINGS));
fs.mkdirSync(path.join(PKG, 'rhmiData/variantGroups/Common/images'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'icon.png'), path.join(PKG, 'rhmiData/variantGroups/Common/images/seatlights_icon.png'));

/* ---- package.json, manifest.json, permissions.json, config ---- */
write('package.json', {
    name: ID, version: VERSION,
    description: 'One switch: keeps the seat (headrest) logos lit until switched off',
    private: false,
    main: 'javascript/runner.js',
    oapAppSettings: {
        maxDiskUsage: 5242880, cpuLimit: 20, memoryThresholdKB: 65536, priority: 'PRIO_MEDIUM', visibility: 'FOREGROUND',
        latencyClass: 'FOREGROUND', loggingId: 'STLT', userLoginRequired: false, backgroundPriority: 150,
        someipManifest: 'manifest.json',
    },
    files: ['config', 'rhmiData', 'package.json', 'npm-shrinkwrap.json', 'permissions.json', 'javascript', 'manifest.json', 'LICENSE'],
    dependencies: { 'oap-sdk': '24.10.2' },
    engines: { node: '>=8.7.0' },
    author: 'SeatLights',
    license: 'MIT',
    mguHmi: ['ID8'],
    /* MGU Store starts it with the head unit (without a screen until opened): with the switch ON, the logos come on each drive */
    mguAppStartType: 'autostart',
});

const instance = (methods) => ({ instances: ['${userId}'], methods: methods });
write('manifest.json', {
    proxies: {
        'de.bmw.infotainment.telematic.oapcontroller.OAPController': '*',
        'de.bmw.infotainment.hmi.remote.RemoteHmi': '*',
        'de.bmw.infotainment.hmi.remote.RemoteHmiApplication': '*',
        'de.bmw.infotainment.hmi.entrypoint.EntryPoint': '*',
        'de.bmw.infotainment.hmi.entrypoint.EntryPointManager': '*',
        'de.bmw.infotainment.hmi.resourcemanagement.ResourceManager': '*',
        'de.bmw.infotainment.hmi.resourcemanagement.ResourceBundle': '*',
        'de.bmw.infotainment.hmi.resourcemanagement.StringBundle': '*',
        'de.bmw.infotainment.hmi.hmicontext.HMIContext': { instances: ['HMI_CID'], attributes: { currentDisplayLanguage: 'rs' } },
        'de.bmw.infotainment.telematic.oap.PrivateEntryPoint': instance(['registerEntryPoint', 'unregisterEntryPoint', 'setSelected', 'setAvailability']),
        'de.bmw.infotainment.telematic.oap.AppBookmarks': instance(['registerBookmark']),
        'de.bmw.infotainment.telematic.oap.WakeUpOnDemand': instance(['registerParticipant', 'unregisterParticipant']),
        'de.bmw.infotainment.telematic.oap.WodControl': { instances: '${userId}', methods: ['offerService', 'stopOfferingService'] },
        'de.bmw.infotainment.telematic.provisioning.Provisioning': { instances: '1', broadcasts: ['provisioningDataJSON'],
            methods: ['getValueJSON', 'setFilterForProvisioningData'] },
        'de.bmw.infotainment.certification.Certification': '*',
        /* iDrive 8's platform interfaces: MainApp-21's oap-sdk builds the app's screen, resources and entry
         * point on these, and stops when they are missing from the app's someipInterfaces (as the Store's own
         * app and idrive7-apps' kit list them) */
        'de.bmw.infotainment.hmi.hmicontext2.HMIContext2': { instances: ['1'], attributes: { currentDisplayLanguage: 'rs' } },
        'de.bmw.infotainment.hmi.entrypoint2.EntryPoint2': '*',
        'de.bmw.infotainment.hmi.entrypoint2.EntryPointManager2': '*',
        'de.bmw.infotainment.hmi.remote2.RemoteHmi2': '*',
        'de.bmw.infotainment.hmi.remote2.RemoteHmiApplication2': '*',
        'de.bmw.infotainment.hmi.resourcemanagement2.ResourceManager2': '*',
        'de.bmw.infotainment.hmi.resourcemanagement2.ResourceBundle2': '*',
        'de.bmw.infotainment.hmi.resourcemanagement2.StringBundle2': '*',
        'de.bmw.infotainment.hmi.usecasemanagement.UseCaseContext': '*',
        'de.bmw.infotainment.hmi.usecasemanagement.UseCaseInstance': '*',
        'de.bmw.infotainment.hmi.usecasemanagement.UseCaseProvider': '*',
        'de.bmw.infotainment.hmi.usecasemanagement.UseCaseRegistry': '*',
        'de.bmw.infotainment.telematic.oap.PrivateEntryPoint2': instance(['genericMethod']),
        /* the head unit's diagnostic link to the body controller (uds.js allows reads, and the lamp output 45 hold) */
        'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu': { instances: ['SystemFunctionsInternalTasuInst1'],
            methods: ['sendTasuRequest'], broadcasts: ['sendTasuResponse'] },
        /* locked with the engine off bypasses the switch: the engine (as Light Logger reads it on the G87) and the vehicle
         * state (notify only, "s", as the MIT-licensed idrive7-apps kit's Live Adjustments requires it on iDrive 8) */
        'de.bmw.infotainment.vehicle.CDS': { instances: ['1'], attributes: { statusEngineSpeed2: 'rs' } },
        'de.bmw.infrastructure.VehicleCondition': { instances: ['1'], attributes: { VehicleCondition: 's' } },
        'de.bmw.infotainment.personalization.SessionManager': '*',
    },
    services: { 'de.bmw.infotainment.telematic.oap.AppStatus': { instances: ['${userId}'] } },
});

const master = (domain, iface) => ({
    _typeName: 'joynr.infrastructure.DacTypes.MasterAccessControlEntry', uid: '${APPNAME}', domain: domain, interfaceName: iface,
    defaultRequiredTrustLevel: 'HIGH', possibleRequiredTrustLevels: [], defaultRequiredControlEntryChangeTrustLevel: 'HIGH',
    possibleRequiredControlEntryChangeTrustLevels: [], operation: '*', defaultConsumerPermission: 'YES', possibleConsumerPermissions: [],
});
write('permissions.json', {
    masterAccessTable: [
        master('de.bmw.infotainment.telematic.oap.oapcontroller', 'de/bmw/infotainment/telematic/oapcontroller/OAPController'),
        master('de.bmw.infotainment.telematic.oap.appStatus_${APPNAME}', 'de/bmw/infotainment/telematic/oap/appstatus/AppStatus'),
        master('de.bmw.infotainment.telematic.oap.appstart', 'de/bmw/infotainment/telematic/oap/appstart/AppStart'),
        master('de.bmw.infotainment.telematic.oap.privateEntryPoint_${APPNAME}', 'de/bmw/infotainment/telematic/oap/privateentrypoint/PrivateEntryPoint'),
    ],
    mediatorAccessTable: [], ownerAccessTable: [],
    masterRegistrationTable: [{
        _typeName: 'joynr.infrastructure.DacTypes.MasterRegistrationControlEntry', uid: '${APPNAME}',
        domain: 'de.bmw.infotainment.telematic.oap.heartbeat_${APPNAME}',
        interfaceName: 'de/bmw/infotainment/telematic/oap/heartbeat/HeartbeatMonitor',
        defaultRequiredTrustLevel: 'HIGH', possibleRequiredTrustLevels: [], defaultRequiredControlEntryChangeTrustLevel: 'HIGH',
        possibleRequiredControlEntryChangeTrustLevels: [], defaultProviderPermission: 'YES', possibleProviderPermissions: [],
    }],
    mediatorRegistrationTable: [], ownerRegistrationTable: [], domainRoleTable: [],
});
/* newer oap-sdks (27.x donors) build the app's screen and entry point only with these on */
write('config/base.json', { rhmiLoadingEnabled: true, entryPointLoadingEnabled: true });
/* MainApp installs a package without node_modules/ through its shrinkwrap (nothing is fetched) */
write('npm-shrinkwrap.json', { name: ID, version: VERSION, lockfileVersion: 1, requires: true, dependencies: {} });
fs.copyFileSync(path.join(ROOT, '..', '..', '..', 'LICENSE'), path.join(PKG, 'LICENSE'));
console.log('wrote ' + PKG);
