#!/usr/bin/env python3
"""Builds src/core/bmwdata/dictionary.ts from the word lists here (German<TAB>English per line,
German in lower case, ä/ö/ü/ß spelt ae/oe/ue/ss; '=ART' marks an article; later files win)."""
import glob, os
here = os.path.dirname(os.path.abspath(__file__))
words = {}
for f in sorted(glob.glob(os.path.join(here, '*.txt'))):
    for line in open(f, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line or line.startswith('#') or '\t' not in line:
            continue
        de, en = line.split('\t', 1)
        words[de.strip().lower()] = en.strip()
body = '\n'.join(f'{k}\t{v}' for k, v in sorted(words.items()))
assert '`' not in body and '${' not in body
out = os.path.join(here, '..', '..', 'src', 'core', 'bmwdata', 'dictionary.ts')
with open(out, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('// German → English dictionary for translate.ts: one "german<TAB>english" per line, the German\n'
             '// in lower case with ä/ö/ü/ß spelt ae/oe/ue/ss. \'=ART\' marks an article. Generated from the\n'
             '// word lists in tools/dictionary/*.txt: edit those and run tools/dictionary/build.py.\n'
             'export const DE_EN = `\n' + body + '\n`\n')
print(len(words), 'words ->', os.path.relpath(out))
