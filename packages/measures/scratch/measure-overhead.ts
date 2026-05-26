import {performance} from 'node:perf_hooks'
import {discoverPackages} from '../src/_shared/discovery/discover-packages.js'
import {scanSourceFiles} from '../src/_shared/graph/import-graph.js'

const t0 = performance.now()
const packages = await discoverPackages()
const t1 = performance.now()
const all = await scanSourceFiles(packages)
const t2 = performance.now()
console.log('discoverPackages:', (t1 - t0).toFixed(0), 'ms,', packages.length, 'packages')
console.log('scanSourceFiles:', (t2 - t1).toFixed(0), 'ms,', all.length, 'files')
