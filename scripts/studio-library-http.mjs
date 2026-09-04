import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { libraryRoot, validId, newId, fail, readJson, atomicJson, idsAt, builtinSop, activeSop, parseSop, saveProject, exclusive } from "./studio-library.mjs";

export async function serveFile(req,res,file,type,headers={}) {
  const size=(await stat(file)).size, range=req.headers.range;
  let start=0,end=size-1,status=200;
  if(range) {
    const m=range.match(/^bytes=(\d*)-(\d*)$/);
    if(!m || (!m[1]&&!m[2])) {res.writeHead(416,{...headers,"Content-Range":"bytes */"+size});res.end();return;}
    if(!m[1]) start=Math.max(0,size-Number(m[2]));
    else {start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
    if(start> end || start>=size) {res.writeHead(416,{...headers,"Content-Range":"bytes */"+size});res.end();return;}
    status=206;
  }
  res.writeHead(status,{...headers,"Content-Type":type,"Content-Length":end-start+1,"Accept-Ranges":"bytes","Cache-Control":"private, max-age=60",...(status===206?{"Content-Range":`bytes ${start}-${end}/${size}`}:{})});
  if(req.method==="HEAD")res.end();else createReadStream(file,{start,end}).on("error",()=>res.destroy()).pipe(res);
}
export async function handleLibrary(req,res,url,{json,jsonBody,bodyBuffer,cors}) {
  const p=url.pathname, method=req.method;
  if(!p.startsWith("/library/")) return false;
  if(p==="/library/projects" && method==="POST") {json(res,200,await saveProject(await jsonBody(req)));return true;}
  if(p==="/library/projects" && method==="GET") {
    const projects=await Promise.all((await idsAt(path.join(libraryRoot,"projects"))).map(async id=>{
      const item=await readJson(path.join(libraryRoot,"projects",id,"record.json"));
      const s=item.snapshot;
      return {id,name:item.name,revision:item.revision,updatedAt:item.updatedAt,anchorId:s.anchorId,step:s.step,hasScript:Boolean(s.script),hasAudio:Boolean(s.audioSliceJobId),hasVideo:Boolean(s.videoUrl),hasComposition:Boolean(s.compositionUrl)};
    }));
    json(res,200,{projects:projects.sort((a,b)=>b.updatedAt-a.updatedAt)});return true;
  }
  const project=p.match(/^\/library\/projects\/([a-f0-9]{32})(?:\/versions(?:\/(\d+))?)?$/);
  if(project&&method==="GET") {
    const dir=path.join(libraryRoot,"projects",project[1]);
    if(p.endsWith("/versions")) {
      const latest=await readJson(path.join(dir,"record.json"));
      json(res,200,{revision:latest.revision});return true;
    }
    const file=project[2]?path.join(dir,"versions",String(Number(project[2]))+".json"):path.join(dir,"record.json");
    json(res,200,await readJson(file));return true;
  }
  if(p==="/library/sops"&&method==="GET") {
    const current=await activeSop(), builtin=await builtinSop();
    const versions=await Promise.all((await idsAt(path.join(libraryRoot,"sops"))).map(id=>readJson(path.join(libraryRoot,"sops",id,"record.json"))));
    json(res,200,{active:current,versions:[...versions.sort((a,b)=>b.createdAt-a.createdAt),builtin]});return true;
  }
  if(p==="/library/sops"&&method==="POST") {
    const bytes=await bodyBuffer(req,5_000_000);
    const name=decodeURIComponent(String(req.headers["x-file-name"]||"")).slice(0,200);
    const text=parseSop(bytes,name), id=newId(), dir=path.join(libraryRoot,"sops",id);
    await mkdir(dir,{recursive:true});
    const extension=/\.docx$/i.test(name)?"docx":/\.md$/i.test(name)?"md":"txt";
    await writeFile(path.join(dir,"original."+extension),bytes);
    const record={id,name,version:text.match(/V\d+\.\d+/i)?.[0]||"自定义规则",text,createdAt:Date.now(),file:"original."+extension};
    await atomicJson(path.join(dir,"record.json"),record);
    json(res,201,record);return true;
  }
  if(p==="/library/sops/activate"&&method==="POST") {
    const body=await jsonBody(req);
    if(body.id!=="builtin-v4-3"&&!validId(body.id))throw fail("规则编号无效");
    if(body.id!=="builtin-v4-3")await readJson(path.join(libraryRoot,"sops",body.id,"record.json"));
    await exclusive(()=>atomicJson(path.join(libraryRoot,"sops","active.json"),{id:body.id}));
    json(res,200,{active:await activeSop()});return true;
  }
  if(p==="/library/downloads"&&method==="POST") {
    const body=await jsonBody(req);
    if(typeof body.sourceUrl!=="string"||body.sourceUrl.length>4000||!/^https?:\/\//i.test(body.sourceUrl)||!["image","video"].includes(body.type))throw fail("素材类型或地址无效");
    const running=await Promise.all((await idsAt(path.join(libraryRoot,"downloads"))).map(id=>readJson(path.join(libraryRoot,"downloads",id,"record.json"))));
    if(running.filter(j=>["queued","downloading"].includes(j.status)&&Date.now()-j.createdAt<16*60000).length>=2)throw fail("已有两个下载任务，请等待完成后再添加",429);
    const id=newId(), dir=path.join(libraryRoot,"downloads",id);
    const job={id,sourceUrl:body.sourceUrl,type:body.type,caption:String(body.caption||"新闻素材").slice(0,200),status:"queued",progress:0,createdAt:Date.now()};
    await atomicJson(path.join(dir,"record.json"),job);
    const child=spawn(process.execPath,[path.resolve("scripts/library-download.mjs"),id],{cwd:process.cwd(),env:process.env,detached:true,stdio:"ignore"});child.unref();
    json(res,202,job);return true;
  }
  if(p==="/library/downloads"&&method==="GET") {
    const jobs=await Promise.all((await idsAt(path.join(libraryRoot,"downloads"))).map(async id=>{
      let j=await readJson(path.join(libraryRoot,"downloads",id,"record.json"));
      if(["queued","downloading"].includes(j.status)&&Date.now()-j.createdAt>16*60000)j={...j,status:"failed",error:"下载中断或超时，请重试"};
      return j;
    }));
    json(res,200,{jobs:jobs.sort((a,b)=>b.createdAt-a.createdAt)});return true;
  }
  const media=p.match(/^\/library\/downloads\/([a-f0-9]{32})\/file$/);
  if(media&&["GET","HEAD"].includes(method)) {
    const dir=path.join(libraryRoot,"downloads",media[1]), j=await readJson(path.join(dir,"record.json"));
    if(j.status!=="completed"||!/^media\.(mp4|jpg|png|webp)$/.test(j.file))throw fail("素材尚未下载完成",409);
    await serveFile(req,res,path.join(dir,j.file),j.type==="video"?"video/mp4":j.file.endsWith("jpg")?"image/jpeg":"image/"+j.file.split(".").pop(),cors());return true;
  }
  json(res,404,{error:"素材库接口不存在"});return true;
}
