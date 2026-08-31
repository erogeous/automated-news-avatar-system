# 自动化新闻数字人系统 - 同事接手说明

更新日期：2026-08-31

## 一、项目当前目标

输入 1–10 条新闻链接，由系统提取正文和图片/视频素材，按照内置新闻写稿 SOP 与本期人工要求生成约 4 分钟香港粤语口播稿。编辑确认稿件后，系统生成固定男女主播粤语配音，再调用数字人服务生成主播视频，最后由 FFmpeg 将完整配音、数字人片段、新闻素材和固定包装合成为横屏新闻成片。

## 二、当前主链路

```text
新闻链接 + 本期要求 + 排班主播
-> 新闻正文/媒体提取
-> AI 母稿
-> 人工定稿
-> 完整粤语配音
-> 音频切片
-> HeyGen 数字人
-> 素材选择/分镜
-> FFmpeg 合片
```

## 三、当前完成情况

- 工作台可启动并完成主要页面流程。
- 至少填写一条新闻链接即可生成稿件。
- 第一页可选择排班主播并输入本期写稿要求。
- 已接入 SOP V4.1 写稿规则，并过滤模型思考标签。
- 已绑定固定粤语男女声，使用 `speech-2.8-hd` 生成完整配音。
- 已实现音频切片、片段选择及数字人任务状态查询。
- 已接入 HeyGen Image-to-Video，并真实生成过约 30 秒 1080P 粤语数字人视频。
- 已实现新闻媒体候选预览、素材选择、分镜排序和固定包装库。
- 已建立 FFmpeg 合片任务骨架及绿幕相似度/边缘柔化预览。

## 四、本地启动

环境要求：Node.js 22.13 或以上，推荐使用 pnpm。

```bash
pnpm install
cp .env.local.example .env.local
pnpm dev
```

打开：

```text
http://localhost:3000/
```

开发启动脚本会同时启动：

- 工作台：`localhost:3000`
- 本地媒体服务：`127.0.0.1:3101`

## 五、环境变量

请仅从安全渠道获取真实值，不要将 `.env.local` 提交到 Git：

```dotenv
OPENIAPI_BASE_URL=
OPENIAPI_API_KEY=
LLM_MODEL=
TTS_MODEL=speech-2.8-hd

HEYGEN_GATEWAY_URL=
HEYGEN_GATEWAY_TOKEN=

PUBLIC_APP_BASE_URL=
PUBLIC_MEDIA_BASE_URL=
```

## 六、重要模块

```text
app/page.tsx                         主工作台界面和业务状态
app/api/news/extract/route.ts        新闻正文和媒体提取
app/api/scripts/generate/route.ts    母稿生成
app/api/voice/generate/route.ts      完整粤语配音
app/api/audio/slices/route.ts        音频切片
app/api/avatar/jobs/route.ts         数字人任务提交
app/api/avatar/jobs/[id]/route.ts    数字人任务查询
app/api/compositions/jobs/           FFmpeg 合片任务
scripts/dev-workbench.mjs            开发环境统一启动
scripts/local-media-server.mjs       本地媒体服务
scripts/public-asset-proxy.mjs       受限公网素材代理
scripts/composition-worker.mjs       FFmpeg 合片 Worker
vercel-gateway/api/gateway.js        HeyGen 受限中转
public/anchors/                      男女主播图片资产
```

## 七、真实验证记录

HeyGen 主链路已真实验证：主播图片与粤语音频经受限媒体地址和 Vercel 网关提交后，成功返回约 29.98 秒、1920x1080、25fps、H.264 + AAC 视频。

测试任务 ID：

```text
e0dae53aee4459fdabb8506ee92d0fb6
```

压缩包不包含测试结果视频和任何密钥。

## 八、优先优化事项

1. 将 HeyGen 策略从固定 28/30 秒切片改为：优先提交完整音频，失败后自动降级为 2–3 分钟或更短片段。
2. 设计统一 `AvatarProvider`，保留 HeyGen、本地 LatentSync + LivePortrait 和其他供应商切换能力。
3. 使用对象存储签名 URL 代替临时公网隧道。
4. 将稿件、配音、音频片段、数字人和合片任务正式持久化到 SQLite/PostgreSQL。
5. 实现付费任务幂等键、有限重试、指数退避、超时和成本记录。
6. 完成多段数字人按原始起止时间回填，并始终以完整粤语配音作为最终主音轨。
7. 调整横屏主播位置、亮度、肤色以及绿幕边缘参数。
8. 建立一条完整 4 分钟端到端自动化回归测试。

## 九、建议的本地数字人扩展

计划增加 Windows NVIDIA GPU Worker：

```text
Windows 11 + WSL2 Ubuntu 22.04
-> LivePortrait 生成自然动作底片
-> LatentSync 1.6 生成粤语口型
-> FastAPI 异步任务接口
-> 工作台 Provider Adapter
-> FFmpeg 绿幕与合片
```

建议硬件为 RTX 3090/4090 24GB、64GB 以上内存和 1TB 以上 NVMe。HeyGen 应保留为云端降级通道。

## 十、安全要求

- 不得把真实 API Key、AK/SK、密码或 `.env.local` 提交到代码仓库。
- 对话或截图中曾经暴露过的密钥应吊销并重新生成。
- 新闻抓取需要 SSRF 防护。
- 公网媒体 URL 应设置有效期、路径白名单、MIME 和大小限制。
- 第三方付费任务必须使用幂等键，避免重试重复扣费。

完整架构和历史方案请阅读：

- `docs/TECHNICAL_OVERVIEW_V2.md`
- `docs/自动化新闻数字人系统_技术文档_V2.0.pdf`
- `docs/PRD.md`
