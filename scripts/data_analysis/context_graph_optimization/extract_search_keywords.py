#!/usr/bin/env python3
"""Extract historical search keywords from saved Claude Code sessions.

Claude Code persists every session as JSONL under ~/.claude/projects/*/*.jsonl.
Every search is a `tool_use` block; we harvest the query from two sources:

  * `Grep` tool  -> input.pattern                 (always code NAVIGATION)
  * `Bash`       -> input.command, parsed          (rg/grep; NAV or output-FILTER)

The NAV/FILTER split is the robustness crux: a `cmd | grep X` with no path argument
is *filtering stdout*, not searching the codebase, so renaming a symbol cannot make
that search go away. We classify each Bash rg/grep stage accordingly.

Output: JSON {keyword: {searches, nav, filter}} sorted by `searches`, to stdout.

Usage:
    find ~/.claude/projects -name '*.jsonl' -print0 \
        | xargs -0 cat | python3 extract_search_keywords.py > keyword_counts.json
"""
import json, sys, re, shlex, collections

# Tokens that are output-filtering / build plumbing / language keywords, not our
# code symbols. Keywords here are dropped from the navigation-keyword vocabulary.
STOP = {
 "node_modules","dist","build","__tests__","FAIL","PASS","Warning","Warnings","warnings",
 "Sourcemap","ExperimentalWarning","error","errors","Error","grep","rg","tmux","vitest","jest",
 "playwright","npm","pnpm","node","LISTEN","ESTABLISHED","trace","Elapsed","echo","true",
 "false","null","undefined","test","Test","tests","spec","specs","import","imports","export",
 "exports","from","const","let","var","function","class","return","async","await","void",
 "string","number","boolean","type","interface","worktree","worktrees","folder","folders",
 "voicetree","brain","TS","wall","real","user","sys","sudo","time","cat","head","tail",
 "json","yaml","md","ts","tsx","js","main","index","src","packages","webapp","scripts","fail",
}
VALUE_FLAGS = {"-e","--regexp","-f","--file","-g","--glob","-m","--max-count","-A","-B",
 "-C","--context","-t","--type","-T","--type-not","--color","--colour","-d","--max-depth",
 "--include","--exclude","--exclude-dir","-M","--max-columns"}
IDENT = re.compile(r'[A-Za-z_][A-Za-z0-9_-]{3,}')


def components(pattern):
    """Split a search pattern into candidate identifier keywords (handles a|b|c)."""
    out = []
    for part in re.split(r'\|', pattern):
        part = re.sub(r'\\b|\^|\$|\\s|\\\.|[()*+?{}\[\]]', ' ', part).replace('\\', '')
        for tok in re.split(r'[\s.:=/]+', part):
            tok = tok.strip()
            if IDENT.fullmatch(tok) and tok not in STOP:
                out.append(tok)
    return out


def parse_bash_stage(toks):
    """Return (patterns, has_path_arg) for a tokenised rg/grep stage, or (None, _)."""
    exe = next((k for k, t in enumerate(toks)
                if re.fullmatch(r'(rg|grep|egrep|fgrep)', t.split('/')[-1])), None)
    if exe is None:
        return None, False
    toks = toks[exe + 1:]
    pats, positionals, i, saw_e = [], [], 0, False
    while i < len(toks):
        t = toks[i]
        if t in ("-e", "--regexp"):
            if i + 1 < len(toks):
                pats.append(toks[i + 1]); i += 2; saw_e = True; continue
        if t in VALUE_FLAGS:
            i += 2; continue
        if t.startswith("--") and "=" in t:
            i += 1; continue
        if t.startswith("-") and t != "-":
            i += 1; continue
        positionals.append(t); i += 1
    if not saw_e and positionals:
        pats.append(positionals.pop(0))          # first bare positional is the pattern
    has_path = bool(positionals)                 # anything left = a file/dir/glob target
    return pats, has_path


def iter_searches(stdin):
    """Yield (keyword, is_navigation) for every search in the JSONL stream."""
    for line in stdin:
        try:
            obj = json.loads(line)
        except Exception:
            continue
        msg = obj.get("message", {})
        content = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(content, list):
            continue
        for blk in content:
            if not (isinstance(blk, dict) and blk.get("type") == "tool_use"):
                continue
            name, inp = blk.get("name"), blk.get("input") or {}
            if name == "Grep":
                for kw in components(inp.get("pattern") or ""):
                    yield kw, True                # Grep tool == navigation
            elif name in ("Bash", "bash"):
                cmd = inp.get("command") or ""
                if not re.search(r'\b(rg|grep|egrep|fgrep)\b', cmd):
                    continue
                # split into pipeline stages, remembering if a stage was piped-into
                stages = re.split(r'(\|\||&&|\||;|\bxargs\b)', cmd)
                piped_in = False
                for seg in stages:
                    if seg in ("||", "&&", "|", ";", "xargs"):
                        piped_in = (seg == "|" or seg == "xargs"); continue
                    seg = seg.strip()
                    if not re.match(r'^(?:sudo\s+)?(?:time\s+)?(rg|grep|egrep|fgrep)\b', seg):
                        piped_in = False; continue
                    try:
                        toks = shlex.split(seg)
                    except Exception:
                        continue
                    pats, has_path = parse_bash_stage(toks)
                    if not pats:
                        continue
                    is_rg = bool(re.match(r'^(?:sudo\s+)?(?:time\s+)?rg\b', seg))
                    # NAV iff it targets the filesystem: has an explicit path, OR is a
                    # standalone (not piped-into) rg/grep that searches cwd by default.
                    is_nav = has_path or (not piped_in and is_rg) or (not piped_in)
                    for p in pats:
                        if len(p) > 80:
                            continue
                        for kw in components(p):
                            yield kw, is_nav


def main():
    agg = collections.defaultdict(lambda: {"searches": 0, "nav": 0, "filter": 0})
    for kw, is_nav in iter_searches(sys.stdin):
        rec = agg[kw]
        rec["searches"] += 1
        rec["nav" if is_nav else "filter"] += 1
    ordered = dict(sorted(agg.items(), key=lambda kv: -kv[1]["searches"])[:200])
    json.dump(ordered, sys.stdout, indent=0)


if __name__ == "__main__":
    main()
