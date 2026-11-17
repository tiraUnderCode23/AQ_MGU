# MGU FSC Generator

Python CLI for generating application and ID7 Live map FSCs for FSC Patch.
Requires Python 3.10+. Our signing key is included and intentionally public.

## Setup

Run from this folder:

```
python -m pip install -r requirements.txt
```

## Usage

Show help or list available application IDs:

```
python fsc_generator.py
python fsc_generator.py list
```

Generate an application FSC or a North America Live map FSC:

```
python fsc_generator.py generate --vin AB12345 --app 017B
python fsc_generator.py generate --vin AB12345 --app 0156 --index FFFF
```

Verify a generated file:

```
python fsc_generator.py verify output/FSC_AB12345_017B0001.fsc
```

Use your VIN or its last seven characters.
Application IDs and upgrade indexes are hexadecimal; the default index is 0001.
Files go in `output/`. Use `--out` to change the folder or `--overwrite` to replace
an existing file.

The tool generates files only; installing them and enabling features are separate.
