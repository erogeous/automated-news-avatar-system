import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../dist/server/index.js';
async function render(route) {
  const response=await worker.fetch(new Request('http://localhost'+route,{headers:{accept:'text/html'}}),{ASSETS:{fetch:async()=>new Response('Not found',{status:404})}},{waitUntil(){},passThroughOnException(){}});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type')||'',/text\/html/);
  return response.text();
}
test('original studio is isolated from the personal app',async()=>{
  const html=await render('/');
  assert.ok(html.includes('新闻数字人工作台'));
  assert.ok(html.includes('梁正言'));
  assert.doesNotMatch(html,/个人数字人工作台|把热点，讲成你的观点/);
});
test('legacy studio and history remain accessible',async()=>{
  const legacy=await render('/hongkong');assert.ok(legacy.includes('新闻数字人工作台'));assert.ok(legacy.includes('梁正言'));
  const library=await render('/library');assert.ok(library.includes('内容与规则库'));
});
