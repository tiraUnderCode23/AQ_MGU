# Adding AQ_MGU to MGU Store

Reviewed on **19 November 2026**. The repository documents **140 distinct components**: **55 source entries**, **79 catalog packages**, and **6 tools supplied through an external native Store source**. The two AQ feeds contain **134 executable feed entries**. These are inventory and feed counts; installation success is recorded separately for each component. See the [component inventory](../data/components.json), [source descriptor](../mgu-repo.json), and [package catalog](../release/catalog.json).

## Add the three sources

Use an existing, compatible installation of the original MGU Store. Open its source settings and add the following sources, then refresh them:

| Configured source | Store source type | URL to enter | Content covered here |
|---|---|---|---|
| `aq-mgu-apps` | GitHub, `branch:main` | `https://github.com/tiraUnderCode23/AQ_MGU/tree/main` | `mgu-repo.json`: 55 source apps and branch-provided tools |
| `aq-mgu-catalog` | HTTPS | `https://raw.githubusercontent.com/tiraUnderCode23/AQ_MGU/main/release/catalog.json` | 79 catalog packages with exact sizes and SHA-256 values |
| `aq-mgu-iteriodev` | GitHub, `branch:main` | `https://github.com/IterioDev/car-apps/tree/main` | Original source for the six IterioDev helper tools |

The exact configuration is in [`data/store-sources.json`](../data/store-sources.json). The original Store does not allow two GitHub sources for the same repository, even when their channels differ. If one of these repositories is already configured, use or update its existing source. In particular, an existing `IterioDev/car-apps` source on `tags` should use **Branch main** for the tool trees described here. The AQ branch and AQ HTTPS catalog use different source types so both can be configured together. Store also rejects a `github.com/.../releases/download/...` URL entered directly in its Add source field; enter the catalog URL shown above instead. These public sources do not require a GitHub token merely to identify their public content. See the [original source reader](../tools/_sources/mgu-store/native/mgu-updater/js/sources.js) and [updater](../tools/_sources/mgu-store/native/mgu-updater/js/updater.js).

**Add the IterioDev source explicitly.** Original Store reads its configured sources; it does not recursively add other sources mentioned inside an AQ repository or catalog. Merely downloading `data/store-sources.json` does not register those sources. The file [`data/external-store-components.json`](../data/external-store-components.json) records metadata for `iteriodev-comfort`, `iteriodev-drplay`, `iteriodev-overlays`, `iteriodev-screencast`, `iteriodev-tailscale`, and `iteriodev-turnview`. It is reference metadata for dependency checks, not a Store package feed or a copy of those tool payloads.

The original IterioDev repository also lists apps whose original packages are already referenced by the AQ catalog. Store resolves components across its sources, so those repeated app listings do not add another twelve distinct components to this repository's 140-entry inventory. Branch content can change after the pinned metadata observation; verify the offered version and source when refreshing.

## Select a component and its dependencies

1. Check the component's declared `mguHmi`, version, dependencies, disk requirements, and original README in the [installation eligibility matrix](COMPONENT_README_INSTALL_MATRIX.md).
2. Confirm that the needed sources are enabled and refreshed before selecting Install. Store resolves explicit `requires` dependencies by component ID and minimum version, including dependencies supplied by the IterioDev source.
3. For a source build, allow the original Store build path to supply its declared tools. Python recipes add a Python-tool requirement, and `build.sdk` adds the deploy requirement used to supply the target's SDK. AQ_MGU does not contain BMW's proprietary OAP SDK.
4. For a component with `mguNeeds`, confirm that a compatible provider is already installed. A capability listed in the catalog alone does not cause Store to choose and install its provider automatically. The original resolver can preserve a compatible renderer already installed on the unit.
5. Read the resulting Store status after the operation. A completed download or source build is evidence for that stage; registration, a displayed tile where applicable, and the application's observed behavior establish later stages separately.

These dependency rules are defined by the [original Store parser and planner](../tools/_sources/mgu-store/native/mgu-updater/js/sources.js) and detailed in the [ID7/ID8 installation contract](ID7_ID8_STORE_INSTALL_20261119_AR.md). Use the original Store/deploy flow to handle package preparation and registration on the detected HMI family.

## ID7 and ID8 use different MainApp paths

Compatibility belongs to each application and tool. A renderer supporting both families does not establish that a dependent app supports ID8. The original deployment implementation detects the target family and prepares its package accordingly; changing a catalog label alone does not supply the missing interface resources or SDK behavior. The path contract below is documented in the [HMI review](ID7_ID8_STORE_INSTALL_20261119_AR.md) and [machine-readable profiles](../data/hmi-install-profiles.json).

| Item | ID7 | ID8 |
|---|---|---|
| MainApp root | `/usr/lib/oap-mainapp` | `/usr/lib/oap-mainapp21` |
| MainApp package directory | `/usr/lib/oap-mainapp/preinstalled_apps` | `/usr/lib/oap-mainapp21/preinstalled_apps` |
| Distinguishing HMI process | `HmiMain3D` | `Hmi8` |
| App interface resources | `rhmiData/uiDescriptions/ID7` | `rhmiData/uiDescriptions/ID8` |

App registration records follow `/var/opt/public/oap/oap_<manager_uid>/data/apps/<id>.json`, and an app's home follows `/var/opt/public/oap/oap_<uid>`. Read the UID from the matching target record. A donor path, UID, or applet ID from a historical AQ report is evidence for that particular unit and app, not a fixed allocation for every installation. The tables above describe paths managed by Store; they are not instructions to copy a package manually into a MainApp directory.

### When ID8 installation is queued

Original deploy can register directly when the running MainApp-21 supports that path. Otherwise, it queues the change for the unit's next start. The queue is under `/var/opt/mgu-deploy/id8/queue`, with `pending.json` and `last-apply.json` under `/var/opt/mgu-deploy/id8`. A status such as `pending_reboot` or `installs at the next start` means the operation is pending. Original deploy does not force a MainApp-21 restart to complete it. See the [original deploy implementation](../tools/_sources/mgu-store/deploy/unit/mgu-deploy.js) and [deployment README](../tools/_sources/mgu-store/deploy/README.md).

After the normal next start, confirm the application ID and version in the registration/status result, its assigned UID, the queue result, and its tile when the app declares one. Open the application and check its intended behavior and required helper services. An installed app that has not been opened can report `running=false`; that field alone is not an installation failure. Record a remaining pending condition or registration error as such.

## What has been verified

| Evidence | Result in this revision | Practical limit |
|---|---|---|
| Catalog package downloads | All **79** packages passed exact byte-size, SHA-256, and archive-structure checks | This does not prove target SDK compatibility, registration, or operation on a car |
| Artifact provenance | **78** catalog references point to original publishers; **1** is the existing AQ-built `carplay-map` package | The original publisher's bytes and licensing terms remain authoritative |
| Source parser | Original Store accepts **55** entries with none skipped | Accepted metadata does not imply a successful build |
| Selected source inputs | **54** entries have positive static evidence for the reviewed inputs; **1** has a known blocker | Counts cover source inputs, not peak build output, SDK extraction, or network assets |
| External helper tools | Metadata for **6** original IterioDev tools is recorded for dependency resolution | Their payloads must come through the separately configured native source |
| Live head-unit installation | **NOT OBSERVED** | No component in this review is assigned a new successful vehicle-installation result |

The known source-input blocker is the unchanged `noahg_fscpatcher` entry: it requests the whole repository, whose observed input size exceeds the original Store's default **200 MiB** build budget. Its presence in the inventory does not establish build readiness. The source audit also found that `sys_monitor` needs its original icon generator when no committed app icon is present; that helper is now included in its selected build inputs. See [source-build-readiness.json](../data/source-build-readiness.json) and the [icon-input regression checks](../tests/test_icon_build_inputs.py).

Package verification and origin evidence are recorded in [artifact-verification-20261119.json](../data/artifact-verification-20261119.json) and [catalog-provenance.json](../data/catalog-provenance.json). If Store reports a size or hash mismatch, compare the exact downloaded artifact with that evidence before changing metadata. A new upstream artifact, changed branch, or different target firmware needs its own verification. A source-fetch or build failure may also cause Store to retry the whole repository, so a successful input audit does not remove the need to read the actual build result.

## Repository layout

- `mgu-repo.json`: source-built apps and branch-provided tools.
- `release/catalog.json`: HTTPS catalog for original app/tool packages and the existing AQ-built package.
- `data/store-sources.json`: the three native Store source configurations to add explicitly.
- `data/external-store-components.json`: metadata-only observations of the six external helper tools.
- `apps/_sources/` and `tools/_sources/`: pinned upstream source snapshots.
- `docs/assets/apps/`: original app icons/screenshots copied from source repositories.
- `data/`: component inventory, upstream commits, artifact provenance, coverage and verification evidence.
