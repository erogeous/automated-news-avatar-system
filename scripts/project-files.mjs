import {readdir,stat,readFile} from 'node:fs/promises';
import path from 'node:path';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function listProjectFiles(root){
 const base=path.join(root,'项目资料');const files=[];let truncated=false;
 async function visit(dir){
  if(files.length>=20000){truncated=true;return;}
  let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
  for(const e of entries){
   if(e.name.startsWith('.')||e.isSymbolicLink()||['node_modules','db','data'].includes(e.name))continue;
   const p=path.join(dir,e.name);
   if(e.isDirectory())await visit(p);
   else if(e.isFile()){
    if(files.length>=20000){truncated=true;return;}
    const s=await stat(p);const relative=path.relative(root,p);files.push({name:e.name,path:relative,category:relative.split(path.sep)[1],size:s.size,updatedAt:s.mtime.toISOString()});
   }
  }
 }
 await visit(base);files.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN'));
 let migration=[];try{migration=JSON.parse(await readFile(path.join(base,'00_说明与接续','迁移记录.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 return {project:path.basename(root),root,generatedAt:new Date().toISOString(),files,migration,truncated};
}
export function projectFilesPage(index){return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>项目文件</title><body><h1>'+escape(index.project)+' · 项目文件</h1><p>按实际目录实时读取。旧路径链接保留；待审阅不代表已验收。</p><p>'+escape(index.root)+'</p><table><thead><tr><th>分类</th><th>文件</th><th>实际相对路径</th><th>大小</th></tr></thead><tbody>'+index.files.map(f=>'<tr><td>'+escape(f.category)+'</td><td>'+(f.downloadUrl?'<a href="'+escape(f.downloadUrl)+'">'+escape(f.title||f.name)+'</a>':escape(f.title||f.name))+'</td><td>'+escape(f.path)+(f.taskTitle?'<br>任务：'+escape(f.taskTitle):'')+'</td><td>'+escape(f.size)+' B</td></tr>').join('')+'</tbody></table>'+(index.truncated?'<p>文件超过显示上限，请使用本地索引。</p>':'')+'</body></html>';}

// One watcher per running app; changes are debounced and the index never indexes itself.
import {watch,existsSync} from 'node:fs';
import {writeFile,rename} from 'node:fs/promises';
export async function syncProjectIndex(root,loadIndex){
 const index=loadIndex?await loadIndex():await listProjectFiles(root);index.files=index.files.filter(f=>!f.path.endsWith('/程序文件索引.json'));
 const target=path.join(root,'项目资料/00_说明与接续/程序文件索引.json');const temporary=target+'.'+process.pid+'.tmp';
 await writeFile(temporary,JSON.stringify(index,null,2));await rename(temporary,target);return index;
}
export function startProjectIndex(root,{loadIndex}={}){
 const base=path.join(root,'项目资料');if(!existsSync(base))return ()=>{};
 let timer=null,closed=false,busy=false,pending=false;
 async function refresh(){if(closed)return;if(busy){pending=true;return;}busy=true;try{await syncProjectIndex(root,loadIndex);}catch(e){console.error('项目文件索引更新失败：'+e.message);}finally{busy=false;if(pending){pending=false;schedule();}}}
 function schedule(){clearTimeout(timer);timer=setTimeout(refresh,1000);timer.unref();}
 const poll=setInterval(refresh,Math.max(1000,Number(process.env.PROJECT_INDEX_POLL_MS)||15000));poll.unref();
 let watcher;try{watcher=watch(base,{recursive:true},(_event,name)=>{if(name&&String(name).startsWith('00_说明与接续'))return;schedule();});watcher.on('error',()=>{watcher.close();watcher=null;});}catch{}
 schedule();
 return ()=>{closed=true;clearTimeout(timer);clearInterval(poll);watcher?.close();};
}
