"""Tributary's app icon: five branch colours flowing in from beyond the edge, merging, and
flowing on as one river. Writes the light and dark versions to src-tauri/icons/.

    python3 tools/icons/draw.py

Then render them (tools/icons/render.mjs, see the README).
"""
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "src-tauri" / "icons"

# A rounded square with continuous (Apple-style) corners, 824 wide on a 1024 canvas.
TILE = "M924 512C924 922 922 924 512 924C102 924 100 922 100 512C100 102 102 100 512 100C922 100 924 102 924 512Z"
# The vivid graph colours, left to right.
LANES = ["#1fb5ff", "#ff4f9a", "#ffad1f", "#2fd38a", "#8f6bff"]
# Spread to the edges, so the outer ones sweep in along the tile's corners.
XS = [200, 356, 512, 668, 824]
MERGE_Y = 690

THEMES = {
    "light": {
        "tile": [("0", "#ffffff"), ("1", "#e5eaf2")],
        "gap": "#f4f6fa",      # between the lanes as they squeeze together: the tile's colour
        "ink": "#141a26",      # the merge and the river
        "dot": "#ffffff",
        "rim": 0.35,
    },
    "dark": {
        "tile": [("0", "#1c2333"), ("1", "#0b0e14")],
        "gap": "#151a25",
        "ink": "#ffffff",
        "dot": "#141a26",
        "rim": 0.22,
    },
}


def lane(x):
    """Straight down, then one long smooth sweep into the merge."""
    return f"M{x} 20V320C{x} 520 512 510 512 {MERGE_Y}"


def svg(theme):
    t = THEMES[theme]
    stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in t["tile"])
    lanes = ""
    # Outer lanes first and the middle one last, so they stack evenly where they meet.
    for i in [0, 4, 1, 3, 2]:
        lanes += (
            f'\n    <path d="{lane(XS[i])}" stroke="{t["gap"]}" stroke-width="104"/>'
            f'\n    <path d="{lane(XS[i])}" stroke="{LANES[i]}" stroke-width="86"/>'
        )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!--
    Tributary's app icon ({theme}): five branches in the graph's colours flow in from beyond
    the edge and merge into one commit, and one river flows on. Drawn by tools/icons/draw.py;
    change that, not this file.
  -->
  <defs>
    <path id="tile" d="{TILE}"/>
    <clipPath id="clip"><use href="#tile"/></clipPath>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">{stops}</linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="{t["rim"]}"/>
      <stop offset="0.4" stop-color="#fff" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0.02"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.3"/>
    </filter>
  </defs>
  <use href="#tile" fill="url(#bg)" filter="url(#shadow)"/>
  <g clip-path="url(#clip)">
    <!-- The river, widening as it flows out -->
    <path d="M450 {MERGE_Y}L418 1060H606L574 {MERGE_Y}Z" fill="{t["ink"]}"/>
    <g fill="none" stroke-linecap="round">{lanes}
    </g>
    <!-- Where they merge -->
    <circle cx="512" cy="{MERGE_Y}" r="92" fill="{t["ink"]}"/>
    <circle cx="512" cy="{MERGE_Y}" r="36" fill="{t["dot"]}"/>
  </g>
  <use href="#tile" fill="none" stroke="url(#rim)" stroke-width="5" clip-path="url(#clip)"/>
</svg>
'''


if __name__ == "__main__":
    (OUT / "app-icon.svg").write_text(svg("light"))
    (OUT / "app-icon-dark.svg").write_text(svg("dark"))
    print("Wrote", OUT / "app-icon.svg", "and", OUT / "app-icon-dark.svg")
