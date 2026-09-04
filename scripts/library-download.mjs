import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { mkdir, writeFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { libraryRoot, readJson, atomicJson, fail, validId } from "./studio-library.mjs";

const blocked = new BlockList();
for (const [ip, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.168.0.0",16],["192.0.0.0",24],["192.0.2.0",24],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]]) blocked.addSubnet(ip,prefix);
// Allow only ordinary global unicast IPv6; deny transition mechanisms and documentation ranges.
for (const [ip, prefix] of [["2001::",32],["2001:db8::",32],["2002::",16]]) blocked.addSubnet(ip,prefix,"ipv6");
export function publicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address,"ipv4") :
    family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address,"ipv6");
}
export async function safeBytes(input, budget, hops = 0) {
  if (hops > 4) throw fail("素材重定向次数过多");
  const url = new URL(input);
  if (!["http:","https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80","443"].includes(url.port))) throw fail("素材必须是公开 HTTP/HTTPS 地址");
  const addresses = await dns.lookup(url.hostname.replace(/^\[|\]$/g,""), { all: true });
  if (!addresses.length || addresses.some((v) => !publicAddress(v.address))) throw fail("拒绝访问本机、内网或保留地址");
  const address = addresses[0];
  return new Promise((resolve,reject) => {
    const req = (url.protocol === "https:" ? https : http).get(url, {
      // Pin the validated DNS answer to this connection (including redirected requests).
      lookup: (_host, options, done) => options.all ? done(null,[address]) : done(null,address.address,address.family),
      headers: { "User-Agent": "NewsAvatarLibrary/1.0", "Accept-Encoding": "identity" },
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume(); clearTimeout(timer);
        safeBytes(new URL(res.headers.location,url).href,budget,hops+1).then(resolve,reject); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(fail("素材下载失败 HTTP " + res.statusCode)); return; }
      const chunks=[];
      res.on("data",(chunk) => {
        budget.left -= chunk.length;
        if (budget.left < 0) { res.destroy(fail("素材下载超过250MB上限")); return; }
        chunks.push(chunk);
      });
      res.on("error",reject);
      res.on("end",()=>resolve({ bytes: Buffer.concat(chunks), url: url.href, type: String(res.headers["content-type"] || "") }));
    });
    const timer = setTimeout(()=>req.destroy(fail("下载等待超过30秒，请稍后重试")),30000);
    req.on("error",reject);
    req.on("close",()=>clearTimeout(timer));
  });
}
async function hlsLocal(input, dir, budget, progress, depth=0) {
  if (depth > 3) throw fail("HLS 播放列表嵌套过多");
  const playlist=await safeBytes(input,budget);
  if (playlist.bytes.length > 2_000_000) throw fail("HLS 清单过大");
  const lines=playlist.bytes.toString("utf8").trim().split(/\r?\n/);
  if (lines[0] !== "#EXTM3U") throw fail("视频地址未返回 HLS 清单");
  const variant=lines.findIndex(l=>l.startsWith("#EXT-X-STREAM-INF:"));
  if (variant>=0) {
    const uri=lines.slice(variant+1).find(l=>l && !l.startsWith("#"));
    if (!uri) throw fail("HLS 缺少视频分支");
    return hlsLocal(new URL(uri,playlist.url).href,dir,budget,progress,depth+1);
  }
  if (!lines.some(l=>l.trim()==="#EXT-X-ENDLIST")) throw fail("暂不下载直播流，请选择已结束的点播视频");
  if (lines.some(l=>l.startsWith("#EXT-X-KEY:") && !l.includes("METHOD=NONE"))) throw fail("不下载加密视频，请使用有权下载的原文件");
  if (lines.some(l=>l.startsWith("#EXT-X-BYTERANGE") || l.includes("BYTERANGE="))) throw fail("暂不支持按字节分段的 HLS，请上传 MP4");
  if (lines.filter(l=>l && !l.startsWith("#")).length>600) throw fail("视频分片超过600段，请使用较短素材");
  let count=0;
  const result=[];
  for (const line of lines) {
    if (line.startsWith("#EXT-X-MAP:")) {
      const uri=line.match(/URI="([^"]+)"/)?.[1];
      if (!uri) throw fail("HLS 初始化分片无效");
      const init=await safeBytes(new URL(uri,playlist.url).href,budget);
      const name="init-"+count+++".mp4"; await writeFile(path.join(dir,name),init.bytes);
      result.push('#EXT-X-MAP:URI="'+name+'"');
    } else if (line && !line.startsWith("#")) {
      const part=await safeBytes(new URL(line,playlist.url).href,budget);
      const name="part-"+count+++".ts"; await writeFile(path.join(dir,name),part.bytes);
      result.push(name); await progress(Math.min(85,10+count));
    } else if (/^#EXT(M3U|INF|-X-(TARGETDURATION|VERSION|MEDIA-SEQUENCE|DISCONTINUITY|ENDLIST|PLAYLIST-TYPE|INDEPENDENT-SEGMENTS))/.test(line)) result.push(line);
  }
  if (!count) throw fail("HLS 没有可下载视频分片");
  const local=path.join(dir,"local.m3u8");
  await writeFile(local,result.join("\n")+"\n");
  return local;
}
function convert(args) {
  const ffmpeg=createRequire(import.meta.url)("ffmpeg-static");
  return new Promise((resolve,reject)=>{
    const child=spawn(ffmpeg,args,{stdio:["ignore","ignore","pipe"]});
    let tail=""; child.stderr.on("data",v=>tail=(tail+v).slice(-2000));
    const timer=setTimeout(()=>child.kill("SIGKILL"),180000);
    child.on("error",e=>{clearTimeout(timer);reject(e);});
    child.on("close",code=>{clearTimeout(timer);code===0?resolve():reject(fail("视频封装失败，请换用 MP4 原文件。"+tail.slice(-250)));});
  });
}
export async function downloadJob(id) {
  if (!validId(id)) throw fail("下载任务编号无效");
  const dir=path.join(libraryRoot,"downloads",id), file=path.join(dir,"record.json");
  let job=await readJson(file);
  const update=async(fields)=>{job={...job,...fields,updatedAt:Date.now()};await atomicJson(file,job);};
  try {
    await update({status:"downloading",progress:5});
    const budget={left:250_000_000};
    const staging=path.join(dir,"parts"); await mkdir(staging,{recursive:true});
    let extension;
    if (/\.m3u8(?:[?#]|$)/i.test(job.sourceUrl)) {
      const local=await hlsLocal(job.sourceUrl,staging,budget,(progress)=>update({progress}));
      await convert(["-hide_banner","-loglevel","error","-y","-protocol_whitelist","file","-allowed_extensions","ALL","-i",local,"-map","0:v:0","-map","0:a?","-c","copy","-movflags","+faststart",path.join(dir,"pending.mp4")]);
      extension="mp4";
    } else {
      const media=await safeBytes(job.sourceUrl,budget);
      if(job.type==="image") {
        extension=media.type.includes("png")?"png":media.type.includes("webp")?"webp":media.type.includes("jpeg")?"jpg":null;
        if(!extension) throw fail("返回内容不是支持的 JPG/PNG/WebP 图片");
        await writeFile(path.join(dir,"pending."+extension),media.bytes);
      } else {
        if(media.type.includes("text/")||media.type.includes("html")) throw fail("链接不是可直接下载的视频");
        await writeFile(path.join(staging,"source.bin"),media.bytes);
        await convert(["-hide_banner","-loglevel","error","-y","-protocol_whitelist","file","-i",path.join(staging,"source.bin"),"-map","0:v:0","-map","0:a?","-c","copy","-movflags","+faststart",path.join(dir,"pending.mp4")]);
        extension="mp4";
      }
    }
    await rename(path.join(dir,"pending."+extension),path.join(dir,"media."+extension));
    const size=(await stat(path.join(dir,"media."+extension))).size;
    await update({status:"completed",progress:100,file:"media."+extension,size,error:""});
  } catch(error) {await update({status:"failed",error:error.message,progress:0});}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A bounded worker never calls a paid model; partial files are not exposed.
  const watchdog=setTimeout(()=>process.exit(1),15*60*1000);
  downloadJob(process.argv[2]).finally(()=>clearTimeout(watchdog));
}
