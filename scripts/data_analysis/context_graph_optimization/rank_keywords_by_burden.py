#!/usr/bin/env python3
"""Rank searched keywords by read-burden and tag the right remediation lever.

Burden(K) = search_count(K) x ripgrep_hits(K)  -- the historical reading cost of K.
We split hits into authoritative (signal) vs offending (non-code trees), and count
K's *definition sites* to judge whether K is one drowned symbol (uniqifiable) or an
inherently-pervasive concept (not fixable by renaming).

Levers:
  RENAME   generic word, big haystack, FEW definition sites, mostly navigation
  CONCEPT  generic word but MANY definition sites -> it's many distinct things;
           scope searches / ship a concept->path map, do NOT global-rename
  IGNORE   offending share dominates -> the .ignore lever (junk trees), not renaming
  FILTER   mostly output-filter greps (| grep X) -> not a codebase search at all
  KEEP     already-distinctive name; high burden is legitimate references

Usage:
    python3 rank_keywords_by_burden.py keyword_counts.json /path/to/repo \
        [--out results/worst_keywords.md] [--top 10]
"""
import json, subprocess, re, os, sys, shutil, argparse, collections

# Non-authoritative trees (per the offending-hits method). A hit under one of these
# is "offending": markdown/state co-located with code that an agent reads & discards.
OFFEND = re.compile(r'(^|/)('
    r'voicetree-\d+[\w.-]*|brain|ctx-nodes|[\w-]*-dashboard|docs|spike-[\w-]*|'
    r'dist|build|coverage|test-fixtures|get_dev_healthy|agent-in-devbox|'
    r'unified-folder[\w-]*|node_modules|\.ck'
    r')(/|$)')

# a "definition site" line: `class|function|const|... <kw>` (word-bounded), any file
def def_regex(kw):
    return r'\b(class|function|const|let|var|interface|type|enum|def)\s+' + re.escape(kw) + r'\b'


def rg_runner():
    """Return a callable run(args, cwd)->stdout that works whether `rg` is a real
    binary (normal machines) or a Claude Code shell-function wrapper (this devbox,
    where the real ripgrep is bundled in the claude binary and reached via argv0)."""
    real = shutil.which("rg")
    if real:
        return lambda args, cwd: subprocess.run([real, *args], cwd=cwd,
            capture_output=True, text=True, timeout=120).stdout
    cc = os.environ.get("CLAUDE_CODE_EXECPATH") or os.path.expanduser("~/.local/bin/claude")
    return lambda args, cwd: subprocess.run(["rg", *args], executable=cc, cwd=cwd,
        capture_output=True, text=True, timeout=120).stdout


def classify(kw, total, offend, nav, searches, ndefs):
    off_share = offend / total if total else 0
    nav_share = nav / searches if searches else 0
    distinctive = (bool(re.search(r"[a-z][A-Z]", kw)) or "-" in kw
                   or any(c.isdigit() for c in kw) or len(kw) >= 12 or kw.startswith("VT_"))
    if nav_share < 0.5:           return "FILTER"
    if distinctive:               return "KEEP"
    if off_share >= 0.30:         return "IGNORE"
    if ndefs >= 8:                return "CONCEPT"
    if total >= 900:              return "RENAME"
    return "mid"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("counts"); ap.add_argument("repo")
    ap.add_argument("--out", default=None); ap.add_argument("--top", type=int, default=10)
    a = ap.parse_args()
    counts = json.load(open(a.counts))
    repo = os.path.expanduser(a.repo)
    run = rg_runner()

    rows = []
    for kw, c in counts.items():
        searches = c["searches"] if isinstance(c, dict) else c
        nav = c.get("nav", searches) if isinstance(c, dict) else searches
        files = [f for f in run(["-il", "-F", "--", kw], repo).splitlines() if f]
        total = len(files)
        offend = sum(1 for f in files if OFFEND.search(f))
        # definition sites: `class/function/const/... <kw>` across source files.
        # Many sites => K names many distinct things (not one renamable symbol).
        ndefs = len([l for l in run(
            ["-i", "--no-filename", def_regex(kw), "-g", "*.{ts,tsx,js,jsx,py,go}"],
            repo).splitlines() if l])
        rows.append(dict(kw=kw, searches=searches, nav=nav, total=total, offend=offend,
                         signal=total - offend, ndefs=ndefs,
                         burden=searches * total, burden_offend=searches * offend,
                         lever=classify(kw, total, offend, nav, searches, ndefs)))
    rows.sort(key=lambda r: -r["burden"])

    hdr = "%2s %-26s %4s %4s %5s %5s %5s %8s %7s" % (
        "#", "KEYWORD", "SRC", "NAV", "HITS", "OFF", "DEFS", "BURDEN", "LEVER")
    lines = [hdr, "-" * len(hdr)]
    for i, r in enumerate(rows[:a.top], 1):
        lines.append("%2d %-26s %4d %4d %5d %5d %5d %8d %7s" % (
            i, r["kw"], r["searches"], r["nav"], r["total"], r["offend"],
            r["ndefs"], r["burden"], r["lever"]))
    table = "\n".join(lines)
    print(table)

    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)) or ".", exist_ok=True)
        with open(a.out, "w") as fh:
            fh.write(render_md(rows, repo, a.top, table))
        print(f"\nwrote {a.out}")


def render_md(rows, repo, top, table):
    head = os.environ.get("RANK_REPO_LABEL", os.path.basename(repo.rstrip("/")))
    lever_counts = collections.Counter(r["lever"] for r in rows)
    dist = "  ".join(f"{k}={v}" for k, v in lever_counts.most_common())
    return f"""# Worst {top} search keywords by read-burden (search_count x ripgrep_hits)

Repo measured: `{head}`. `BURDEN = searches x HITS` = total historical reading cost.
`OFF` = hits in non-authoritative trees; `DEFS` = definition sites (many => many
distinct concepts, not one renamable symbol). Lever legend: RENAME / CONCEPT (scope
or concept-map, don't rename) / IGNORE (.ignore junk trees) / FILTER (output-filter
grep, not a codebase search) / KEEP (already distinctive).

```
{table}
```

## Lever distribution (over {len(rows)} ranked keywords)
`{dist}`

## Robustness verdict
Raw `search x hits` is a sound measure of **where reading cost concentrates**, but it
is NOT a robust "noisy searches we can kill by uniqifying" signal until decomposed by
the two columns above:

* **`nav` (navigation share).** A `cmd | grep X` filters stdout; it is not a codebase
  search, so renaming a symbol cannot remove it. Many top keywords (e.g. `Status`
  nav={next((r['nav'] for r in rows if r['kw']=='Status'),'-')}/{next((r['searches'] for r in rows if r['kw']=='Status'),'-')}) are almost entirely output filters.
* **`DEFS` (definition multiplicity).** `graph`/`state`/`path` each have hundreds-to-
  thousands of definition sites: they are pervasive *concepts*, not one mis-named
  symbol. You cannot rename a concept, and an agent searching it often wants breadth.

A keyword is a **genuine uniqify (RENAME) target only** when it is searched as
navigation AND has FEW definitions but MANY hits (one symbol drowned in unrelated
text). After filtering, that set is small -- not the headline list. So the metric is
robust as a **triage** (FILTER->ignore, CONCEPT->concept-map/scoping, RENAME->the rare
real case, KEEP->leave), and misleading if read literally.

See `README.md` for full method and caveats.
"""


if __name__ == "__main__":
    main()
