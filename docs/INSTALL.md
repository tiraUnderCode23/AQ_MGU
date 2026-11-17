# Adding AQ_MGU to MGU Store

1. Open MGU Store source settings.
2. Add the GitHub repository `tiraUnderCode23/AQ_MGU` with channel `branch`. This feed serves `mgu-repo.json`.
3. Add the same repository again with channel `releases`. This feed reads the release named `catalog` and its binary package assets.
4. Refresh sources. Apps and tools will appear from the two feeds; install only components compatible with the vehicle's MGU generation and software.

The exact source entries are in [`data/store-sources.json`](../data/store-sources.json). The branch and release feeds intentionally use different channel modes so Store can build source packages and fetch checksum-verified packages in the format it already supports.

## Repository layout

- `mgu-repo.json`: source-built apps and branch-provided tools.
- `release/catalog.json`: release channel index for prebuilt app/tool packages.
- `apps/_sources/` and `tools/_sources/`: pinned upstream source snapshots.
- `docs/assets/apps/`: original app icons/screenshots copied from source repositories.
- `data/`: component inventory, upstream commits, release provenance and excluded sources.

Some upstream apps require an OAP SDK donor or compatible renderer/tool already available on the vehicle. AQ_MGU does not contain BMW's proprietary OAP SDK. Read each upstream app's instructions before installing it.
