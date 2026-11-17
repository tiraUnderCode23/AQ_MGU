from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

VERSION = "1.3.0"
HERE = Path(__file__).resolve().parent
DEFAULT_KEY = HERE / "data" / "signing_key.pem"
PATCH_MODULUS_SHA256_LE = "d4f1ebaece4e4dbc1536a28eaa15b6b9f80f50213bd485ba01495fb2c6c469e0"
VIN_RE = re.compile(r"[A-HJ-NPR-Z0-9]+\Z", re.ASCII)
LIVE_MAPS = {
    0x0155: "Europe Live", 0x0156: "North America Live",
    0x0157: "North Africa Live", 0x0158: "South America Live",
    0x0159: "Israel Live", 0x015A: "South Africa Live",
    0x015B: "South East Asia Live", 0x015C: "Turkey Live",
    0x015D: "Japan Live", 0x015E: "India Live",
    0x015F: "Argentina Live", 0x0160: "Taiwan Live",
    0x0161: "China Live", 0x0162: "Korea Live",
    0x0169: "Africa / Middle East Live", 0x016C: "Australia / New Zealand Live",
}


@dataclass(frozen=True)
class Feature:
    name: str
    application_id: int
    upgrade_index: int = 1
    group: str = "Applications"

    @property
    def label(self) -> str:
        return f"{self.name}  [{self.application_id:04X}{self.upgrade_index:04X}]"


FEATURES = (
    Feature("Apple CarPlay", 0x017B),
    Feature("Android Auto", 0x01CA),
    Feature("Navigation Professional - Rest of World", 0x0173),
    Feature("Navigation Professional - Asia", 0x0172),
    Feature("Navigation Business - Rest of World", 0x0191),
    Feature("Navigation Business - Asia", 0x0190),
    Feature("Speech - Rest of World", 0x017D),
    Feature("Speech - China", 0x017E),
    Feature("Speech Global", 0x01CC),
    Feature("Touch Command", 0x0171),
    Feature("SiriusXM connected", 0x01BE),
    Feature("A4A", 0x017A),
    Feature("Component protection", 0x01AA),
    Feature("Component protection - variant 2", 0x01AA, 2),
    Feature("Component protection - variant 3", 0x01AA, 3),
    Feature("Diagnostic log and trace - external", 0x0176),
    Feature("Diagnostic log and trace - internal", 0x0177),
    Feature("RAM diagnostic log and trace", 0x0179),
) + tuple(Feature(name, app, 0xFFFF, "ID7 Live maps") for app, name in LIVE_MAPS.items())


@dataclass(frozen=True)
class Document:
    application_id: int
    upgrade_index: int
    vin7: str
    timestamp_utc: str
    layout: str
    signed_length: int
    generator_id: str
    order_id: str
    sha256: str
    signature: str = "not checked"

    @property
    def filename(self) -> str:
        return f"FSC_{self.vin7}_{self.application_id:04X}{self.upgrade_index:04X}.fsc"


def normalize_vin(value: str) -> str:
    vin = value.strip().upper()
    if len(vin) not in (7, 17) or not VIN_RE.fullmatch(vin):
        raise ValueError("Enter a 17-character VIN or its last 7 characters. I, O and Q are not VIN letters.")
    return vin[-7:]


def hex16(value: str) -> int:
    text = value.strip()
    if text.lower().startswith("0x"):
        text = text[2:]
    if not re.fullmatch(r"[0-9a-fA-F]{1,4}", text):
        raise ValueError("Use 1 to 4 hexadecimal digits, such as 017B or 0001.")
    return int(text, 16)


def _ascii(value: str, length: int, label: str) -> bytes:
    if len(value) != length or any(ord(char) < 32 or ord(char) > 126 for char in value):
        raise ValueError(f"{label} must contain exactly {length} printable ASCII characters.")
    return value.encode("ascii")


def load_signing_key() -> rsa.RSAPrivateKey:
    try:
        key = serialization.load_pem_private_key(DEFAULT_KEY.read_bytes(), password=None)
    except FileNotFoundError as error:
        raise ValueError("Bundled signing key not found. Restore data/signing_key.pem.") from error
    except (ValueError, TypeError) as error:
        raise ValueError("The signing key must be an unencrypted RSA PEM private key.") from error
    if not isinstance(key, rsa.RSAPrivateKey) or key.key_size != 2048:
        raise ValueError("Use an RSA-2048 signing key.")
    if key.public_key().public_numbers().e != 65537:
        raise ValueError("Use an RSA-2048 key with public exponent 65537.")
    modulus = key.public_key().public_numbers().n.to_bytes(256, "little")
    if hashlib.sha256(modulus).hexdigest() != PATCH_MODULUS_SHA256_LE:
        raise ValueError("The bundled signing key does not match FSC Patch.")
    return key


def build_header(vin: str, application_id: int, upgrade_index: int = 1,
                 timestamp: datetime | None = None, generator_id: str = "123456",
                 order_id: str = "7654321") -> bytes:
    vin7 = normalize_vin(vin)
    if not isinstance(application_id, int) or not 1 <= application_id <= 0xFFFF:
        raise ValueError("Application ID must be between 0001 and FFFF.")
    if not isinstance(upgrade_index, int) or not 0 <= upgrade_index <= 0xFFFF:
        raise ValueError("Upgrade index must be between 0000 and FFFF.")
    is_map = upgrade_index == 0xFFFF
    if is_map and application_id not in LIVE_MAPS:
        raise ValueError("FFFF is reserved here for the supported ID7 Live map application IDs.")
    timestamp = timestamp or datetime.now(timezone.utc)
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("Timestamp must include a timezone.")
    timestamp = timestamp.astimezone(timezone.utc)
    if not 2000 <= timestamp.year <= 9999:
        raise ValueError("FSC timestamps must be in the years 2000 through 9999.")
    header = bytearray(63 if is_map else 60)
    header[:2] = b"\x05\x01"
    header[2:4] = application_id.to_bytes(2, "big")
    header[4:6] = upgrade_index.to_bytes(2, "big")
    header[6:8] = b"  "
    header[8:14] = _ascii(generator_id, 6, "Generator ID")
    header[14:16] = b"\x02 " if is_map else b"\x01 "
    header[16:23] = _ascii(order_id, 7, "Order ID")
    if is_map:
        header[23:29] = b"99991\x01"
    else:
        header[23:26] = b"\x1e\x78\x01" if application_id == 0x01AA and upgrade_index in (2, 3) else b"\x07\xc4\x01"
    vin_offset, stamp_offset = (29, 48) if is_map else (26, 45)
    header[vin_offset:vin_offset+7] = vin7.encode("ascii")
    header[vin_offset+7] = 1
    header[stamp_offset-2:stamp_offset] = b"\x04\x12"
    header[stamp_offset:stamp_offset+12] = timestamp.strftime("%Y%m%d%H%M").encode("ascii")
    header[stamp_offset+12:stamp_offset+15] = b"Z\x00\x00"
    return bytes(header)


def parse_document(data: bytes) -> Document:
    """Parse supported generated layouts without claiming a signature is valid."""
    if len(data) not in (316, 319):
        raise ValueError("Expected a 316-byte application or 319-byte extended-map FSC.")
    is_map = len(data) == 319
    signed_length = len(data)-256
    vin_offset, stamp_offset = (29, 48) if is_map else (26, 45)
    if data[:2] != b"\x05\x01" or data[6:8] != b"  ":
        raise ValueError("Unsupported FSC header.")
    if data[14:16] != (b"\x02 " if is_map else b"\x01 ") or data[vin_offset-1] != 1 or data[vin_offset+7] != 1:
        raise ValueError("Unsupported FSC identifier layout.")
    if any(data[vin_offset+8:stamp_offset-2]) or data[stamp_offset-2:stamp_offset] != b"\x04\x12" or data[stamp_offset+12:stamp_offset+15] != b"Z\x00\x00":
        raise ValueError("Unsupported FSC validity layout.")
    if is_map and any(b < 32 or b > 126 for b in data[23:28]):
        raise ValueError("Invalid extended-map identifier.")
    generator_id = _ascii(data[8:14].decode("ascii"), 6, "Generator ID").decode("ascii")
    order_id = _ascii(data[16:23].decode("ascii"), 7, "Order ID").decode("ascii")
    vin7 = normalize_vin(data[vin_offset:vin_offset+7].decode("ascii"))
    stamp = datetime.strptime(data[stamp_offset:stamp_offset+12].decode("ascii"), "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
    app = int.from_bytes(data[2:4], "big")
    upgrade = int.from_bytes(data[4:6], "big")
    # Reconstruct the format to check every signed byte, not only key offsets.
    expected = build_header(vin7, app, upgrade, stamp, generator_id, order_id)
    if not data[:signed_length] == expected:
        raise ValueError("FSC fields do not match a supported generated layout.")
    return Document(app, upgrade, vin7, stamp.isoformat(), "ID7 Live map" if is_map else "Application", signed_length,
                    generator_id, order_id, hashlib.sha256(data).hexdigest())


def verify_document(data: bytes, public_key: rsa.RSAPublicKey) -> Document:
    document = parse_document(data)
    try:
        public_key.verify(data[document.signed_length:], data[:document.signed_length], padding.PKCS1v15(), hashes.SHA256())
    except InvalidSignature as error:
        raise ValueError("The FSC signature does not verify with the selected public key.") from error
    return Document(**{**asdict(document), "signature": "verified"})


def generate(vin: str, application_id: int, upgrade_index: int = 1, *,
             timestamp: datetime | None = None,
             generator_id: str = "123456", order_id: str = "7654321") -> tuple[bytes, Document]:
    key = load_signing_key()
    header = build_header(vin, application_id, upgrade_index, timestamp, generator_id, order_id)
    data = header + key.sign(header, padding.PKCS1v15(), hashes.SHA256())
    return data, verify_document(data, key.public_key())


def save_document(path: Path, data: bytes, *, overwrite: bool = False) -> Document:
    """Verify first and after readback; refuse an existing file by default."""
    key = load_signing_key()
    verified = verify_document(data, key.public_key())
    path = Path(path).expanduser().absolute()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("Choose a regular output file, not a symbolic link.")
    if overwrite:
        descriptor, temporary = tempfile.mkstemp(prefix=".fsc-", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            if Path(temporary).read_bytes() != data:
                raise OSError("FSC readback verification failed.")
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)
        readback = path.read_bytes()
        verify_document(readback, key.public_key())
        if readback != data:
            raise OSError("FSC readback verification failed.")
    else:
        created = False
        try:
            with path.open("xb") as output:
                created = True
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            readback = path.read_bytes()
            verify_document(readback, key.public_key())
            if readback != data:
                raise OSError("FSC readback verification failed.")
        except Exception:
            if created:
                path.unlink(missing_ok=True)
            raise
    return verified


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate verified FSCs for an MGU head unit using FSC Patch.")
    parser.add_argument("--version", action="version", version=VERSION)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("list", help="List the included application and map presets")
    create = sub.add_parser("generate", help="Generate and verify one FSC")
    create.add_argument("--vin", required=True, help="Full VIN or last 7")
    create.add_argument("--app", required=True, help="Application ID in hex, e.g. 017B")
    create.add_argument("--index", default="0001", help="Upgrade index in hex; FFFF for Live maps")
    create.add_argument("--out", type=Path, default=HERE / "output", help="Output directory")
    create.add_argument("--timestamp", help="UTC timestamp, YYYY-MM-DDTHH:MMZ")
    create.add_argument("--generator-id", default="123456")
    create.add_argument("--order-id", default="7654321")
    create.add_argument("--overwrite", action="store_true")
    inspect = sub.add_parser("verify", help="Verify a generated FSC using the FSC Patch key")
    inspect.add_argument("file", type=Path)
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        parser.print_help()
        return 0
    args = parser.parse_args(argv)
    try:
        if args.action == "list":
            for feature in FEATURES:
                print(f"{feature.application_id:04X} {feature.upgrade_index:04X}  {feature.group}: {feature.name}")
            return 0
        if args.action == "verify":
            doc = verify_document(args.file.read_bytes(), load_signing_key().public_key())
            print(json.dumps(asdict(doc), indent=2))
            return 0
        stamp = datetime.strptime(args.timestamp, "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc) if args.timestamp else None
        data, document = generate(args.vin, hex16(args.app), hex16(args.index), timestamp=stamp, generator_id=args.generator_id, order_id=args.order_id)
        output = args.out / document.filename
        save_document(output, data, overwrite=args.overwrite)
        print(json.dumps({"file": str(output.resolve()), **asdict(document)}, indent=2))
        return 0
    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
