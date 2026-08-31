# 自动化新闻数字人系统技术文档

版本：V2.0  
更新日期：2026-08-31  
适用对象：产品、开发、运维、内容编辑  
当前推荐数字人通道：HeyGen Image-to-Video API

## 1. 项目定位

本系统是一套独立的新闻数字人生产工作台。编辑录入 1–10 条新闻链接，系统提取正文与媒体素材，按照《点观香港》新闻口播写稿 SOP V4.1 和本期人工提示词，生成约 4 分钟的香港粤语口播稿。稿件经人工修改确认后，系统按排班主播绑定固定粤语音色，生成完整配音，再切分为适合数字人接口的音频片段。选定片段生成数字人口播视频，最终由 FFmpeg 将数字人片段、完整配音主轨、新闻图片/视频及固定栏目包装合成为第一版成片。

系统强调“自动化执行 + 人工确认”，而不是不可干预的一键黑盒。新闻、稿件、配音、数字人和合片均保留可检查、可重试、可回溯的阶段。

## 2. 当前业务流程

1. 创建本期任务，输入名称、1–10 条新闻链接、本期写稿要求，并在第一页选择排班主播。
2. 后台读取新闻正文，同时提取新闻页中的图片和视频候选素材。
3. 本期人工要求优先，其次读取 SOP V4.1，再结合新闻事实生成约 4 分钟粤语口播稿。
4. 编辑人工修改并确认母稿；系统清除思考标签、Markdown、写作说明等不可朗读内容。
5. 根据主播自动绑定固定男声或女声，生成完整粤语配音并试听确认。
6. FFmpeg 将完整音频自动切为短片段，默认约 28 秒且不超过数字人服务限制；编辑选择需要主播出镜的片段。
7. 将主播图片和所选音频片段经受限公网传输交给 HeyGen，异步轮询生成状态并取回 MP4。
8. 编辑选择新闻素材并调整分镜顺序，同时选择固定包装资产。
9. FFmpeg 依据时间轴合成：完整配音始终作为唯一主音轨；数字人片段与新闻素材作为画面层；新闻素材原声默认静音。
10. 输出横屏 16:9 成片；竖屏 9:16 保留为可选输出。

## 3. 总体架构

```text
浏览器工作台
  -> 工作台服务端 API
     -> 新闻抓取/媒体提取
     -> OpenAI 兼容聚合接口（写稿、粤语 TTS）
     -> 音频切片与本地任务存储
     -> Vercel 受限网关 -> HeyGen API
     -> FFmpeg 合片 Worker
  -> 本地/对象存储：主播、音频、数字人视频、新闻素材、成片
```

### 3.1 前端工作台

- React 19 + TypeScript + Vinext/Vite。
- 主页面 `app/page.tsx` 管理新闻输入、主播选择、母稿、配音、音频切片、数字人、素材库、分镜和合片交互。
- 所有第三方密钥只由服务端读取，浏览器不持有供应商密钥。

### 3.2 服务端 API

- `POST /api/news/extract`：新闻正文与媒体候选提取。
- `POST /api/scripts/generate`：生成母稿。
- `POST /api/scripts/cantonese`：香港粤语表达处理。
- `POST /api/voice/generate`：生成完整正式配音。
- `POST /api/audio/slices`：切分音频并返回片段元数据。
- `POST /api/avatar/jobs`：提交数字人任务。
- `GET /api/avatar/jobs/:id`：查询数字人任务。
- `POST /api/compositions/jobs`：创建 FFmpeg 合片任务。
- `GET /api/compositions/jobs/:id`：查询合片状态。
- `GET /api/compositions/jobs/:id/download`：下载成片。

### 3.3 外部能力

- 文稿和配音：OpenAI 兼容聚合接口 `https://openiapi.com/v1`。
- 当前 TTS：`speech-2.8-hd`，固定男女粤语音色；`MiniMax-Voice-Clone` 仅用于授权音色克隆/管理，不应每期重复克隆。
- 当前数字人：HeyGen Image-to-Video API `/v3/videos`。
- 网关：Vercel Serverless Function，生产别名 `https://vercel-gateway-alpha.vercel.app`。
- 合片：本地 FFmpeg Worker，后续可迁移到云端任务执行器。

## 4. 数据与状态设计

建议以任务为中心建立持久化数据模型：

- `Project`：本期名称、目标时长、排班主播、当前阶段。
- `SourceArticle`：URL、标题、来源、日期、正文、提取状态、媒体候选。
- `ScriptVersion`：母稿版本、提示词快照、SOP 版本、字数、确认状态。
- `VoiceRender`：稿件版本、主播音色、音频地址、时长、状态。
- `AudioSlice`：完整音频 ID、片段序号、起止时间、时长、是否生成数字人。
- `AvatarRender`：音频片段、主播图片、供应商、任务 ID、视频地址、状态。
- `MediaAsset`：新闻来源、媒体类型、本地/远端地址、授权/可用状态。
- `StoryboardItem`：时间轴顺序、入点、出点、画面类型、对应素材。
- `CompositionJob`：时间轴快照、包装资产、FFmpeg 参数、输出与错误。

核心状态机：

```text
sources_ready -> script_draft -> script_approved
-> voice_rendering -> voice_ready -> slices_ready
-> avatar_rendering -> avatar_ready
-> storyboard_ready -> composing -> completed
```

外部任务统一使用 `queued -> running -> completed | failed | timed_out`。付费任务需增加幂等键，避免重试造成重复计费。

## 5. 写稿规则与优先级

提示词由三层组成：

1. 本期人工输入的具体要求，优先级最高。
2. 内置《点观香港》新闻口播写稿 SOP V4.1。
3. 系统通用安全与格式规则。

成稿必须只使用已提取或人工补充的事实；保留媒体、日期、人物、机构和数字信息；事实冲突时使用审慎表述，不允许模型自行补写。输出只保留可朗读正文，不得出现 `<think>`、写作提纲、Markdown 标题、注释或模型说明。主播姓名在第一页已确定，应在生成时直接写入，避免后续手改。

## 6. 主播与粤语配音

系统维护两套香港青年主播资产：青年男主播和青年女主播，职业套装、正面播报。每个主播绑定稳定的 `anchor_id`、主图、横屏构图参数、默认粤语 `voice_id`、授权记录与状态。

正式配音采用完整母稿一次生成，避免先切文本再合成导致语气和音色不连续。完成后再按时间切音频。当前 TTS 输出为 MP3，重点参数包括粤语增强、语速、采样率、码率及固定音色。长音频返回时，服务端应按二进制或文件 URL 处理，避免把大体积音频 Base64 嵌入 JSON 造成 `Payload Too Large`。

## 7. 音频切片与数字人时间轴

完整 4 分钟配音是最终成片的唯一主音轨。音频切片只服务于数字人供应商的单次时长、上传大小和生成稳定性，不改变母带。

- 默认片长约 28 秒，接口校验不超过 30 秒。
- 优先在静音或自然停顿附近切分；若服务端限制为 15 秒，则为该供应商建立独立切片策略。
- 第一段通常要求主播连续出镜约 30 秒，因此供应商选择必须优先满足这一要求。
- 允许仅选择部分片段生成数字人，其余时段使用新闻图片/视频。
- 数字人结果按音频片段原始起止时间放回总时间轴，禁止简单首尾拼接后造成整体错位。

## 8. HeyGen 当前接入方案

### 8.1 请求模式

当前使用 HeyGen `/v3/videos` 的 Image-to-Video 模式：

```json
{
  "type": "image",
  "image": { "type": "url", "url": "<anchor_public_url>" },
  "audio_url": "<audio_slice_public_url>",
  "dimension": { "width": 1920, "height": 1080 },
  "quality": "1080p"
}
```

注意字段必须使用 `image` 对象，而不是旧式 `image_url`。图片与音频必须是 HeyGen 可直接访问的公网 HTTPS URL。

### 8.2 Vercel 受限网关

工作台不直接暴露 HeyGen API Key，而是调用 Vercel 网关。网关仅允许：

- `/health`
- `/v3/users/me`
- `/v3/videos`
- `/v3/videos/:id`

工作台使用 Bearer Token 访问网关，网关从 Vercel Secret 读取 `HEYGEN_API_KEY`，再以 `X-Api-Key` 调用 HeyGen。部署保护已关闭，但网关自身仍由 Bearer Token 与路径白名单保护。

### 8.3 已验证结果

真实链路已成功生成一段约 29.98 秒、1920x1080、25fps、H.264 + AAC 的男主播粤语视频。验证任务 ID 为 `e0dae53aee4459fdabb8506ee92d0fb6`，本地结果位于 `outputs/heygen-male-cantonese-test-e0dae53a.mp4`。这证明“主播图片 + 粤语音频 -> 公网资产 -> Vercel 网关 -> HeyGen -> MP4 返回”的主通路已经成立。

## 9. 新闻素材、包装与 FFmpeg 合片

新闻链接读取阶段同时提取 `og:image`、正文图片、视频标签和可发现的视频 URL。素材下载后生成缩略图、时长、尺寸、来源和内容哈希。编辑可勾选素材并调整分镜顺序。

固定包装素材库包括：横屏演播室背景、节目 Logo、主播人名条、片头占位及后续字幕/角标。数字人可使用绿幕素材，FFmpeg 支持 `chromakey`/`colorkey` 抠像；工作台已预留相似度和边缘柔化预览。主播位置、缩放、亮度和色彩需要作为模板参数保存，以解决人物偏下、曝光偏暗等问题。

合片原则：

- 完整粤语配音作为唯一主音轨，贯穿全片。
- 新闻视频默认去除原声，FFmpeg 可使用 `-an` 或只映射视频流。
- 数字人片段按原始时间轴覆盖到指定区间。
- 新闻图片使用轻微推拉/平移；视频按区间裁切、静音、缩放和补帧。
- 包装图层按固定 Z 轴叠加：背景 -> 新闻素材 -> 数字人 -> Logo/人名条 -> 字幕。
- 输出以 16:9 横屏为主，9:16 使用独立布局参数，不能简单裁切横屏成片。

## 10. 文件与模块职责

```text
app/page.tsx                         工作台 UI 与流程状态
app/api/news/extract/route.ts        新闻正文和媒体提取
app/api/scripts/generate/route.ts    母稿生成
app/api/scripts/cantonese/route.ts   粤语处理
app/api/voice/generate/route.ts      完整配音生成
app/api/audio/slices/route.ts        音频切片
app/api/avatar/jobs/route.ts         数字人任务提交
app/api/avatar/jobs/[id]/route.ts    数字人任务查询
app/api/compositions/jobs/           合片任务提交、查询、下载
scripts/public-asset-proxy.mjs       受限资产代理
scripts/composition-worker.mjs       FFmpeg 合片 Worker
scripts/local-media-server.mjs       本地媒体服务
vercel-gateway/api/gateway.js        HeyGen 受限网关
public/anchors/                      主播图片资产
outputs/                             测试音频、视频与合片产物
```

## 11. 配置与安全

环境变量只写变量名，不在文档、Git、浏览器或日志中保存真实值：

```dotenv
OPENIAPI_BASE_URL=
OPENIAPI_API_KEY=
LLM_MODEL=
TTS_MODEL=speech-2.8-hd
HEYGEN_GATEWAY_URL=
HEYGEN_GATEWAY_TOKEN=
HEYGEN_API_KEY=
PUBLIC_APP_BASE_URL=
PUBLIC_MEDIA_BASE_URL=
```

已在对话、截图或终端中暴露过的 API Key、AK/SK、密码都应立即吊销并重新生成。生产环境应使用对象存储签名 URL，限制 MIME、文件大小、路径和有效期；新闻抓取必须防 SSRF，重定向后重复校验目标；外部回调必须验签；付费模型请求应记录请求 ID、幂等键、供应商任务 ID、耗时和估算成本。

## 12. 当前可运行程度与已知缺口

已完成：工作台主界面、1–10 条链接、单链接即可生成、主播前置选择、本期提示词、SOP 写稿、固定粤语男女声、完整配音、音频切片、片段选择、HeyGen 任务提交/查询、新闻媒体预览、素材选择和分镜、固定包装库、绿幕校准、FFmpeg 合片任务骨架，以及真实 HeyGen 30 秒链路验证。

尚需稳定化：

1. 将临时公网隧道替换为腾讯云 COS 或其他对象存储的短期签名 URL。
2. 将项目、版本、任务和素材元数据正式持久化到 SQLite/PostgreSQL。
3. 为所有付费任务补充幂等、重试、超时、成本和错误分类。
4. 完成多段数字人按原时间轴回填，并用完整配音主轨进行端到端合片回归。
5. 调整主播横屏模板的位置、亮度、肤色和绿幕边缘参数。
6. 增加成片预览、失败续跑、单段重做和资产缓存。
7. 把本地代理依赖和 `127.0.0.1:7890` 的网络要求改为可配置、可观测的部署策略。

## 13. 推荐的下一阶段

第一优先级是“稳定资产传输 + 可恢复任务”：使用对象存储保存主播、音频切片、数字人结果和新闻素材；数据库记录每个文件与任务状态；轮询器可在进程重启后继续工作。第二优先级是完成一条真实 4 分钟端到端回归：母稿 -> 完整配音 -> 切片 -> 选择主播出镜区间 -> 多段 HeyGen -> 新闻分镜 -> FFmpeg 合片。第三优先级才是字幕、片头动画、自动选材评分和批量发布。

## 附录 A：已试验或评估的数字人/算力方案

### A.1 HeyGen - 当前推荐

采用 Photo/Image-to-Video API。最初曾因媒体不可公网访问及请求字段错误出现内部错误；改用 `image` 对象、受限资产传输和 Vercel 网关后，真实 29.98 秒测试成功。优点是接入简单、画面稳定、无需维护 GPU；缺点是 API 额度通常与普通会员分开、存在 SaaS 成本，并依赖稳定国际网络与公网资产存储。

### A.2 InfiniteTalk 本地 Mac

尝试评估在 Apple Silicon M5 Pro 上运行。Wan2.1-I2V-14B FP16 权重约 40GB，峰值内存可超过 60GB；即使量化后可装入，MPS 算子兼容性与推理速度也不适合日更生产。结论：可做研究验证，不作为生产主链路。

### A.3 InfiniteTalk + RunPod

已进行远程 GPU Pod、权重下载、FastAPI Worker、任务提交与查询等工作。技术上可行且可自托管，但暴露出模型下载时间长、GPU 与系统内存同时受限、Pod 生命周期和地址变化、404/服务未启动、413 大文件、运维与租用成本等问题。结论：保留为可控成本的自托管备选，不作为当前默认。

### A.4 国内 GPU 云

评估过 AutoDL、矩池云、恒源云等按小时租赁方案，可将 InfiniteTalk Worker 地址替换为国内实例。优点是支付和网络更友好；缺点是仍需维护镜像、权重、GPU 队列和公网 API。尚未完成生产集成。

### A.5 可灵（Kling）

曾作为数字人/对口型通道并与 InfiniteTalk 做成可切换选项。实际限制集中在单条时长、接口能力和短片段费用；若 4 分钟音频切成大量 15 秒或短片段，会造成气口不自然、片段数量多和合片复杂。结论：从主界面移除，不作为长口播核心通道；可保留给短镜头或特效镜头。

### A.6 OmniHuman 1.5 / 火山引擎即梦

曾改为主通道并完成 AK/SK、任务结构和公网 URL 的接入准备。实际联调遇到 HTTP 401、服务开通/权限、商品化可用性以及对象检测接口与真正图片数字人生成接口混淆。即使添加 CVFullAccess，也未完成稳定任务。结论：暂缓，待账号明确开通对应商业能力后再评估。

### A.7 fal.ai OmniHuman 1.5

评估过聚合平台提供的 OmniHuman 接口。接入门槛比直接火山引擎低，但成本、供应链依赖、片长与生产稳定性仍需用真实音频测算。未进入代码主链路。

### A.8 Hedra Character 3

评估了能力和价格，整体成本与 HeyGen 接近。未发现足以抵消迁移成本的明显优势，暂未集成。

### A.9 Seedance / Wan 2.2

评估用 30 秒级图生视频替代数字人。此类模型更偏通用视频生成，人物动作自然度可能较好，但精确口型、身份一致性、长口播连续性和成本不可等同于数字人 API。结论：适合 B-roll 或短镜头，不作为精确口播主通道。

### A.10 剪映数字人

产品端体验被纳入参考，但底层模型与公开、稳定、可自动化的 API 不透明，难以嵌入工作台任务系统。结论：可作为人工应急方案，不适合后台自动调用。

### A.11 奇美拉数字人 / URL2VID

调查过火山引擎相关接口，但其产品形态与“使用自有主播图片 + 已生成粤语音频”的核心输入不完全匹配，接口权限和可用范围也不够明确。未继续接入。

## 附录 B：方案结论

当前最务实的组合为：聚合 API 完成写稿与粤语配音，HeyGen 完成选中音频片段的数字人生成，FFmpeg 使用完整配音主轨完成横屏合片。InfiniteTalk + GPU 云保留为未来成本优化和自托管方向；可灵、Seedance、Wan 等通用视频模型只作为短镜头补充；OmniHuman 在获得明确商业权限后再重新评估。
