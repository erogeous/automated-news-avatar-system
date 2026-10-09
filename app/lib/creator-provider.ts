export type CreatorProfile = { name: string; voiceId: string; portrait: string; style: string; speed: number };
export async function getCreatorProfile(): Promise<CreatorProfile> {
  const response = await fetch(`http://127.0.0.1:${process.env.MEDIA_SERVICE_PORT || 3101}/creator/profile`, { cache: "no-store" });
  if (!response.ok) throw new Error("无法读取我的主播档案，请检查媒体服务");
  return response.json();
}
export async function creatorVoice(voiceId: unknown) {
  const profile = await getCreatorProfile();
  if (!profile.voiceId) throw new Error("个人音色尚未接入，请先在我的主播中配置 MiniMax 音色 ID");
  if (voiceId !== profile.voiceId) throw new Error("主播音色已变更，请重新载入主播档案后生成配音");
  return profile;
}
