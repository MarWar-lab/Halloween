"""
Refetch the occult glyphs from game-icons.net and regenerate src/ui/glyphs.ts.

The icons are CC BY 3.0. This script exists so the provenance of every path in
that generated file is checkable rather than a matter of trust — run it and the
output should be byte-identical.

    python3 scripts/fetch-glyphs.py
"""

import json
import pathlib
import re
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = "https://raw.githubusercontent.com/game-icons/icons/master"

# app name -> (path in the game-icons repo, author to credit)
WANT = {
    "pumpkin": ("lorc/pumpkin-lantern", "Lorc"),
    "ghost": ("lorc/ghost", "Lorc"),
    "tombstone": ("lorc/tombstone", "Lorc"),
    "cauldron": ("lorc/cauldron", "Lorc"),
    "raven": ("lorc/raven", "Lorc"),
    "web": ("lorc/spider-web", "Lorc"),
    "cobweb": ("lorc/cobweb", "Lorc"),
    "candle": ("lorc/candle-flame", "Lorc"),
    "moon": ("lorc/moon", "Lorc"),
    "ball": ("lorc/crystal-ball", "Lorc"),
    "hourglass": ("lorc/hourglass", "Lorc"),
    "laurels": ("lorc/laurels", "Lorc"),
    "quill": ("lorc/quill-ink", "Lorc"),
    "skull": ("lorc/candle-skull", "Lorc"),
    "witch": ("lorc/witch-flight", "Lorc"),
    "mask": ("lorc/domino-mask", "Lorc"),
    "swords": ("lorc/crossed-swords", "Lorc"),
    "flame": ("carl-olsen/flame", "Carl Olsen"),
    "crowd": ("delapouite/three-friends", "Delapouite"),
    "cape": ("delapouite/vampire-cape", "Delapouite"),
    "person": ("delapouite/person", "Delapouite"),
    "podium": ("delapouite/podium-winner", "Delapouite"),
    "bat": ("delapouite/bat", "Delapouite"),
}

# Every game-icons SVG opens with a full-bleed black square behind the glyph.
BACKDROP = re.compile(r"^M0 0h512v512H0z$")


def glyph_paths(svg: str, where: str) -> list[str]:
    paths = re.findall(r'<path[^>]*\sd="([^"]+)"', svg)
    kept = [d for d in paths if not BACKDROP.match(d.strip())]
    if not kept:
        raise SystemExit(f"no glyph path found in {where}")
    return kept


def main() -> None:
    glyphs, credits = {}, {}
    for name, (path, author) in WANT.items():
        with urllib.request.urlopen(f"{RAW}/{path}.svg", timeout=30) as r:
            glyphs[name] = glyph_paths(r.read().decode(), path)
        credits[name] = (path, author)
        print(f"  {name:10} {path}")

    body = "\n".join(
        f"  {name}: [\n    "
        + ",\n    ".join(json.dumps(d) for d in paths)
        + ",\n  ],"
        for name, paths in glyphs.items()
    )
    (ROOT / "src/ui/glyphs.ts").write_text(
        '/**\n'
        ' * Occult glyphs, from game-icons.net.\n'
        ' *\n'
        ' * Inlined as path data rather than shipped as files: the scene is already\n'
        ' * procedural Canvas with no image assets, and an icon that inherits\n'
        ' * `currentColor` re-themes for free where an <img> would need a second copy\n'
        ' * for every palette.\n'
        ' *\n'
        ' * CC BY 3.0 — attribution is a licence condition, not a courtesy. See\n'
        ' * CREDITS.md; the UI credits them on the landing page.\n'
        ' *\n'
        ' * Regenerate with scripts/fetch-glyphs.py.\n'
        ' */\n\n'
        f"export const GLYPHS = {{\n{body}\n}} as const;\n\n"
        "export type GlyphName = keyof typeof GLYPHS;\n"
    )
    print(f"\nwrote src/ui/glyphs.ts — {len(glyphs)} glyphs")


if __name__ == "__main__":
    main()
