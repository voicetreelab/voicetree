import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {writeFileSync} from 'node:fs'
import {DEFAULT_REPO_ROOT} from './src/_shared/discovery/discover-packages.ts'
import {parseSubgraph} from './src/_shared/graph/parse-subgraph.ts'
const staged=()=>execFileSync('git',['diff','--cached','--name-only','--diff-filter=ACM'],{cwd:DEFAULT_REPO_ROOT,encoding:'utf8'}).split('\n').map(s=>s.trim()).filter(Boolean)
const treeFiles=()=>new Set(execFileSync('git',['ls-files','--cached','-z'],{cwd:DEFAULT_REPO_ROOT,encoding:'utf8',maxBuffer:256*1024*1024}).split('\0').filter(Boolean))
const loader=(sp:ReadonlySet<string>)=>{const pre=DEFAULT_REPO_ROOT+'/';return async(abs:string)=>{const rel=abs.startsWith(pre)?abs.slice(pre.length):abs;const ref=sp.has(rel)?`:${rel}`:`HEAD:${rel}`;try{return execFileSync('git',['show',ref],{cwd:DEFAULT_REPO_ROOT,encoding:'utf8',stdio:['ignore','pipe','ignore']})}catch{return ''}}}
const C='vt-daemon/agent-runtime'
async function main(){
 const cf=staged();const tf=treeFiles();const tp=new Set([...tf].filter(p=>p.endsWith('/package.json')||p==='package.json'));const sp=new Set(cf)
 const ps=await parseSubgraph(cf.map(p=>resolve(DEFAULT_REPO_ROOT,p)),{hops:1,includeInbound:false,depth:1,loadContent:loader(sp),stagedTreeFiles:tf,stagedTreePackages:tp})
 const short=(p:string)=>{const i=p.indexOf('agent-runtime/');return i>=0?p.slice(i+'agent-runtime/'.length):p}
 const V=new Set<string>();for(const f of ps.files)if(ps.communityMap.get(f.absolutePath)===C)V.add(f.absolutePath)
 const edges:[string,string][]=[]
 for(const e of ps.edges){const a=e.from.absolutePath,b=e.to.absolutePath;if(!V.has(a)||!V.has(b)||a===b)continue;edges.push([short(a),short(b)])}
 writeFileSync('/tmp/agent-runtime-graph.json',JSON.stringify({vertices:[...V].map(short),directedEdges:edges},null,0))
 console.log('dumped',V.size,'vertices',edges.length,'directed edges')
}
main().catch(e=>{console.error(e);process.exit(1)})
