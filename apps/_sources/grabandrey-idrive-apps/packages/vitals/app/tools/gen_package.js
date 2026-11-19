'use strict';
/*
 * Writes packages/vitals/app/package/ (the staged OAP package tree MGU Store builds on
 * the head unit) from one description, so application.xml and uiDescription.json always
 * agree: node packages/vitals/app/tools/gen_package.js
 *
 * The package has no javascript of its own: MGU Store links src/ against the car's oap-sdk
 * into javascript/app.js, and the donor's entry point goes at package.json's `main`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package');
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'mgu-app.json'), 'utf8'));
const ID = app.id, VERSION = app.version;

/* fixed ids: an entry point's uuid must stay the same across versions */
const UUID = {
    application: '3d8e5a17-b2c4-4f09-8e6a-51c7d9f0a2b3',
    stringBundle: '9a1f4c6e-7d25-4b83-a0e9-c2d5b8f17e46',
    resourceBundle: 'f05b2d8a-c913-47e6-b5a1-8e4c3f7d2a90',
    entryPoint: '7c4a9e2f-5b18-4d63-9f0e-a2b6c81d5e37',
};

const LANGS = ['ar_AE', 'cs_CZ', 'da_DK', 'de_DE', 'el_GR', 'en_GB', 'en_US', 'es_ES', 'es_MX', 'fi_FI', 'fr_CA', 'fr_FR',
    'he_IL', 'hu_HU', 'id_ID', 'it_IT', 'ja_JP', 'ko_KR', 'nl_BE', 'nl_NL', 'no_NO', 'pl_PL', 'pt_BR', 'pt_PT', 'ro_RO',
    'ru_RU', 'sk_SK', 'sl_SI', 'sv_SE', 'th_TH', 'tr_TR', 'uk_UA', 'vi_VN', 'zh_CN', 'zh_TW', 'zh_yue_Hans_CN', 'zh_yue_Hant_CN'];
const STRINGS = { SID_VT_TITLE: 'Vitals' };

/* the one screen: title, status line, a button per setting (settings_model.js ROWS), in the drawn screen's
 * reading order (ui.js): under the drawn screen the controller walks this list */
const BUTTONS = [
    [21, 'vtTempUnit', 'Temperature unit'],
    [22, 'vtPressUnit', 'Pressure unit'],
    [23, 'vtCoolantWarn', 'Water warning'],
    [24, 'vtOilWarn', 'Engine oil warning'],
    [25, 'vtGearboxWarn', 'Gearbox oil warning'],
    [26, 'vtAccent', 'Gauge colour'],
    [27, 'vtPressures', 'Tyre pressures'],
    [28, 'vtDemo', 'Demo values'],
    [30, 'vtUp', 'Move widget up'],
    [31, 'vtDown', 'Move widget down'],
    [33, 'vtZoomOut', 'Widget smaller'],
    [32, 'vtZoomIn', 'Widget bigger'],
    [29, 'vtReset', 'Reset to defaults'],
];

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
    10: { type: 'title', name: 'ST_OnlineApps_Vitals_Title', properties: { Visible: { value: 1, type: 'UInt' } },
        rows: [{ Text: { value: 'SID_VT_TITLE', type: 'StringId' } }] },
    20: { type: 'label', name: 'vtStatus', properties: { Visible: { value: 1, type: 'UInt' }, Focusable: { value: 0, type: 'UInt' } },
        rows: [{ Text: { value: '', type: 'Text' } }] },
};
BUTTONS.forEach(([id, name, label]) => { components[id] = button(name, label); });
write('rhmiData/uiDescriptions/ID8/uiDescription.json', {
    schemaVersion: '1.3.0',
    containers: { 1: { type: 'state', name: 'ST_OnlineApps_Vitals', components: components } },
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
    BUTTONS.map(([id]) => comp(id, 'button', 'LT_Button_MediaEntry_1Row', 1, 3)).join('') +
    '        </layoutGroup>\n' +
    '    </container>\n</application>\n');

/* ---- rhmiData/application.json ---- */
write('rhmiData/application.json', {
    schemaVersion: '1.3.0',
    application: {
        uuid: UUID.application, type: 'OnlineApp', name: ID, vendor: 'Vitals', version: VERSION, defaultLanguage: 'en_GB',
        uiDescriptions: [{ applicationFilePath: './uiDescriptions/ID8/application.xml',
            uiDescriptionFilePath: './uiDescriptions/ID8/uiDescription.json', hmi: ['ID8'] }],
        stringBundleUuid: UUID.stringBundle,
        resourceBundleUuid: UUID.resourceBundle,
        variantGroups: [{ stringsPath: './variantGroups/Common/texts', resourcesPath: './variantGroups/Common/images',
            hmi: ['ID8'], brands: ['BMW'] }],
        entryPoints: [{
            name: ID, uuid: UUID.entryPoint, textId: 'SID_VT_TITLE', icon: 'vitals_icon.png',
            insertionStateId: 20974, insertionFocusId: 2, insertionMode: 'INSERT_BELOW', insertionOrder: 0,
            insertionPriority: 0, previewType: 'NONE', bookmarkable: true, private: null, appearance: 'DEFAULT',
            isGroupHeader: false, insertionGroup: 0,
        }],
    },
});
LANGS.forEach((l) => write(`rhmiData/variantGroups/Common/texts/${l}.json`, STRINGS));
fs.mkdirSync(path.join(PKG, 'rhmiData/variantGroups/Common/images'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'icon.png'), path.join(PKG, 'rhmiData/variantGroups/Common/images/vitals_icon.png'));

/* ---- package.json, manifest.json, permissions.json, config ---- */
write('package.json', {
    name: ID, version: VERSION,
    description: 'Water, engine oil, gearbox oil and tyre temperatures for the Vitals cluster widget, and its settings',
    private: false,
    main: 'javascript/runner.js',
    oapAppSettings: {
        maxDiskUsage: 5242880, cpuLimit: 20, memoryThresholdKB: 65536, priority: 'PRIO_MEDIUM', visibility: 'FOREGROUND',
        latencyClass: 'FOREGROUND', loggingId: 'VTLS', userLoginRequired: false, backgroundPriority: 150,
        someipManifest: 'manifest.json',
    },
    files: ['config', 'rhmiData', 'package.json', 'npm-shrinkwrap.json', 'permissions.json', 'javascript', 'manifest.json', 'LICENSE'],
    dependencies: { 'oap-sdk': '24.10.2' },
    engines: { node: '>=8.7.0' },
    author: 'Vitals',
    license: 'MIT',
    mguHmi: ['ID8'],
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
        /* the car data the widget shows (car_data.js). BMW's installer refuses the whole app for one field
         * access the car's interface lacks: basicDataSet has no getter, so it is notify-only ("s") */
        'de.bmw.infotainment.vehicle.CDS': { instances: ['1'], attributes: { statusEngineTemperature: 'rs' } },
        'de.bmw.infotainment.vehicle.TPMS': { instances: ['1'], attributes: { statusTyreTemperature: 'rs', statusTyrePressure: 'rs' } },
        'de.bmw.infotainment.vehicle.Vehicle': { instances: ['1'], attributes: { statusNewCurrentUnitsStatusExt: 'rs' } },
        'de.bmw.infrastructure.analytics.BasicDataSet': { instances: ['1'], attributes: { basicDataSet: 's' } },
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
