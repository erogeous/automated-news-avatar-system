// Discovery uses public feeds/pages only. No model calls or paid API.
export const NEWS_SOURCES = [
  { id:'techcrunch',name:'TechCrunch',region:'国外',category:'tech',kind:'rss',url:'https://techcrunch.com/feed/',host:'techcrunch.com' },
  { id:'verge',name:'The Verge',region:'国外',category:'tech',kind:'rss',url:'https://www.theverge.com/rss/index.xml',host:'theverge.com' },
  { id:'ars',name:'Ars Technica',region:'国外',category:'tech',kind:'rss',url:'https://feeds.arstechnica.com/arstechnica/index',host:'arstechnica.com' },
  { id:'ithome',name:'IT之家',region:'国内',category:'tech',kind:'rss',url:'https://www.ithome.com/rss/',host:'ithome.com' },
  { id:'qbit',name:'量子位',region:'国内',category:'tech',kind:'html',url:'https://www.qbitai.com/',host:'qbitai.com',path:/\/\d{4}\/\d{2}\// },
  { id:'sspai',name:'少数派',region:'国内',category:'tech',kind:'rss',url:'https://sspai.com/feed',host:'sspai.com' },
  { id:'cctv',name:'央视新闻',region:'国内',category:'society',kind:'html',url:'https://news.cctv.com/',host:'cctv.com',path:/\/\d{4}\/\d{2}\/\d{2}\/.*\.shtml/ },
  { id:'chinanews',name:'中国新闻网',region:'国内',category:'society',kind:'html',url:'https://www.chinanews.com.cn/',host:'chinanews.com.cn',path:/\/\d{4}\/\d{2}-\d{2}\/.*\.shtml/ },
  { id:'xinhua',name:'新华网',region:'国内',category:'society',kind:'html',url:'https://www.news.cn/',host:'news.cn',path:/\/\d{8}\/.*\.(?:html|htm)/ },
];
export function cleanText(text='') {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,' ').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,v)=> {
    const map={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
    if(v.startsWith('#')) { const n=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):parseInt(v.slice(1),10); return n>0&&n<=0x10ffff?String.fromCodePoint(n):' '; }
    return map[v.toLowerCase()]||' ';
  }).replace(/\s+/g,' ').trim();
}
function canonical(raw,source) {
  try {
    const url=new URL(cleanText(raw),source.url);
    if(url.protocol!=='https:'&&url.protocol!=='http:')return '';
    if(url.hostname!==source.host&&!url.hostname.endsWith('.'+source.host))return '';
    if(url.username||url.password)return '';
    url.hash='';
    for(const key of [...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/.test(key))url.searchParams.delete(key);
    return url.href;
  }catch{return '';}
}
export function parseSource(body,source) {
  const items=[]; const seen=new Set();
  const add=(title,raw,date='')=>{
    title=cleanText(title).slice(0,220);const url=canonical(raw,source);
    if(!url||title.length<8||seen.has(url))return;
    seen.add(url); const time=Date.parse(cleanText(date));
    items.push({id:url,title,url,source:source.name,sourceId:source.id,region:source.region,category:source.category,publishedAt:Number.isFinite(time)?new Date(time).toISOString():null});
  };
  if(source.kind==='rss') {
    for(const match of body.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const entry=match[2];const tag=(name)=>entry.match(new RegExp('<'+name+'\\b[^>]*>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1]||'';
      const links=[...entry.matchAll(/<link\b([^>]*?)\/?\s*>/gi)];
      const alternate=links.find(m=>!/rel=["'](?:self|enclosure)["']/i.test(m[1])&&/href=/i.test(m[1]));
      add(tag('title'),alternate?.[1].match(/href=["']([^"']+)["']/i)?.[1]||tag('link'),tag('pubDate')||tag('published')||tag('updated'));
    }
  } else {
    for(const match of body.matchAll(/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi)) {
      const href=match[1].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
      if(!href||!source.path.test(href))continue;
      const title=match[1].match(/title\s*=\s*["']([^"']+)["']/i)?.[1]||match[2];
      const date=href.match(/\/(20\d{2})\/(\d{2})[-/](\d{2})\//)||href.match(/\/(20\d{2})(\d{2})(\d{2})\//);
      add(title,href,date?`${date[1]}-${date[2]}-${date[3]}T00:00:00+08:00`:'');
    }
  }
  return items.slice(0,30);
}
function similarity(a,b) {
  const tokens=s=>new Set(s.toLowerCase().match(/[a-z0-9]{2,}|[\p{Script=Han}]{2,}/gu)?.flatMap(w=>/\p{Script=Han}/u.test(w)?Array.from({length:w.length-1},(_,i)=>w.slice(i,i+2)):[w])||[]);
  const x=tokens(a),y=tokens(b);let overlap=0;for(const t of x)if(y.has(t))overlap++;
  return overlap/Math.max(1,x.size+y.size-overlap);
}
export function groupItems(items,now=Date.now()) {
  const groups=[];
  for(const item of items) {
    if(item.publishedAt && now-Date.parse(item.publishedAt)>7*86400000)continue;
    let group=groups.find(g=>g.links.some(l=>l.url===item.url)||similarity(g.title,item.title)>.72);
    if(group) {if(!group.links.some(l=>l.url===item.url))group.links.push(item);}
    else groups.push({...item,links:[item]});
  }
  const ranked = groups.map(g=>({...g,score:(g.category==='tech'?40:10)+(/\bAI\b|人工智能|大模型|智能体|OpenAI|Claude|Gemini|DeepSeek|机器人|算力/i.test(g.title)?25:0)+(g.publishedAt?Math.max(0,24-(now-Date.parse(g.publishedAt))/3600000):0)+Math.min(10,(new Set(g.links.map(l=>l.sourceId)).size-1)*5)})).sort((a,b)=>b.score-a.score);
  const takeCategory=(category,limit)=>{
    const pool=ranked.filter(g=>g.category===category),seenSources=new Set(),chosen=[];
    for(const item of pool)if(!seenSources.has(item.sourceId)){chosen.push(item);seenSources.add(item.sourceId);}
    const taken=new Set(chosen.map(i=>i.id));
    for(const item of pool){if(chosen.length>=limit)break;if(!taken.has(item.id)){chosen.push(item);taken.add(item.id);}}
    return chosen.slice(0,limit);
  };
  const selected=[...takeCategory('tech',80),...takeCategory('society',20)];
  const ids=new Set(selected.map(g=>g.id));
  for(const item of ranked){if(selected.length>=100)break;if(!ids.has(item.id)){selected.push(item);ids.add(item.id);}}
  return selected.sort((a,b)=>b.score-a.score);
}
const lastGood=new Map();let cache;let pending;
async function fetchSource(source) {
  const response=await fetch(source.url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'Mozilla/5.0 NewsAvatarWorkbench/1.0',Accept:'application/rss+xml,application/atom+xml,text/html,application/xml'}});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const reader=response.body.getReader();let size=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>3_000_000){await reader.cancel();throw new Error('页面超过采集上限');}chunks.push(value);}
  const bytes=Buffer.concat(chunks);const charset=response.headers.get('content-type')?.match(/charset=([^;\s]+)/i)?.[1]||bytes.toString('ascii',0,1500).match(/charset=["']?([\w-]+)/i)?.[1]||'utf-8';
  const items=parseSource(new TextDecoder(charset).decode(bytes),source);
  if(!items.length)throw new Error('入口可访问，但未识别到文章；需检查订阅或页面结构');
  return items;
}
export async function getHotspots() {
  if(cache&&Date.now()-cache.fetchedAt<15*60000)return cache;
  if(pending)return pending;
  pending=(async()=>{
    const sources=await Promise.all(NEWS_SOURCES.map(async source=>{
      try {const items=await fetchSource(source);lastGood.set(source.id,{items,at:Date.now()});return {id:source.id,name:source.name,region:source.region,status:'ok',count:items.length,checkedAt:Date.now()};}
      catch(error){const old=lastGood.get(source.id);return {id:source.id,name:source.name,region:source.region,status:old?'stale':'failed',count:old?.items.length||0,checkedAt:Date.now(),error:error.message};}
    }));
    const items=sources.flatMap(s=>(lastGood.get(s.id)?.items||[]).map(i=>({...i,stale:s.status!=='ok'})));
    cache={fetchedAt:Date.now(),sources,items:groupItems(items),note:'按公开报道聚合的候选选题；相似标题合并供参考，不代表平台热搜排名。未知日期需人工核实。'};return cache;
  })();
  try{return await pending;}finally{pending=undefined;}
}
