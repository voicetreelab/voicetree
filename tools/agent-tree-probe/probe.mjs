#!/usr/bin/env node
// Agent-tree delivery probe.
//
// Stands in for a real agent CLI (codex/claude/...) during verification. It does
// nothing but record the environment + argv it was actually launched with, so a
// verifier can assert that a resolved agent's parameters truly reached the
// process — after env injection AND shell expansion — rather than trusting the
// pure resolver's output alone.
//
// Robust: it inspects the literal post-expansion process state, so it catches
// quoting bugs, an env var that never got injected, or a `$VAR` that a shell
// failed to expand. Accurate: this is exactly what a real agent CLI would see.
//
// Writes a JSON dump to $AGENT_TREE_PROBE_OUT (or stdout if unset).
import {writeFileSync} from 'node:fs';

const dump = JSON.stringify({argv: process.argv.slice(2), env: process.env});
const out = process.env.AGENT_TREE_PROBE_OUT;
if (out) writeFileSync(out, dump, 'utf8');
else process.stdout.write(dump);
