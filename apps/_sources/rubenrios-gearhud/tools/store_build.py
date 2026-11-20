#!/usr/bin/env python3
"""Build for the MGU Store (mgu-repo.json): the app in Spanish, under its manifest's version.

    python3 tools/store_build.py <app id>     -> dist/<id>@<version>.tgz (and .mgu)

The Store runs this on the head unit (Python 3.12, Node 8 on PATH, no network) with the BMW oap-sdk
generated from a donor app in oap-sdk/. On a PC without the SDK, add --preview-only for an offline preview.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = dict(os.environ, MGU_KEEP_VERSION='1')
sys.exit(subprocess.call([sys.executable, os.path.join(ROOT, 'kit', 'tools', 'build.py'), '--language', 'es'] + sys.argv[1:],
                         cwd=ROOT, env=env))
