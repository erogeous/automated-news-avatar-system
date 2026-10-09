import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
const ffmpeg=createRequire(import.meta.url)('ffmpeg-static');
const root=await mkdtemp(path.join(os.tmpdir(),'creator-render-'));
const audioId='a'.repeat(32);const jobDir=path.join(root,'job');const audioDir=path.join(root,'audio-slices',audioId);
await mkdir(jobDir,{recursive:true});await mkdir(audioDir,{recursive:true});
async function run(command,args,env=process.env){return new Promise((resolve,reject)=>{const child=spawn(command,args,{env});let output='';child.stderr.on('data',c=>output+=c);child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error(output)));});}
await run(ffmpeg,['-y','-f','lavfi','-i','sine=frequency=440:duration=4','-c:a','libmp3lame',path.join(audioDir,'source.mp3')]);
await run(ffmpeg,['-y','-f','lavfi','-i','color=c=0x244d41:s=360x640:d=4','-c:v','libx264','-pix_fmt','yuv420p',path.join(root,'avatar.mp4')]);
await run(ffmpeg,['-y','-f','lavfi','-i','color=c=0x608978:s=640x360','-frames:v','1',path.join(root,'scene.jpg')]);
const server=http.createServer(async(req,res)=>{const file=req.url==='/avatar.mp4'?'avatar.mp4':'scene.jpg';res.end(await readFile(path.join(root,file)));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 const base=`http://127.0.0.1:${server.address().port}`;
 await writeFile(path.join(jobDir,'input.json'),JSON.stringify({mode:'creator',layout:'portrait',audioJobId:audioId,audioDuration:4,avatarSegments:[{url:base+'/avatar.mp4',start:0,end:4}],scenes:[{url:base+'/scene.jpg',type:'image',start:1,duration:2}],subtitles:'1\n00:00:00,000 --> 00:00:04,000\n普通话竖屏字幕测试\n',title:'科技与 AI 观察',packagingAssets:[]}));
 await writeFile(path.join(jobDir,'job.json'),'{}');
 await run(process.execPath,[path.resolve('scripts/composition-worker.mjs'),jobDir],{...process.env,STUDIO_DATA_DIR:root});
 const job=JSON.parse(await readFile(path.join(jobDir,'job.json'),'utf8'));assert.equal(job.status,'completed');
 const output=await run(ffmpeg,['-i',path.join(jobDir,'final.mp4'),'-f','null','-']);assert.match(output,/1080x1920/);assert.match(output,/Audio: aac/);
 await run(ffmpeg,['-y','-ss','1.5','-i',path.join(jobDir,'final.mp4'),'-frames:v','1',path.join(root,'preview.png')]);
 console.log('PASS: synthetic 4-second 1080x1920 video, narration, B-roll, Chinese title and captions. No model calls.');console.log('Preview: '+path.join(root,'preview.png'));
}finally{server.close();}
