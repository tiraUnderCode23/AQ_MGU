# Source and release audit

**Review date:** 2026-11-17  
**Included feed:** 36 apps, 1 game and 24 Store tools (61 installable components).

## Store format checked

MGU Store's publishing guide is [docs/PUBLISHING.md](https://github.com/robertnisipeanu/mgu-store/blob/main/docs/PUBLISHING.md), and its checked default source list is [deploy/sources.json](https://raw.githubusercontent.com/robertnisipeanu/mgu-store/main/deploy/sources.json). Store branch feeds read `mgu-repo.json`; release feeds use the GitHub release named `catalog` and its schema-2 `catalog.json`, with size and SHA-256 verified for each asset. AQ_MGU follows this split: branch source for in-repo app builds and a release catalog for prebuilt tools/apps.

## Upstream sources and versions

Every included repository is pinned to a full commit SHA in [`data/sources.json`](../data/sources.json). Release-only components retain their upstream catalog URL, asset URL and SHA-256 in [`data/catalog-provenance.json`](../data/catalog-provenance.json). The checked official catalogs were: `robertnisipeanu/mgu-store`, `robertnisipeanu/idrive-apps`, `JustAnotherPU/waze-hud`, `Vizualyse/idrive-apps` and `noth4m4d/mgu-hamadstools`. The Waze HUD and Vizualyse app source trees are also copied into `apps/_sources`; the Noth4m4d apps are delivered from their published release packages while their source repository snapshot is retained.

The live source head of `robertnisipeanu/idrive-apps` was refreshed during this review to commit `59140a978e3d5e2c8c183bdd2fbb9a4682be466a`. Upstream package assets were checked against their original byte size and SHA-256 before the AQ_MGU release catalog was written. The CarPlay Map Producer package uses the MGU Store artifact packer and current `cluster_render_client.js` from the pinned iDrive Apps source.

## Licensing and exclusions

The current feed includes projects with explicit licenses and preserves their upstream notices, including MIT, GPL, MPL, Unlicense and per-component mixed licensing. Components without clear permission are not redistributed. The current exclusions and reasons are listed in [`data/external-sources.json`](../data/external-sources.json), including PolyForm Strict/Noncommercial sources and repositories without an applicable license. The BMW OAP SDK and private vehicle credentials/data are not included.

The source project `isaakbruno2/carplay-map-cluster` describes its producer/app as MPL-2.0 and refers to the cluster-render client as GPL-3.0-or-later, while the bundled current client's file header declares `SPDX-License-Identifier: MPL-2.0`. The source copy and file-level notices are preserved; review the relevant upstream license files for a definitive interpretation.

## Discovery scope and limits

The review checked the MGU Store default sources, the connected GitHub account's repository list and MGU-related paths, 20 candidate repositories, and public GitLab searches. No additional eligible Store source was identified in the account scan or the GitLab search. This was a bounded, best-effort audit; repositories can be unindexed, private, newly published or discoverable only through community channels. AQ_MGU does not claim exhaustive Internet coverage.

The source code and release packages were not executed against a vehicle. Store parser compatibility, catalog structure, package checksums and local source paths are validated separately before publication.
