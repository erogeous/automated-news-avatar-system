import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const projectRoot=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const routes={'audio-slices':'03_过程产物/程序音频','composition-jobs':'04_待审阅/程序合片','avatar-outputs':'03_过程产物/数字人片段','auto-edit-jobs':'03_过程产物/自动剪辑任务'};
export function mediaPath(dataRoot,kind){
 const base=path.resolve(dataRoot);
 if(!routes[kind])throw Error('未知媒体类型');
 if(base!==projectRoot&&base!==path.join(projectRoot,'data'))return path.join(base,kind);
 return path.join(projectRoot,'项目资料',routes[kind]);
}
