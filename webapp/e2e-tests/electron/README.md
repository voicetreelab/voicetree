# Electron Screenshot Proofs

- Run screenshot proofs on devbox under Xvfb, not on local macOS.
- Use `xvfb-run -a npm --workspace webapp exec -- node <proof-script>.mjs`.
- For Electron screenshots, use Playwright `page.screenshot()`, not `scrot`.
- `scrot` captures the X root and can return black when Electron is hidden.
- Set `MINIMIZE_TEST=0` for proof runs that need visible UI pixels.
- Launch Electron directly from the proof script to avoid Playwright worker teardown noise.
- Keep resume proof black-box: real Electron, real UI click, real CLI process argv.
- Validate screenshots are non-blank before accepting them as proof.
- Copy proof PNGs back from devbox with `scp`, then open them locally.
- Resume proof runner: `terminals/content/run-resume-proof.mjs`.
