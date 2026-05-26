import path from 'path'

export const mainAliases = (webappDir: string) => [
  { find: /^@vt\/graph-model$/, replacement: path.resolve(webappDir, '../packages/libraries/graph-model/src/index.ts') },
  { find: /^@vt\/graph-model\/(.+)$/, replacement: path.resolve(webappDir, '../packages/libraries/graph-model/src/$1') },
  { find: /^@vt\/app-config$/, replacement: path.resolve(webappDir, '../packages/libraries/app-config/src/index.ts') },
  { find: '@vt/app-config/settings', replacement: path.resolve(webappDir, '../packages/libraries/app-config/src/settings/settings_IO.ts') },
  { find: '@vt/app-config/vault-config', replacement: path.resolve(webappDir, '../packages/libraries/app-config/src/vault-config/voicetree-config-io.ts') },
  { find: '@vt/app-config/project', replacement: path.resolve(webappDir, '../packages/libraries/app-config/src/project/index.ts') },
  { find: '@vt/app-config/positions', replacement: path.resolve(webappDir, '../packages/libraries/app-config/src/positions/positions-store.ts') },
  { find: '@', replacement: path.resolve(webappDir, './src') }
]

export const rendererAliases = (webappDir: string) => [
  { find: /^@vt\/graph-state$/, replacement: path.resolve(webappDir, '../packages/libraries/graph-state/src/index.ts') },
  { find: /^@vt\/graph-state\/(.+)$/, replacement: path.resolve(webappDir, '../packages/libraries/graph-state/src/$1') },
  { find: /^@vt\/graph-model$/, replacement: path.resolve(webappDir, '../packages/libraries/graph-model/src/index.ts') },
  { find: /^@vt\/graph-model\/(.+)$/, replacement: path.resolve(webappDir, '../packages/libraries/graph-model/src/$1') },
  { find: '@', replacement: path.resolve(webappDir, './src') },
  { find: '@wasm', replacement: path.resolve(webappDir, './tidy/wasm_dist') },
  // Alias CSS imports from @material to prevent import errors.
  { find: '@material/mwc-icon/mwc-icon-host.css', replacement: path.resolve(webappDir, 'src/utils/empty-css-export.ts') }
]
