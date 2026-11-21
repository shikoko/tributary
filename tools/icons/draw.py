"""Tributary's app icon: a branch joining the main line. The main line runs through two
commits, and a branch in the graph's colours bends in to the newer one, as a merged branch
does in the history. Writes the light and dark versions to src-tauri/icons/.

    python3 tools/icons/draw.py

Then render them (tools/icons/render.mjs, see the README).
"""
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "src-tauri" / "icons"

# A rounded square with continuous (Apple-style) corners, 824 wide on a 1024 canvas.
TILE = "M924 512C924 922 922 924 512 924C102 924 100 922 100 512C100 102 102 100 512 100C922 100 924 102 924 512Z"
# The main line, through the tile from edge to edge.
MAIN = "M380 1060V-40"
# The branch: up from beyond the bottom edge, then one smooth bend into the merge.
BRANCH = "M700 1060V700C700 520 380 520 380 330"
# Its colours, from where it starts to where it joins: two of the graph's.
BRANCH_FROM, BRANCH_TO = "#ff4f9a", "#8f6bff"
WIDTH = 96
# The commits (x, y, radius, hole): the merge, and an older one on the main line. Their holes
# go right through, so they show whatever is behind them.
COMMITS = [(380, 330, 104, 40), (380, 760, 76, 30)]

THEMES = {
    "light": {
        "tile": [("0", "#ffffff"), ("1", "#e5eaf2")],
        "ink": "#141a26",      # the main line and the commits
        "rim": 0.35,
    },
    "dark": {
        "tile": [("0", "#1c2333"), ("1", "#0b0e14")],
        "ink": "#ffffff",
        "rim": 0.22,
    },
}


def svg(theme):
    t = THEMES[theme]
    stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in t["tile"])
    holes = "".join(f'<circle cx="{x}" cy="{y}" r="{hole}"/>' for x, y, _, hole in COMMITS)
    commits = "".join(f'\n      <circle cx="{x}" cy="{y}" r="{r}" fill="{t["ink"]}"/>' for x, y, r, _ in COMMITS)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!--
    Tributary's app icon ({theme}): a branch in the graph's colours bends in to join the main
    line at a commit, as a merged branch does in the history. Drawn by tools/icons/draw.py;
    change that, not this file.
  -->
  <defs>
    <path id="tile" d="{TILE}"/>
    <clipPath id="clip"><use href="#tile"/></clipPath>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">{stops}</linearGradient>
    <linearGradient id="branch" gradientUnits="userSpaceOnUse" x1="0" y1="924" x2="0" y2="330">
      <stop offset="0" stop-color="{BRANCH_FROM}"/><stop offset="1" stop-color="{BRANCH_TO}"/>
    </linearGradient>
    <mask id="holes" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <rect width="1024" height="1024" fill="#fff"/>
      <g fill="#000">{holes}</g>
    </mask>
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
    <g mask="url(#holes)">
      <g fill="none" stroke-width="{WIDTH}">
        <path d="{BRANCH}" stroke="url(#branch)"/>
        <path d="{MAIN}" stroke="{t["ink"]}"/>
      </g>{commits}
    </g>
  </g>
  <use href="#tile" fill="none" stroke="url(#rim)" stroke-width="5" clip-path="url(#clip)"/>
</svg>
'''


if __name__ == "__main__":
    (OUT / "app-icon.svg").write_text(svg("light"))
    (OUT / "app-icon-dark.svg").write_text(svg("dark"))
    print("Wrote", OUT / "app-icon.svg", "and", OUT / "app-icon-dark.svg")
