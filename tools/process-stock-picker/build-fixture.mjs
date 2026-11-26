import {mkdtemp, cp, readFile, writeFile, symlink} from 'node:fs/promises'
import {join,resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'

const here=dirname(fileURLToPath(import.meta.url))
const repo=resolve(here,'../..')
const web=join(repo,'src/web')
const out=await mkdtemp(join(tmpdir(),'stock-picker-qa-'))
for(const name of ['src','public','index.html','tsconfig.app.json','tsconfig.json','tsconfig.node.json','package.json']){
  await cp(join(web,name),join(out,name),{recursive:true})
}
await symlink(join(web,'node_modules'),join(out,'node_modules'),process.platform==='win32'?'junction':'dir')
await cp(join(here,'picker.html'),join(out,'picker.html'))
await writeFile(join(out,'PickerFixture.tsx'),(await readFile(join(here,'PickerFixture.tsx'),'utf8')).replaceAll('../../src/web/src/','./src/'))
await writeFile(join(out,'verify-vite.config.ts'),`import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({plugins:[react()],build:{target:'esnext',rollupOptions:{input:{main:'index.html',popup:'picker.html'}}}})
`)
await writeFile(join(out,'tsconfig.qa.json'),JSON.stringify({extends:'./tsconfig.app.json',include:['src','PickerFixture.tsx']}))
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.qa.json'],{cwd:out,stdio:'inherit'})
execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build','--config','verify-vite.config.ts'],{cwd:out,stdio:'inherit'})
const data=JSON.parse(await readFile(join(repo,'src/api/src/main/resources/work-history-default.json'),'utf8'))
data.stations['DEMO-A'].slots=[2]
data.menuProcesses['DEMO-A'].slots={'2':'SYNTHETIC-CUT-2'}
await writeFile(join(out,'slot2.json'),JSON.stringify(data))
console.log(out)
