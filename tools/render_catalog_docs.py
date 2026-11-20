import json
import os
import re
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_json(rel):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


def save_json(rel, obj):
    (ROOT / rel).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def rebuild_matrix():
    mgu = load_json("mgu-repo.json")["components"]
    rel = load_json("release/catalog.json")["components"]
    ext = load_json("data/external-store-components.json")["components"]
    inv = {c["id"]: c for c in load_json("data/components.json")["components"]}

    # Keep a live observation only for the same exact component version.
    doc_path = ROOT / "docs/COMPONENT_README_INSTALL_MATRIX.md"
    old_status = {}
    if doc_path.is_file():
        for line in doc_path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"^\| `([^@`]+)@([^`]+)` \|", line)
            if m:
                cells = [c.strip() for c in line.split("|")[1:-1]]
                if len(cells) >= 6:
                    old_status[m.groups()] = cells[5]

    rows = []
    for src_type, lst in (("source", mgu), ("release", rel), ("external", ext)):
        for c in lst:
            cid = c["id"]
            kind = c["kind"]
            ver = c["version"]
            meta = inv[cid]
            if src_type == "source":
                if c.get("build") == "unit":
                    delivery = f"{kind} / branch source (unit linker)"
                elif isinstance(c.get("build"), dict):
                    delivery = f"{kind} / branch source (scripted build)"
                else:
                    delivery = f"{kind} / branch source (native component)"
            elif src_type == "release":
                sz = c["artifact"]["size"]
                extra = ", unit linker" if c.get("build") == "unit" else ""
                delivery = f"{kind} / original publisher artifact ({sz:,} compressed bytes{extra})"
            else:
                delivery = f"{kind} / external original source (IterioDev/car-apps)"

            hmi = "/".join(c.get("mguHmi") or []) or "Not declared"
            reqs = "; ".join(f"{k}>={v}" for k, v in sorted((c.get("requires") or {}).items())) or "None declared"
            ur = meta.get("upstream_readme") or ""
            if ur.startswith("https://"):
                readme_link = f"[README]({ur})"
            elif ur:
                # Relative to docs/
                if not (ROOT / ur).is_file():
                    raise FileNotFoundError(f"Original README missing for {cid}: {ur}")
                readme_link = f"[README](../{ur})"
            else:
                raise ValueError(f"Original README reference missing for {cid}")
            status = old_status.get((cid, ver)) or meta.get("live_install_status") or "NOT OBSERVED"
            rows.append((cid, f"| `{cid}@{ver}` | {delivery} | {hmi} | {reqs} | {readme_link} | {status} |"))

    rows.sort(key=lambda x: x[0])
    out = [
        "# AQ_MGU Component README & Install Matrix",
        "",
        "Reference matrix linking every component in `mgu-repo.json`, `release/catalog.json`, and `data/external-store-components.json` to its exact version, HMI target, minimum dependency floor, and original README.",
        "",
        "> Note: This document is an offline feed metadata index — it is not a live install result (`NOT OBSERVED` on physical HU unless explicitly verified).",
        "",
        "| Component | Delivery | HMI | Minimum requires | Original README | Live HU status |",
        "|---|---|---|---|---|---|",
    ] + [r[1] for r in rows] + [""]
    doc_path.write_text("\n".join(out), encoding="utf-8", newline="\n")
    print(f"Matrix written: {len(rows)} rows")


CATEGORIES = [
    ("Cluster & HUD", ["cluster", "hud", "mtrack", "apex_dash", "twin_dial", "idv7lol", "esagono", "shiftlight", "redline", "gearhud", "waze", "carplay", "nav_card", "eta", "carlink"]),
    ("Performance & Motorsport", ["draggy", "launch", "dyno", "brake", "gforce", "true_time", "track", "sideways", "mdrive", "flap", "live_adjust", "liveadjust", "bm3", "e85", "ethanol", "flex", "enginesound", "zf8hp", "xdrive", "ride_height", "xtraboost"]),
    ("Diagnostics & Telemetry", ["vital", "live_data", "cardash", "motordaten", "gauges", "boostline", "telemetry", "c365_drive", "ahg_", "dpf", "dtc", "carwatch", "osa", "service", "carcare", "warmup", "warm", "tires", "battery", "start_stop", "health", "pass", "edrive", "hybrid", "engine_care", "spritmonitor", "trip", "drivelog", "coding", "network", "diag"]),
    ("Media, Video & Casting", ["youtube", "ridetube", "video", "browser", "chromium", "iptv", "tvh", "emby", "jellyfin", "plex", "music", "spotify", "lyrics", "equalizer", "airplay", "cast", "base_player", "moonlight", "moonride", "steam"]),
    ("Lighting, Cameras & Comfort", ["ambient", "light", "flasher", "camera", "dashcam", "driverecorder", "bimmervision", "turnview", "sideview", "parking", "kaluga", "green_light", "seat", "wheel", "rear_comfort", "hass", "home", "overlays"]),
    ("Utilities & System", ["tailscale", "link", "hotspot", "terminal", "fsc", "obd", "driver_profiles", "gif_home", "copilot", "storage", "sysmon", "sys_monitor", "ridewatch"]),
    ("Games", ["doom", "tetris", "backgammon", "blocks", "arcade", "games", "doodle", "hopper", "gamestation", "chase", "blackjack", "lap_record", "sevens", "pinball", "pit_wall", "ridge_duel", "snake", "solitaire", "siege", "defender"]),
]


def classify_app(cid: str, category=None) -> str:
    if category == "game":
        return "Games"
    low = cid.lower()
    for cat, kws in CATEGORIES:
        if any(k in low for k in kws):
            return cat
    return "Utilities & System"


def rebuild_readme():
    comp_doc = load_json("data/components.json")
    app_imgs = load_json("data/app-images.json")
    settings = load_json("data/store-sources.json")

    apps = [c for c in comp_doc["components"] if c["kind"] == "app"]
    tools = [c for c in comp_doc["components"] if c["kind"] == "tool"]
    id8_apps = [a for a in apps if "ID8" in (a.get("supported_hmi") or [])]

    by_cat = {cat: [] for cat, _ in CATEGORIES}
    for a in sorted(apps, key=lambda x: (x.get("title") or x["id"]).lower()):
        by_cat[classify_app(a["id"], a.get("category"))].append(a)

    # Update app-images-summary.json
    with_imgs = sum(1 for a in apps if (app_imgs.get(a["id"], {}).get("images") or []))
    tot_imgs = sum(len((app_imgs.get(a["id"], {}).get("images") or [])) for a in apps)
    save_json("data/app-images-summary.json", {
        "total_apps": len(apps),
        "apps_with_icon": sum(1 for a in apps if app_imgs.get(a["id"], {}).get("icon")),
        "apps_with_screenshots": with_imgs,
        "total_screenshots": tot_imgs,
    })

    lines = [
        '<div align="center">',
        "",
        "# AQ MGU — BMW iDrive 7 & 8 App Store",
        "",
        f'![Apps](https://img.shields.io/badge/Apps-{len(apps)}-0066B1?style=for-the-badge) '
        f'![iDrive 8](https://img.shields.io/badge/iDrive_8_Declared-{len(id8_apps)}-1C69D4?style=for-the-badge) '
        f'![Helper Tools](https://img.shields.io/badge/Helper_Tools-{len(tools)}-2B3137?style=for-the-badge)',
        "",
        "**Branches:** [`main` — All & iDrive 7](https://github.com/tiraUnderCode23/AQ_MGU) · "
        "[`id8` — iDrive 8](https://github.com/tiraUnderCode23/AQ_MGU/branches) · "
        "[`games` — Games](https://github.com/tiraUnderCode23/AQ_MGU/branches) · "
        "[`Releases` — Prebuilt Catalog](https://github.com/tiraUnderCode23/AQ_MGU/releases/tag/catalog)",
        "",
        "[Cluster & HUD](#cluster--hud) · [Performance & Motorsport](#performance--motorsport) · "
        "[Diagnostics & Telemetry](#diagnostics--telemetry) · [Media, Video & Casting](#media-video--casting) · "
        "[Lighting, Cameras & Comfort](#lighting-cameras--comfort) · [Utilities & System](#utilities--system) · "
        "[Games](#games) · [Helper Tools](#helper-tools)",
        "",
        "</div>",
        "",
        "> HMI labels are publisher/source declarations. ID8 distribution eligibility is reviewed separately in [the ID8 report](docs/ID8_ELIGIBILITY_20261120_AR.md). Physical installation and runtime remain NOT OBSERVED.",
        "",
        "Restored legacy versions, forks and prototypes remain listed with their original descriptions; their inclusion does not replace newer alternatives.",
        "",
        "---",
        "",
        "<details>",
        "<summary><strong>➕ Add AQ MGU to MGU Store</strong></summary>",
        "",
        "| Source | URL | Branch / Channel |",
        "|---|---|---|",
        "| **AQ MGU (iDrive 7 + All)** | `https://github.com/tiraUnderCode23/AQ_MGU` | `main` |",
        "| **AQ MGU (iDrive 8 Only)** | `https://github.com/tiraUnderCode23/AQ_MGU` | `id8` |",
        "| **AQ MGU (Games Only)** | `https://github.com/tiraUnderCode23/AQ_MGU` | `games` |",
        "| **AQ MGU (Prebuilt Releases)** | `https://github.com/tiraUnderCode23/AQ_MGU` | `releases` |",
        "| **AQ Extra Release Catalog** | `https://raw.githubusercontent.com/tiraUnderCode23/AQ_MGU/main/release/catalog.json` | HTTPS |",
        "| **IterioDev Companion** | `https://github.com/IterioDev/car-apps` | `main` |",
        "",
        "```json",
        json.dumps(settings, indent=2),
        "```",
        "",
        "</details>",
        "",
    ]

    for cat, _ in CATEGORIES:
        items = by_cat[cat]
        if not items:
            continue
        lines.append(f"## {cat}")
        lines.append("")
        # Sort featured (with screenshots) first, then alphabetical
        items.sort(key=lambda a: (0 if (app_imgs.get(a["id"], {}).get("images")) else 1, (a.get("title") or a["id"]).lower()))
        with_scr = [a for a in items if (app_imgs.get(a["id"], {}).get("images"))]
        no_scr = [a for a in items if not (app_imgs.get(a["id"], {}).get("images"))]

        for a in with_scr:
            cid = a["id"]
            title = escape(a.get("title") or cid)
            ver = escape(a["version"])
            hmi = " / ".join(a.get("supported_hmi") or ["Not declared"])
            img_info = app_imgs[cid]
            icon = img_info["icon"]
            screens = img_info["images"][:3]
            scr_html = " ".join(f'<img src="{s}" height="150" alt="{title}" />' for s in screens)
            lines.append("<table><tr>")
            lines.append(f'<td width="64" align="center"><img src="{icon}" width="48" height="48" alt="{title}" /></td>')
            lines.append(f'<td><strong>{title}</strong> <code>v{ver}</code> &nbsp;·&nbsp; <code>{hmi}</code></td>')
            lines.append("</tr><tr>")
            lines.append(f'<td colspan="2">{scr_html}</td>')
            lines.append("</tr></table>")
            lines.append("")

        if no_scr:
            # Clean compact 2-column grid for apps without screenshots
            lines.append("<table>")
            for i in range(0, len(no_scr), 2):
                lines.append("<tr>")
                for a in no_scr[i:i+2]:
                    cid = a["id"]
                    title = escape(a.get("title") or cid)
                    ver = escape(a["version"])
                    hmi = " / ".join(a.get("supported_hmi") or ["Not declared"])
                    icon = app_imgs[cid]["icon"]
                    lines.append(
                        f'<td width="50%"><img src="{icon}" width="36" height="36" align="left" alt="{title}" />'
                        f'&nbsp;&nbsp;<strong>{title}</strong><br>&nbsp;&nbsp;<code>v{ver}</code> · <code>{hmi}</code></td>'
                    )
                if len(no_scr[i:i+2]) == 1:
                    lines.append('<td width="50%"></td>')
                lines.append("</tr>")
            lines.append("</table>")
            lines.append("")

    # Collapsed Helper Tools table
    lines.extend([
        "## Helper Tools",
        "",
        "<details>",
        f"<summary><strong>Show all {len(tools)} helper tools</strong></summary>",
        "",
        "| Tool | Version | HMI |",
        "|---|---|---|",
    ])
    for t in sorted(tools, key=lambda x: x["id"]):
        hmi = " / ".join(t.get("supported_hmi") or ["Not declared"])
        lines.append(f"| **{t.get('title') or t['id']}** (`{t['id']}`) | `v{t['version']}` | `{hmi}` |")
    lines.extend(["", "</details>", ""])

    (ROOT / "README.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"README.md written: {len(apps)} apps ({len(id8_apps)} ID8), {len(tools)} tools, {with_imgs} with screenshots")


if __name__ == "__main__":
    rebuild_matrix()
    rebuild_readme()

