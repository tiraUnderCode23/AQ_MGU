# AQ Lights 4.6.2 — standalone UI component

This directory is an independently authored, offline-testable UI helper for the AQ Lights application. It covers visible-list geometry, row selection, rotary-control press edge handling, and a gated touch callback. It contains **no ECU write commands, OEM payloads, extracted Android APK contents, credentials, or deployable MGU package**.

The original packaged AQ Lights app is not present as source in this repository's published catalog. Its local package metadata reports `UNLICENSED`; the owner must establish the source redistribution rights and verify the original build/installation contract before publishing a new application artifact.

## Files

- `javascript/ui_interaction.js` — pure UI/state, input deduplication and positive diagnostic-discovery reply filtering.
- `test/ui_interaction.test.js` — Node standard-library offline fixtures with no head-unit access.

Run offline tests from this folder:

```sh
npm test
```

This directory is a **reviewable UI component**, not a released app or a tested repair of KOMBI/FLM/BDC fault behavior. A proper app update must verify touch-capable renderer integration, ID7/ID8 compatibility, application lifecycle and response correlation, then build and publish a signed/verified artifact through the original deployment workflow. Existing DTCs and vehicle warnings must remain visible during fault diagnosis.