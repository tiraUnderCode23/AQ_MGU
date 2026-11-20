'use strict';
// SPDX-License-Identifier: GPL-3.0-or-later
// Removes the player's frame file (/dev/shm). Runs as the service's ExecStopPost (also after a crash or a kill) and
// as the tool's deactivate (an uninstall, before anything else goes). Never fails: a failing deactivate would refuse
// the removal. The account's token and the posters (/var/opt/clucraft-plex/state) go with the tool's folder.
try { require('fs').unlinkSync(require('./player').VIDEO_PATH); console.log('clucraft-plex: removed the frame file'); } catch (e) { /* none */ }
process.exit(0);
