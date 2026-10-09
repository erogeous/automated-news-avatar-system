export const runtime = 'nodejs';
export async function GET(request: Request) {
 if(!['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname))return new Response('项目文件索引仅供本机访问',{status:403});
 const response=await fetch(`http://127.0.0.1:${process.env.MEDIA_SERVICE_PORT || 3101}/project-files`,{cache:'no-store'});
 return new Response(await response.text(),{status:response.status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
