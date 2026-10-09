import path from 'node:path';
import { libraryRoot, readJson, atomicJson, exclusive, fail } from './studio-library.mjs';
export const DEFAULT_PROFILE = { name: '我的主播', voiceId: '', portrait: '', style: '直接进入重点，先说发生了什么，再解释对普通人的影响。表达自然、清楚、有依据，不夸大，不编造个人经历。', speed: 1 };
const file = () => path.join(libraryRoot, 'creator', 'profile.json');
export async function getCreatorProfile() {
  try { return { ...DEFAULT_PROFILE, ...await readJson(file()) }; }
  catch (error) { if (error.code === 'ENOENT') return { ...DEFAULT_PROFILE }; throw error; }
}
export async function saveCreatorProfile(input) {
  const name = String(input.name || '').trim().slice(0, 30);
  const voiceId = String(input.voiceId || '').trim();
  const portrait = String(input.portrait || '').trim();
  if (!name) throw fail('请填写主播名称');
  if (voiceId && !/^[a-zA-Z0-9_-]{1,160}$/.test(voiceId)) throw fail('音色 ID 格式无效');
  if (portrait && !/^\/api\/media\/library\/downloads\/[a-f0-9]{32}\/file$/.test(portrait)) throw fail('请从本地素材库上传主播照片');
  if (portrait) {
    const id = portrait.split('/').at(-2);
    const asset = await readJson(path.join(libraryRoot, 'downloads', id, 'record.json'));
    if (asset.type !== 'image' || asset.status !== 'completed') throw fail('主播形象必须是已入库的图片');
  }
  const profile = { name, voiceId, portrait, style: String(input.style || '').trim().slice(0, 6000), speed: Math.max(.8, Math.min(1.2, Number(input.speed) || 1)), updatedAt: Date.now() };
  await exclusive(() => atomicJson(file(), profile));
  return profile;
}
