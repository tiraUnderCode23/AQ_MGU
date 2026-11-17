# AQ_MGU release catalog

The GitHub Release tag `catalog` publishes [`catalog.json`](catalog.json) and 21 verified MGU Store package assets (19 tools and 2 apps). Package filenames, byte sizes, SHA-256 values and rehosted URLs are in the catalog; upstream provenance is in [`data/catalog-provenance.json`](../data/catalog-provenance.json).

The catalog is schema 2. The Store's `releases` channel reads this named release and verifies every package against its listed size and SHA-256. Binary packages are intentionally release assets, not Git objects. The release assets were downloaded from their publishers' catalogs and checked against upstream checksums before rehosting; the CarPlay Map Producer package was built with MGU Store's own `deploy/hu artifact` packer from the pinned source and the current cluster-render client file.
