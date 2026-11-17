# Adding AQ_MGU to MGU Store

1. Open MGU Store source settings.
2. Add `https://github.com/tiraUnderCode23/AQ_MGU/tree/main` as a GitHub branch source. This serves `mgu-repo.json` and its 40 source-build components.
3. Add `https://raw.githubusercontent.com/tiraUnderCode23/AQ_MGU/main/release/catalog.json` as a separate **HTTPS** source. This serves the 21 published `.tgz` packages and their verified artifact URLs.
4. Refresh sources. The original Store does **not** allow two GitHub sources for the same repository, even when their channels differ. It also rejects a `github.com/.../releases/download/...` URL when entered directly in its Add source field. The two URLs above use the accepted source types without requiring a GitHub token for public content.
5. Check each component's HMI compatibility, minimum dependencies, available disk space, and its original README before selecting any install. Treat a successful download separately from completed installation and unit status verification. Do not install every component automatically; some provide diagnostic, coding, or security-sensitive operations and require specific vehicle conditions and authorization.

The exact source entries are in [`data/store-sources.json`](../data/store-sources.json). The branch and HTTPS catalog feeds intentionally use different source types so Store can build source packages and fetch checksum-verified packages in the format it already supports.

## Repository layout

- `mgu-repo.json`: source-built apps and branch-provided tools.
- `release/catalog.json`: release channel index for prebuilt app/tool packages.
- `apps/_sources/` and `tools/_sources/`: pinned upstream source snapshots.
- `docs/assets/apps/`: original app icons/screenshots copied from source repositories.
- `data/`: component inventory, upstream commits, release provenance and excluded sources.

Some upstream apps require an OAP SDK donor or compatible renderer/tool already available on the vehicle. AQ_MGU does not contain BMW's proprietary OAP SDK. Read each upstream app's instructions before installing it.
