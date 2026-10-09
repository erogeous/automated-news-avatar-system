# 个人数字人竖屏工作台 V1

2026-10-01。本机版本，复用原《點觀香港》的文本模型、MiniMax、HeyGen 及媒体服务配置。未增加供应商、密钥或云部署。

## 入口与流程

- `/`：个人工作台。热点或手动链接 → 阅读并勾选正文 → 普通话写稿/手动稿 → 确认 → 个人音色配音 → 试听/30 秒切片 → HeyGen → 1080×1920 合片。
- `/hongkong`：原工作台。旧项目和旧粤语调用路径继续保留。
- `/library`：共用历史与素材库，按项目类型进入相应工作台。
- `/settings`：继续使用已有 API 配置。

公开信源：TechCrunch、The Verge、Ars Technica、IT之家、量子位、少数派、央视新闻、中国新闻网、新华网。优先科技/AI，候选池为社会内容预留约 20% 位置。入口缓存 15 分钟，来源失败单独显示，不影响手动链接。个人版正文读取要求足够的文字段落，图集、视频页、访问限制页面提示更换链接；入口成功不代表每篇文章都能抓取。相似标题合并仅为辅助，未调用模型做跨语言事件识别，也不等同于平台热搜榜。

## 主播档案

首页右上角「我的主播」保存姓名、MiniMax 个人音色 ID、语速、竖版照片和个人表达规则。文件位于现有 `STUDIO_LIBRARY_DIR`（默认 `.studio-library`）的 `creator/profile.json`。照片仍走已有素材上传接口。

声音样本尚未提供，因此未执行声音克隆，也没有把默认预设音色冒充个人克隆音色。用户提供音源后，在现有 MiniMax 账户/通道完成克隆并绑定音色 ID。该 ID 必须能被当前配音通道访问；是否开放克隆及其调用形式须届时核对账户能力。形象接入现有 HeyGen 图片驱动方式，不等于真人视频训练型分身。

未配置声音时可以选题和写稿，配音按钮不可用；未配置照片时不可提交数字人。每次配音保存当时的主播档案快照。修改稿件/档案会清理当前下游引用，旧项目版本仍可在历史库查找。

## 竖屏合片

- 1080×1920，完整配音为唯一音频主轨；主播与全屏素材按时间段切换。
- 横向图片/视频使用模糊背景填充，前景完整显示。
- 标题在前 5 秒显示，字幕为简体中文，位置避开画面底部和右侧。
- SRT 初稿按字数估算，需人工试听校时后确认，可粘贴精确 SRT 或清空后确认无字幕版本。没有新增 ASR API；尚未实现自动精确对齐。
- 合片前校验分镜越界、重叠、字幕时间以及无画面空档。
- 当前数字人状态轮询依赖页面打开，重新打开项目后恢复轮询；FFmpeg 子进程提交后在本机继续运行。电脑/服务需保持运行。

## 核心文件

- `app/components/creator-studio.tsx`、`app/creator.css`：个人工作台。
- `scripts/hotspots.mjs`：公开信源采集、缓存、排序及相似标题合并。
- `scripts/creator-profile.mjs`：档案校验与持久化。
- `app/lib/openiapi.ts`：新增个人写稿函数，配音函数增加普通话参数，沿用原配置。
- `scripts/creator-composition.mjs`：个人时间线校验和 ASS 字幕。
- `scripts/composition-worker.mjs`：共用 FFmpeg 合成。
- `app/legacy-studio.tsx`：本次改版前的工作台保留。

## 验证

```sh
node node_modules/typescript/bin/tsc -p tsconfig.app.json
node scripts/test-creator.mjs
node scripts/test-studio-library.mjs
node scripts/test-creator-render.mjs
npm run build
node --test tests/rendered-html.test.mjs
```

Provider 测试使用假密钥与内存响应，不调用真实模型。合片测试在临时目录生成测试音画。`tsconfig.app.json` 检查应用代码；仓库根 TypeScript 配置还包含旧 release 副本与未配置的 Cloudflare 类型，不适合作为本次应用代码的独立检查。
