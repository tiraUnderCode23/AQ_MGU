"""Coordinate resumable AQ_MGU repository work; state stays in the local Git directory."""
import argparse
import contextlib
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

def utcnow():
    return dt.datetime.now(dt.timezone.utc)

def state_dir():
    value = subprocess.check_output(["git", "rev-parse", "--git-common-dir"], text=True).strip()
    root = Path(value).resolve() / "aq_mgu_goal"
    root.mkdir(parents=True, exist_ok=True)
    return root

@contextlib.contextmanager
def guard(root):
    with (root / "guard.lock").open("a+b") as stream:
        stream.seek(0, 2)
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        deadline = time.monotonic() + 5
        while True:
            stream.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except (OSError, BlockingIOError):
                if time.monotonic() >= deadline:
                    raise RuntimeError("Another checkpoint operation is active")
                time.sleep(0.05)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

def read_state(root):
    path = root / "state.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"schema": 1, "goal": "AQ_MGU_COMPLETE_CATALOG_AND_VERIFIED_ID8", "status": "READY", "revision": 0}

def save_state(root, value):
    value["revision"] = value.get("revision", 0) + 1
    value["updated_utc"] = utcnow().isoformat()
    temp = root / ("state-" + uuid.uuid4().hex + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, root / "state.json")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["status", "acquire", "heartbeat", "release"])
    parser.add_argument("--owner")
    parser.add_argument("--token")
    parser.add_argument("--ttl-minutes", type=int, default=120)
    parser.add_argument("--status", choices=["READY", "IN_PROGRESS", "BLOCKED", "COMPLETE"], default="READY")
    parser.add_argument("--note")
    parser.add_argument("--next-step")
    args = parser.parse_args()
    if not 5 <= args.ttl_minutes <= 240:
        parser.error("TTL must be 5..240 minutes")
    root = state_dir()
    with guard(root):
        state = read_state(root)
        now = utcnow()
        lease = state.get("lease")
        active = bool(lease and dt.datetime.fromisoformat(lease["expires_utc"]) > now)
        code = 0
        if args.action == "acquire":
            if not args.owner:
                parser.error("--owner is required")
            if state["status"] == "COMPLETE":
                code = 4
            elif active:
                code = 3
            else:
                state["lease"] = {
                    "owner": args.owner, "token": uuid.uuid4().hex,
                    "acquired_utc": now.isoformat(),
                    "expires_utc": (now + dt.timedelta(minutes=args.ttl_minutes)).isoformat(),
                }
                state["status"] = "IN_PROGRESS"
                save_state(root, state)
        elif args.action in ("heartbeat", "release"):
            if not lease or not args.token or lease.get("token") != args.token:
                raise RuntimeError("Lease token does not match; nothing changed")
            if not active:
                raise RuntimeError("Lease expired; reacquire before changing state")
            if args.note is not None:
                state["note"] = args.note
            if args.next_step is not None:
                state["next_step"] = args.next_step
            if args.action == "heartbeat":
                state["lease"]["expires_utc"] = (now + dt.timedelta(minutes=args.ttl_minutes)).isoformat()
            else:
                state["lease"] = None
                state["status"] = args.status
            save_state(root, state)
        print(json.dumps({"state_path": str(root / "state.json"), "lease_active": active if args.action == "status" else bool(state.get("lease")), "state": state}, ensure_ascii=False))
        return code

if __name__ == "__main__":
    sys.exit(main())

