# OpenSpec changes have moved

This directory is intentionally empty. All VoiceTree OpenSpec proposals,
designs, tasks, and archived changes now live in the **brain** submodule:

```
~/brain/mem/openspec/changes/
~/brain/mem/openspec/changes/archive/
```

…which is checked out at `voicetree-public/brain/mem/openspec/changes/`.

## Why

`brain/mem` is the single source of truth for specs. Keeping a second copy
under `voicetree-public/openspec/` produced drift and double-bookkeeping.

## What to do

- **Reading a spec / picking up work:** open `~/brain/mem/openspec/changes/<change-id>/`.
- **Proposing a new change:** create it in `~/brain/mem/openspec/changes/<change-id>/`, not here.
- **Archiving a shipped change:** move it to `~/brain/mem/openspec/changes/archive/<change-id>/`.

See also: `../please_see_brain_working-memory_openspec_instead.agent_instruction`.
