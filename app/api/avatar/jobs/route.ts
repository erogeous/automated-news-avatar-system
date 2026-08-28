function remoteConfig() {
  const baseUrl = process.env.INFINITETALK_API_URL?.replace(/\/+$/, "");
  const token = process.env.INFINITETALK_API_TOKEN;
  if (!baseUrl || !token) throw new Error("远程 InfiniteTalk 服务尚未配置");
  return { baseUrl, token };
}

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const image = incoming.get("image");
    const audio = incoming.get("audio");
    const anchorId = incoming.get("anchor_id");
    if (!(image instanceof File) || !(audio instanceof File) || typeof anchorId !== "string") {
      return Response.json({ error: "缺少主播图片、音频或主播编号" }, { status: 400 });
    }
    const uploadBytes = image.size + audio.size;
    if (uploadBytes > 900_000) {
      return Response.json(
        { error: "当前音频文件较大，请返回上一步重新生成配音后再提交数字人" },
        { status: 413 },
      );
    }
    const { baseUrl, token } = remoteConfig();
    const outgoing = new FormData();
    outgoing.set("image", image, image.name || "anchor.png");
    outgoing.set("audio", audio, audio.name || "voice.mp3");
    outgoing.set("anchor_id", anchorId);
    outgoing.set("prompt", "A professional Hong Kong news anchor speaking calmly and directly to camera.");
    const response = await fetch(`${baseUrl}/v1/jobs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: outgoing,
    });
    const responseText = await response.text();
    let data: Record<string, unknown>;
    try {
      data = responseText ? JSON.parse(responseText) as Record<string, unknown> : {};
    } catch {
      data = {
        error: response.status === 413 || /payload too large/i.test(responseText)
          ? "上传文件超过远程服务限制，请返回上一步重新生成配音"
          : `远程数字人服务返回了无法识别的内容（HTTP ${response.status}）`,
      };
    }
    if (!response.ok && !data.error) {
      data.error = response.status === 413
        ? "上传文件超过远程服务限制，请返回上一步重新生成配音"
        : response.status === 404
          ? "RunPod Worker 地址已失效或服务未启动，请更新当前 Pod 的 HTTP Service 8080 地址"
          : `数字人任务提交失败（HTTP ${response.status}）`;
    }
    return Response.json(data, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "数字人任务提交失败" }, { status: 502 });
  }
}
