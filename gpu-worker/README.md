# InfiniteTalk GPU Worker

Remote GPU service used by the news-avatar workbench. It wraps the official
InfiniteTalk command-line inference in an authenticated asynchronous HTTP API.

## Required runtime values

```dotenv
INFINITETALK_API_TOKEN=replace-with-a-long-random-token
PUBLIC_BASE_URL=https://your-gpu-worker.example.com
INFINITETALK_ROOT=/opt/InfiniteTalk
INFINITETALK_DATA=/data/infinitetalk
WAN_CKPT_DIR=/opt/InfiniteTalk/weights/Wan2.1-I2V-14B-480P
WAV2VEC_DIR=/opt/InfiniteTalk/weights/chinese-wav2vec2-base
INFINITETALK_CKPT=/opt/InfiniteTalk/weights/InfiniteTalk/single/infinitetalk.safetensors
MAX_CONCURRENT_JOBS=1
```

The three official model directories must already exist on a persistent GPU
volume. Start with 480P, streaming mode, and one concurrent job. The API accepts
`multipart/form-data` at `POST /v1/jobs` with `image`, `audio`, `anchor_id`, and
an optional `prompt`. Poll `GET /v1/jobs/{id}`.

The container definition is a deployment baseline. Build and smoke-test it on
the selected NVIDIA GPU host before exposing the service publicly.
