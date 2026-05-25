export function usage(): string {
  return [
    'Usage: vt-graph <lint|hygiene|structure|apply|rename|mv|state|live> [args]',
    '       vt-graph hygiene <vault> [--rule <id>] [--json]',
    '       vt-graph structure [folder] [--budget N] [--no-auto|--ascii|--mermaid] [--collapse F]... [--select X]... [--port N]',
    '         (default: tree-cover with daemon overlay if available; auto-collapses coherent subgraphs once visible entities exceed budget — default 30)',
    '       vt-graph apply <cmd-json> [--state-file <path>] [--pretty|--no-pretty] [--out <file>]',
    '       vt-graph state dump <root> [--pretty|--no-pretty] [--out <file>]',
    '       vt-graph live view [--collapse F]... [--select X]... [--mermaid] [--port N]',
    '       vt-graph live state dump [--no-pretty] [--port N]',
    '       vt-graph live apply \'<json-cmd>\' [--port N]',
    '       vt-graph live add-node --file <path> [--label <string>] [--x <number>] [--y <number>] [--port <number>]',
    '       vt-graph live rm-node --file <path> [--port <number>]',
    '       vt-graph live add-edge --src-file <path> --tgt-file <path> [--label <string>] [--port <number>]',
    '       vt-graph live rm-edge --src-file <path> --tgt-file <path> [--port <number>]',
    '       vt-graph live mv-node --file <path> --x <number> --y <number> [--port <number>]',
    '       vt-graph live focus <node> [--hops N] [--port N]',
    '       vt-graph live neighbors <node> [--hops N] [--port N]',
    '       vt-graph live path <a> <b> [--port N]',
  ].join('\n')
}
