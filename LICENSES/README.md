# Licensing

AQ_MGU has no single project-wide license. Each app, game, tool and source snapshot keeps the upstream license and applicable third-party notices. Use [`data/sources.json`](../data/sources.json) for the pinned repositories and their license summaries; use [`data/components.json`](../data/components.json) to map individual components to their source.

Only components with an explicit, compatible redistribution basis were included in the current branch feed or release catalog. Restrictive and unclear sources are documented in [`data/external-sources.json`](../data/external-sources.json). A summary is not a substitute for reading the actual license files in each `_sources` directory.

The CarPlay Map Producer is sourced from `isaakbruno2/carplay-map-cluster`; the bundled `cluster_render_client.js` retains its upstream SPDX header and the relevant cluster-render license is included in the package. Per-file upstream notices take precedence where they specify a different license.
