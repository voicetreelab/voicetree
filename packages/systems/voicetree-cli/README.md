# @voicetree/cli

The `vt` command-line tool for [Voicetree](https://github.com/lochlan-hill/voicetree).
A backend CLI that runs headless on macOS, Linux, and WSL: spawn coding agents,
inspect and mutate project graphs, run the local Voicetree daemon, and search
indexed notes — decoupled from the Electron app so it can be embedded by other
runtimes and scripted independently.

## Install

```sh
npm install -g @voicetree/cli
```

Requires Node.js 22 or newer.

## Usage

```sh
vt --help            # list all top-level commands
vt manual            # print the canonical CLI manual
vt manual <tool>     # print the manual section for one tool

vt serve --project <path>     # start the headless daemon for a project
vt graph live <args...>     # live graph operations
vt agent spawn <args...>    # spawn a coding agent
```

Run `vt <command> --help` for subcommand details, or `vt manual` to read the
full reference.

## Links

- Repository: https://github.com/lochlan-hill/voicetree
- Issues: https://github.com/lochlan-hill/voicetree/issues
