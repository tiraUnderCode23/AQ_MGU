import contextlib
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import struct
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fsc_generator as fsc
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa, ec

STAMP = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)


class FormatTests(unittest.TestCase):
    def test_application_fields_use_standard_wire_format(self):
        expected = struct.pack(
            ">BBHH2s6sBB7sHB7sB9sBB12sB2s",
            5, 1, 0x017B, 1, b"  ", b"123456", 1, 32, b"7654321",
            0x07C4, 1, b"AB12345", 1, bytes(9), 4, 18,
            b"202611131200", 90, bytes(2),
        )
        self.assertEqual(fsc.build_header("AB12345", 0x017B, 1, STAMP), expected)

    def test_live_map_fields_use_extended_wire_format(self):
        expected = struct.pack(
            ">BBHH2s6sBB7s5sB7sB9sBB12sB2s",
            5, 1, 0x0156, 0xFFFF, b"  ", b"123456", 2, 32, b"7654321",
            b"99991", 1, b"AB12345", 1, bytes(9), 4, 18,
            b"202611131200", 90, bytes(2),
        )
        self.assertEqual(fsc.build_header("AB12345", 0x0156, 0xFFFF, STAMP), expected)

    def test_vin_full_and_last_seven_are_equivalent(self):
        self.assertEqual(fsc.normalize_vin(" wba0000000ab12345 "), "AB12345")
        self.assertEqual(fsc.build_header("WBA0000000AB12345", 0x173, 1, STAMP), fsc.build_header("ab12345", 0x173, 1, STAMP))

    def test_invalid_vins_are_refused(self):
        for vin in ("", "123456", "12345678", "ABC123I", "ABC123O", "ABC123Q", "AB 2345", "ＡＢ12345", "A!12345"):
            with self.subTest(vin=vin), self.assertRaises(ValueError):
                fsc.normalize_vin(vin)

    def test_invalid_ids_and_reserved_map_index_are_refused(self):
        for app, index in ((0, 1), (-1, 1), (65536, 1), (0x173, -1), (0x173, 65536), (0x173, 0xFFFF)):
            with self.subTest(app=app, index=index), self.assertRaises(ValueError):
                fsc.build_header("AB12345", app, index, STAMP)
        self.assertEqual(fsc.hex16(" 0x017b "), 0x017B)
        for value in ("", "-1", "10000", "0x", "12 34", "GGGG"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                fsc.hex16(value)

    def test_timestamp_and_identifier_validation(self):
        for stamp in (STAMP.replace(tzinfo=None), STAMP.replace(year=1999)):
            with self.assertRaises(ValueError):
                fsc.build_header("AB12345", 0x173, 1, stamp)
        offset_stamp = STAMP.astimezone(timezone(timedelta(hours=-8)))
        self.assertEqual(fsc.build_header("AB12345", 0x173, 1, offset_stamp), fsc.build_header("AB12345", 0x173, 1, STAMP))
        for kwargs in ({"generator_id": "short"}, {"generator_id": "12345é"}, {"order_id": "123456\n"}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                fsc.build_header("AB12345", 0x173, 1, STAMP, **kwargs)

    def test_component_protection_variants(self):
        self.assertEqual(fsc.build_header("AB12345", 0x1AA, 1, STAMP)[23:25], b"\x07\xc4")
        for index in (2, 3):
            self.assertEqual(fsc.build_header("AB12345", 0x1AA, index, STAMP)[23:25], b"\x1e\x78")


class SigningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(directory.cleanup)
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        key_path = Path(directory.name) / "test-signing-key.pem"
        key_path.write_bytes(key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ))
        cls.public_key = key.public_key()
        modulus = cls.public_key.public_numbers().n.to_bytes(256, "little")
        for name, value in [("DEFAULT_KEY", key_path),
                            ("PATCH_MODULUS_SHA256_LE", hashlib.sha256(modulus).hexdigest())]:
            fixture = patch.object(fsc, name, value)
            fixture.start()
            cls.addClassCleanup(fixture.stop)

    def test_every_preset_signs_and_verifies(self):
        for feature in fsc.FEATURES:
            with self.subTest(feature=feature.label):
                data, doc = fsc.generate("AB12345", feature.application_id, feature.upgrade_index, timestamp=STAMP)
                self.assertEqual(len(data), 319 if feature.upgrade_index == 0xFFFF else 316)
                self.assertEqual(fsc.verify_document(data, self.public_key), doc)
                self.assertEqual(doc.signature, "verified")
                self.assertEqual(doc.sha256, hashlib.sha256(data).hexdigest())

    def test_signed_header_and_signature_tampering_are_rejected(self):
        data, _ = fsc.generate("AB12345", 0x17B, timestamp=STAMP)
        for offset in (0, 20, 27, 45, 60, 200, len(data)-1):
            changed = bytearray(data)
            changed[offset] ^= 1
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                fsc.verify_document(bytes(changed), self.public_key)

    def test_invalid_or_replaced_bundled_keys_are_refused(self):
        keys = [rsa.generate_private_key(public_exponent=65537, key_size=1024),
                rsa.generate_private_key(public_exponent=3, key_size=2048),
                ec.generate_private_key(ec.SECP256R1()),
                rsa.generate_private_key(public_exponent=65537, key_size=2048)]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "replacement.pem"
            for key in keys:
                path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
                with self.subTest(key=type(key).__name__), patch.object(fsc, "DEFAULT_KEY", path), self.assertRaises(ValueError):
                    fsc.generate("AB12345", 0x17B)
        with patch.object(fsc, "DEFAULT_KEY", Path("missing-private-key.pem")), self.assertRaisesRegex(ValueError, "not found"):
            fsc.load_signing_key()

    def test_cli_rejects_removed_custom_key_options(self):
        for args in (["generate", "--vin", "AB12345", "--app", "017B", "--key", "other.pem"],
                     ["verify", "sample.fsc", "--key", "other.pem"],
                     ["export-public-key"]):
            with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                fsc.main(args)
            self.assertEqual(error.exception.code, 2)

    def test_output_roundtrip_duplicate_refusal_and_explicit_replacement(self):
        first, doc = fsc.generate("AB12345", 0x17B, timestamp=STAMP)
        second, _ = fsc.generate("AB12345", 0x17B, timestamp=STAMP + timedelta(minutes=1))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / doc.filename
            fsc.save_document(path, first)
            self.assertEqual(path.read_bytes(), first)
            with self.assertRaises(FileExistsError):
                fsc.save_document(path, second)
            self.assertEqual(path.read_bytes(), first)
            fsc.save_document(path, second, overwrite=True)
            self.assertEqual(path.read_bytes(), second)
            self.assertEqual(list(path.parent.glob(".fsc-*.tmp")), [])

    def test_invalid_signature_is_never_saved(self):
        data, doc = fsc.generate("AB12345", 0x17B, timestamp=STAMP)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / doc.filename
            with self.assertRaises(ValueError):
                fsc.save_document(path, data[:-1] + bytes([data[-1] ^ 1]))
            self.assertFalse(path.exists())

    def test_cli_generate_verify_and_duplicate(self):
        with tempfile.TemporaryDirectory() as directory:
            args = ["generate", "--vin", "AB12345", "--app", "0156", "--index", "FFFF", "--out", directory,
                    "--timestamp", "2026-11-13T12:00Z"]
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(fsc.main(args), 0)
            result = json.loads(output.getvalue())
            self.assertEqual(result["signature"], "verified")
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(fsc.main(["verify", result["file"]]), 0)
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(fsc.main(args), 1)


if __name__ == "__main__":
    unittest.main()
