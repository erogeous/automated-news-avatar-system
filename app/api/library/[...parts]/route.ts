const service = `http://127.0.0.1:${process.env.MEDIA_SERVICE_PORT || 3101}`;
async function proxy(request: Request, context: { params: Promise<{ parts: string[] }> }) {
  try {
    const { parts } = await context.params;
    if (!parts.length || parts.some((part) => !/^[a-z0-9-]+$/.test(part))) return Response.json({ error: "路径无效" }, { status: 400 });
    const origin = request.headers.get("origin");
    if (request.method === "POST" && origin && origin !== new URL(request.url).origin) return Response.json({error:"不允许跨站写入"}, {status:403});
    let body: Uint8Array | undefined;
    if (request.method === "POST" && request.body) {
      const reader=request.body.getReader(), chunks: Uint8Array[]=[];
      let size=0;
      for (;;) { const {done,value}=await reader.read(); if(done)break; size+=value.length;
        if(size>5_000_000){await reader.cancel();return Response.json({error:"文件不得超过5MB"},{status:413});} chunks.push(value); }
      body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
    }
    const headers: Record<string,string> = {};
    for (const name of ["content-type","x-file-name","range"]) {const value=request.headers.get(name);if(value)headers[name]=value;}
    const upstream=await fetch(`${service}/library/${parts.join("/")}`,{method:request.method,headers,body:body as BodyInit | undefined,cache:"no-store"});
    const resultHeaders=new Headers();
    for(const name of ["content-type","content-length","content-range","accept-ranges","content-disposition"]) {const value=upstream.headers.get(name);if(value)resultHeaders.set(name,value);}
    resultHeaders.set("Cache-Control","no-store");
    return new Response(upstream.body,{status:upstream.status,headers:resultHeaders});
  } catch {
    return Response.json({error:"素材库服务暂不可用，请确认工作台已完整启动。"},{status:503});
  }
}
export const GET=proxy;
export const POST=proxy;
export const HEAD=proxy;
