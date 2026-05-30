# Debugging the live renderer with `vt debug`

A CDP-driven loop for inspecting and root-causing renderer bugs in a *running*
Electron dev session — no rebuild, no new window, real state. General recipe;
the graph-view stuck-overlay bug is just one instance.

## The loop

1. **Find the session.** `vt debug ls` → pick the `pid` whose `startedAt`/vault
   matches the window you're looking at.
2. **Triage.** `vt debug why-blank --pid <pid>` (one-line verdict) and
   `vt debug log --pid <pid>` (uncaught exceptions + recent console errors).
3. **Close DevTools first.** An open DevTools window is a *second* CDP target on
   the same port; `vt debug` may resolve to it. Symptom: `eval` returns
   `devtools://…` for `location.href`. Close it, then re-probe.
4. **Inspect / drive.** `vt debug eval --pid <pid> '<expr>'`:
   - read app state: `globalThis.__vtDebug__` exposes `.cy()` (node/edge
     snapshot), `.console(n)` (last n buffered logs — captured independently of
     DevTools, so it works even when DevTools is closed), `.exceptions()`.
   - drive the UI: click a DOM node (`[...].find(e=>/text/.test(e.textContent)).click()`),
     or reload with `location.reload()`.
5. **Confirm visually.** `vt debug screenshot --pid <pid>` → Read the PNG path.

## Empirical root-cause (when static reading isn't enough)

Add a temporary `console.log` at the suspect site (e.g. an effect's init/cleanup
with the values that gate it), save (Vite HMR serves it), then
`eval('location.reload()')` → reproduce → read `__vtDebug__.console(2000)`
filtered to your markers. The buffered log gives you the *ordering* of
init/dispose/error events that a stack trace alone can't. Remove the logs once
the cause is pinned.

## Verifying a fix

Reload → reproduce the exact path → assert on signal **counts** from
`__vtDebug__.console()` (e.g. `0` "synchronously unmount", `0` of your crash
string) plus a screenshot. Counts make "before vs after" unambiguous.
