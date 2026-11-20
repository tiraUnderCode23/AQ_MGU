"""Read-only reader for EDIABAS .prg/.grp tables (layout as in EdiabasLib).
Usage: python3 -I tools/sgbd_tables.py FILE [TABLE ...]  -> JSON on stdout.
Only decodes the table section; jobs are not executed or disassembled."""
import json, struct, sys

KEY = 0xF7


def dec(b):
    return bytes(x ^ KEY for x in b)


def read_tables(path):
    data = open(path, 'rb').read()
    off = struct.unpack_from('<i', data, 0x84)[0]
    count = struct.unpack_from('<i', dec(data[off:off + 4]))[0]
    pos = off + 4
    tables = {}
    for _ in range(count):
        h = dec(data[pos:pos + 0x50])
        pos += 0x50
        name = h[:0x40].split(b'\0')[0].decode('latin-1')
        col_off = struct.unpack_from('<i', h, 0x40)[0]
        col_cnt, row_cnt = struct.unpack_from('<ii', h, 0x48)
        p = col_off
        rows = []
        for _r in range(row_cnt + 1):
            row = []
            for _c in range(col_cnt):
                s = bytearray()
                while True:
                    ch = data[p] ^ KEY
                    p += 1
                    if ch == 0:
                        break
                    s.append(ch)
                row.append(s.decode('latin-1'))
            rows.append(row)
        tables[name] = {'columns': rows[0], 'rows': rows[1:]}
    return tables


if __name__ == '__main__':
    t = read_tables(sys.argv[1])
    want = sys.argv[2:]
    if not want:
        print(json.dumps({k: len(v['rows']) for k, v in t.items()}, indent=0))
    else:
        print(json.dumps({k: t[k] for k in want if k in t}, indent=1, ensure_ascii=False))
