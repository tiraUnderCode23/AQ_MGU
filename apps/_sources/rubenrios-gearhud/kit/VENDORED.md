# Vendored kit

`kit/` is the app kit of [cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps)
(MIT, `kit/LICENSE`), taken from the Spanish localization branch
([rubenrios/idrive7-apps `es-localization`](https://github.com/rubenrios/idrive7-apps/tree/es-localization),
upstream PR #208) at commit `2a58a18`. The MGU Store builds the app on the head unit with it.

Only what the build and the app need is kept:

- `runtime/`, `platform/`, `tools/{build.py, pack_data.py, localize.py, locale-revisions.json, make_icon.js, oapgen/}`;
- `localization/fonts/es/` (the Spanish atlases) and `runtime/locales/es.*`;
- `tools/hu-stub.js` and `tools/preview.js`, for the tests and the PC preview only (not used by the Store build).

Taken out: the other languages' catalogs and fonts (`ru`, `ko`, `zh-CN`, the CJK atlas), the Fault Scanner's
diagnostic translations and everything else in the original `kit/`.

One change: `tools/localize.py` `package_version()` keeps the manifest's version when `MGU_KEEP_VERSION` is set,
so `tools/store_build.py` builds the Spanish package as `<id>@<version>.tgz`, the name and version the Store
expects, instead of `<id>@<version>-es.1.tgz`.
