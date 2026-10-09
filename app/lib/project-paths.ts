import path from 'node:path';
export function projectMediaPath(kind: 'audio-slices'|'composition-jobs'|'avatar-outputs') {
 const root=process.cwd();const custom=process.env.STUDIO_DATA_DIR?path.resolve(process.env.STUDIO_DATA_DIR):root;
 if(custom!==root&&custom!==path.join(root,'data'))return path.join(custom,kind);
 const routes={'audio-slices':'03_过程产物/程序音频','composition-jobs':'04_待审阅/程序合片','avatar-outputs':'03_过程产物/数字人片段'};
 return path.join(root,'项目资料',routes[kind]);
}
