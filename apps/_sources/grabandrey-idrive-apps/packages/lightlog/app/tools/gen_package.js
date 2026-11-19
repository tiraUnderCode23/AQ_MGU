'use strict';
/*
 * Writes packages/lightlog/app/package/ (the staged OAP package tree MGU Store builds on the head unit) from one
 * description, so application.xml and uiDescription.json always agree: node packages/lightlog/app/tools/gen_package.js
 *
 * The package has no javascript of its own: MGU Store links src/ against the car's oap-sdk into javascript/app.js.
 */
const fs = require('fs');
const path = require('path');
const screen = require('../src/screen_model.js');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package');
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'mgu-app.json'), 'utf8'));
const ID = app.id, VERSION = app.version;

/* fixed ids: an entry point's uuid must stay the same across versions */
const UUID = {
    application: '249b5930-9f47-4a3e-8b3e-4e16641a47b8',
    stringBundle: 'a2963b2b-782f-4e23-8c5d-b410e0468338',
    resourceBundle: '5ad93fd8-d821-4b54-93d8-3257ec544764',
    entryPoint: '93cebeec-9d60-4e8a-a040-61c1cd742014',
};

const LANGS = ['ar_AE', 'cs_CZ', 'da_DK', 'de_DE', 'el_GR', 'en_GB', 'en_US', 'es_ES', 'es_MX', 'fi_FI', 'fr_CA', 'fr_FR',
    'he_IL', 'hu_HU', 'id_ID', 'it_IT', 'ja_JP', 'ko_KR', 'nl_BE', 'nl_NL', 'no_NO', 'pl_PL', 'pt_BR', 'pt_PT', 'ro_RO',
    'ru_RU', 'sk_SK', 'sl_SI', 'sv_SE', 'th_TH', 'tr_TR', 'uk_UA', 'vi_VN', 'zh_CN', 'zh_TW', 'zh_yue_Hans_CN', 'zh_yue_Hant_CN'];
const STRINGS = { SID_LL_TITLE: 'Light Logger' };
const STATE = 'ST_OnlineApps_LightLog';

/* the one screen: title, status line, the buttons, then the text rows (screen_model.js) */
const ROWS = screen.BUTTONS.map((b) => [b.id, b.name, b.label]).concat(screen.LINE_IDS.map((l) => [l.id, l.name, '']));

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
        rows: [{ Text: { value: 'SID_LL_TITLE', type: 'StringId' } }] },
    20: { type: 'label', name: 'llStatus', properties: { Visible: { value: 1, type: 'UInt' }, Focusable: { value: 0, type: 'UInt' } },
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
        uuid: UUID.application, type: 'OnlineApp', name: ID, vendor: 'LightLog', version: VERSION, defaultLanguage: 'en_GB',
        uiDescriptions: [{ applicationFilePath: './uiDescriptions/ID8/application.xml',
            uiDescriptionFilePath: './uiDescriptions/ID8/uiDescription.json', hmi: ['ID8'] }],
        stringBundleUuid: UUID.stringBundle,
        resourceBundleUuid: UUID.resourceBundle,
        variantGroups: [{ stringsPath: './variantGroups/Common/texts', resourcesPath: './variantGroups/Common/images',
            hmi: ['ID8'], brands: ['BMW'] }],
        entryPoints: [{
            name: ID, uuid: UUID.entryPoint, textId: 'SID_LL_TITLE', icon: 'lightlog_icon.png',
            insertionStateId: 20974, insertionFocusId: 2, insertionMode: 'INSERT_BELOW', insertionOrder: 0,
            insertionPriority: 0, previewType: 'NONE', bookmarkable: true, private: null, appearance: 'DEFAULT',
            isGroupHeader: false, insertionGroup: 0,
        }],
    },
});
LANGS.forEach((l) => write(`rhmiData/variantGroups/Common/texts/${l}.json`, STRINGS));
fs.mkdirSync(path.join(PKG, 'rhmiData/variantGroups/Common/images'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'icon.png'), path.join(PKG, 'rhmiData/variantGroups/Common/images/lightlog_icon.png'));

/* ---- package.json, manifest.json, permissions.json, config ---- */
write('package.json', {
    name: ID, version: VERSION,
    description: 'Logs the interior light modules (seat logos included), the engine and the speed, read-only',
    private: false,
    main: 'javascript/runner.js',
    oapAppSettings: {
        maxDiskUsage: 5242880, cpuLimit: 20, memoryThresholdKB: 65536, priority: 'PRIO_MEDIUM', visibility: 'FOREGROUND',
        latencyClass: 'FOREGROUND', loggingId: 'LTLG', userLoginRequired: false, backgroundPriority: 150,
        someipManifest: 'manifest.json',
    },
    files: ['config', 'rhmiData', 'package.json', 'npm-shrinkwrap.json', 'permissions.json', 'javascript', 'manifest.json', 'LICENSE'],
    dependencies: { 'oap-sdk': '24.10.2' },
    engines: { node: '>=8.7.0' },
    author: 'LightLog',
    license: 'MIT',
    mguHmi: ['ID8'],
    /* MGU Store starts it with the head unit (without a screen until opened), so the welcome light is logged */
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
        /* the car: the head unit's diagnostic link (only ReadDataByIdentifier is ever sent, uds.js), the engine's
         * speed and the car's speed. BMW's installer refuses the whole app for one access the car's interface lacks:
         * these are the ones the MIT-licensed idrive7-apps kit's apps declare without making them optional */
        'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu': { instances: ['SystemFunctionsInternalTasuInst1'],
            methods: ['sendTasuRequest'], broadcasts: ['sendTasuResponse'] },
        'de.bmw.infotainment.vehicle.CDS': { instances: ['1'], attributes: { statusEngineSpeed2: 'rs' } },
        'de.bmw.infotainment.vehicle.Vehicle2': { instances: ['1'], attributes: { statusCarSpeed2: 'rs' } },
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
