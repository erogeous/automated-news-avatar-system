// Validate the personal vertical timeline before starting FFmpeg.
export function parseSrt(text, duration) {
  if (!text.trim()) return [];
  if (text.length > 100000) throw new Error('字幕超过长度上限');
  const time = value => {const [h,m,s,ms]=value.split(/[:,.]/).map(Number);return h*3600+m*60+s+ms/1000;};
  let previous=0;
  return text.replace(/\r/g,'').trim().split(/\n\s*\n/).map((block,index)=>{
    const lines=block.trim().split('\n');
    if(/^\d+$/.test(lines[0]))lines.shift();
    const match=lines.shift()?.match(/^(\d{2}:[0-5]\d:[0-5]\d[,.]\d{3})\s*-->\s*(\d{2}:[0-5]\d:[0-5]\d[,.]\d{3})$/);
    if(!match||!lines.join('').trim())throw new Error(`第 ${index+1} 条字幕格式无效`);
    const start=time(match[1]),end=time(match[2]);
    if(start<previous-.001||end<=start||end>duration+.1)throw new Error(`第 ${index+1} 条字幕时间重叠、倒序或超过配音长度`);
    previous=end;return {start,end,text:lines.join('\n')};
  });
}
export function validateCreatorComposition(body) {
  if (body.mode !== 'creator') return;
  const duration=body.audioDuration;
  if(body.layout!=='portrait'||!Number.isFinite(duration)||duration<=0||duration>600)throw new Error('竖屏配音时长必须在 0–600 秒之间');
  if(!Array.isArray(body.avatarSegments)||!body.avatarSegments.length||body.avatarSegments.length>60)throw new Error('请提供数字人片段');
  if(!Array.isArray(body.scenes)||body.scenes.length>60)throw new Error('分镜数量无效');
  const intervals=[];
  const validRange=(start,end)=>Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&end<=duration+.1;
  const scenes=[...body.scenes].sort((a,b)=>a.start-b.start);
  let sceneEnd=0;
  for(const scene of scenes) {
    const end=scene.start+scene.duration;
    if(!['image','video'].includes(scene.type)||!validRange(scene.start,end))throw new Error('补充画面起止时间无效或超出配音长度');
    if(scene.start<sceneEnd)throw new Error('补充画面时间重叠，请调整开始时间');
    sceneEnd=end;intervals.push([scene.start,end]);
  }
  for(const avatar of body.avatarSegments){if(!validRange(avatar.start,avatar.end))throw new Error('数字人片段时间无效');intervals.push([avatar.start,avatar.end]);}
  intervals.sort((a,b)=>a[0]-b[0]);let covered=0;
  for(const [start,end] of intervals){if(start>covered+.1)throw new Error(`第 ${covered.toFixed(1)} 秒起缺少画面，请补充素材或选择相应数字人片段`);covered=Math.max(covered,end);}
  if(covered<duration-.1)throw new Error('结尾缺少画面，请补充素材或数字人片段');
  if(typeof body.subtitles!=='string')throw new Error('字幕格式无效');
  parseSrt(body.subtitles,duration);
  body.title=String(body.title||'').slice(0,40);
}
const assTime=s=>{const cs=Math.round(s*100);return `${Math.floor(cs/360000)}:${String(Math.floor(cs/6000)%60).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;};
const assText=s=>s.replace(/<[^>]*>/g,'').replace(/[{}\\]/g,'').replace(/\r/g,'').split('\n').flatMap(line=>line.match(/.{1,18}/gu)||[]).join('\\N');
export function creatorAss(input) {
  const cues=parseSrt(input.subtitles||'',input.audioDuration);
  const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,PingFang SC,52,&H00FFFFFF,&H00FFFFFF,&H00151515,&H80000000,0,0,0,0,100,100,1,0,1,3,1,2,80,160,320,1\nStyle: Title,PingFang SC,58,&H00FFFFFF,&H00FFFFFF,&H00151515,&H80000000,-1,0,0,0,100,100,1,0,1,3,1,8,80,160,170,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const lines=cues.map(c=>`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${assText(c.text)}`);
  if(input.title)lines.push(`Dialogue: 1,0:00:00.00,${assTime(Math.min(5,input.audioDuration))},Title,,0,0,0,,${assText(input.title)}`);
  return header+lines.join('\n')+'\n';
}

export function newsAss(input, fontName='Noto Sans CJK TC') {
  const cues=parseSrt(input.subtitlesSrt||'',input.audioDuration);
  const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,${fontName},48,&H00FFFFFF,&H00FFFFFF,&H00101010,&H78000000,0,0,0,0,100,100,1,0,1,3,1,2,180,180,54,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header+cues.map(c=>`Dialogue: 3,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${assText(c.text)}`).join('\n')+'\n';
}
