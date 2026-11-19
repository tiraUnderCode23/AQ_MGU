# mgu-inputgate: original notices and AQ packaging

AQ package **1.2.2** contains the publisher's **1.2.1** library, guard,
service units and HMI drop-in without any byte changes. This is a packaging
revision that adds notices, source provenance and the original Store-inferred
drop-in deployment requirement, not a new upstream release.
No library was compiled or executed to produce this AQ package.

## License scope stated by the original publisher

The complete upstream `kit/renderd/README.md` is included as
`UPSTREAM-RENDERD-README.md`. Its Licence section (original lines 235–242)
describes the general renderer directory as GPL-3.0-or-later, retains MIT
for parts of the earlier renderer, and explicitly identifies the
`inputgate/` controller gate as MIT and its vsomeip headers as MPL-2.0.
Those scopes are preserved; this package does not replace them with a
single blanket license.

- `LICENSE`: complete repository MIT license and copyright notices.
- `LICENSE.mgu-renderd`: complete MIT notice from the renderer directory.
- `LICENSE.renderd`: complete upstream GNU GPL version 3 license text.
- `MPL-2.0.txt`: complete Mozilla Public License version 2.0 text.
- `VSOMEIP-NOTICES.txt`: each included interface header's original
  copyright and MPL notice, with its source path. The source headers
  themselves remain unchanged in the public frozen source snapshot.

## Source availability

Publisher: https://github.com/cauliflowermossgrape/idrive7-apps

Pinned commit: `5555ef3bd2195aae15a8cec6803beeb40ca16456`.
The adjacent `SOURCE-PROVENANCE.json` provides all 33 selected upstream
paths, raw publisher URLs, byte counts, SHA-256 and Git blob SHA-1 hashes.
The same files are retained at
`tools/_sources/cauli-inputgate-1.2.1` in AQ_MGU. The snapshot includes
the gate source, public interface headers, original Makefile, licenses,
documentation and original published tool files. It is an inputgate
source selection, not a complete copy of the unrelated renderer.

## Original package behavior and evidence limit

The original component declares ID7 and ID8, no immediate restart, no
recmgr changes and no enabled-unit changes. Its manifest omits explicit
dependencies, but the original Store source parser requires `mgu-deploy`
>= 0.3.2 for tools with HMI drop-ins. AQ records that same inferred minimum
in the packaged manifest so it also accompanies the archive.
Original units and HMI drop-ins are retained, including their next-start
loading and health guard. No application or device behavior was changed
or verified here. Native Store archive assembly and content hashes are
checked offline; target loading, target ABI and live installation remain
**NOT OBSERVED**. The separate host-build experiment is not distributed.
