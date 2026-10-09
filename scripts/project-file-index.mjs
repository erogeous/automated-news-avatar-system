import {listProjectFiles} from './project-files.mjs';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();const index=await listProjectFiles(root);await writeFile(path.join(root,'项目资料/00_说明与接续/程序文件索引.json'),JSON.stringify(index,null,2));console.log(index.files.length+' files indexed');
