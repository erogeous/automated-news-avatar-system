from __future__ import annotations

import json
import os
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

ROOT = Path(os.getenv("INFINITETALK_ROOT", "/opt/InfiniteTalk")).resolve()
DATA = Path(os.getenv("INFINITETALK_DATA", "/data/infinitetalk")).resolve()
INPUTS = DATA / "inputs"
OUTPUTS = DATA / "outputs"
JOBS = DATA / "jobs"
for directory in (INPUTS, OUTPUTS, JOBS):
    directory.mkdir(parents=True, exist_ok=True)

API_TOKEN = os.getenv("INFINITETALK_API_TOKEN", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8080").rstrip("/")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
executor = ThreadPoolExecutor(max_workers=int(os.getenv("MAX_CONCURRENT_JOBS", "1")))
job_lock = threading.Lock()
jobs: dict[str, dict] = {}

app = FastAPI(title="InfiniteTalk Worker", version="0.1.0")
app.mount("/outputs", StaticFiles(directory=OUTPUTS), name="outputs")


def authorize(authorization: str | None = Header(default=None)) -> None:
    if not API_TOKEN:
        raise HTTPException(status_code=503, detail="Worker token is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    if not secrets.compare_digest(authorization[7:], API_TOKEN):
        raise HTTPException(status_code=403, detail="Invalid bearer token")


def persist(job: dict) -> None:
    with job_lock:
        jobs[job["id"]] = job
        (JOBS / f'{job["id"]}.json').write_text(json.dumps(job, ensure_ascii=False, indent=2))


def update(job_id: str, **changes) -> dict:
    with job_lock:
        job = dict(jobs[job_id])
    job.update(changes, updated_at=int(time.time()))
    persist(job)
    return job


async def save_upload(upload: UploadFile, target: Path) -> None:
    size = 0
    with target.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                target.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="Upload is too large")
            output.write(chunk)


def run_job(job_id: str, image_path: Path, audio_path: Path, prompt: str) -> None:
    update(job_id, status="running", progress=5)
    work = INPUTS / job_id
    input_json = work / "input.json"
    output_prefix = OUTPUTS / job_id
    input_json.write_text(json.dumps({
        "prompt": prompt or "A professional Hong Kong news anchor speaking calmly to camera.",
        "cond_video": str(image_path),
        "cond_audio": {"person1": str(audio_path)},
    }, ensure_ascii=False))

    command = [
        os.getenv("PYTHON_BIN", "python"), str(ROOT / "generate_infinitetalk.py"),
        "--ckpt_dir", os.getenv("WAN_CKPT_DIR", str(ROOT / "weights/Wan2.1-I2V-14B-480P")),
        "--wav2vec_dir", os.getenv("WAV2VEC_DIR", str(ROOT / "weights/chinese-wav2vec2-base")),
        "--infinitetalk_dir", os.getenv("INFINITETALK_CKPT", str(ROOT / "weights/InfiniteTalk/single/infinitetalk.safetensors")),
        "--input_json", str(input_json),
        "--size", os.getenv("INFINITETALK_SIZE", "infinitetalk-480"),
        "--sample_steps", os.getenv("INFINITETALK_STEPS", "40"),
        "--mode", "streaming",
        "--motion_frame", os.getenv("INFINITETALK_MOTION_FRAME", "9"),
        "--num_persistent_param_in_dit", os.getenv("INFINITETALK_PERSISTENT_PARAMS", "0"),
        "--save_file", str(output_prefix),
    ]
    if os.getenv("INFINITETALK_QUANT", "").lower() == "fp8":
        command.extend(["--quant", "fp8", "--quant_dir", os.getenv(
            "INFINITETALK_QUANT_CKPT",
            str(ROOT / "weights/InfiniteTalk/quant_models/infinitetalk_single_fp8.safetensors"),
        )])

    log_path = JOBS / f"{job_id}.log"
    try:
        update(job_id, progress=10)
        with log_path.open("w") as log:
            subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
        candidates = sorted(OUTPUTS.glob(f"{job_id}*.mp4"), key=lambda path: path.stat().st_mtime, reverse=True)
        if not candidates:
            raise RuntimeError("InfiniteTalk finished without an MP4 output")
        result = candidates[0]
        update(job_id, status="completed", progress=100, video_url=f"{PUBLIC_BASE_URL}/outputs/{result.name}")
    except Exception as error:
        details = str(error)
        if log_path.exists():
            tail = log_path.read_text(errors="replace").splitlines()[-20:]
            if tail:
                details = f"{details}\n" + "\n".join(tail)
        update(job_id, status="failed", progress=0, error=details[-4000:])


@app.on_event("startup")
def load_jobs() -> None:
    for path in JOBS.glob("*.json"):
        try:
            job = json.loads(path.read_text())
            if job.get("status") in {"queued", "running"}:
                job.update(status="failed", error="Worker restarted before the job completed")
            jobs[job["id"]] = job
        except Exception:
            continue


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model_root_exists": ROOT.exists(), "gpu_required": True}


@app.post("/v1/jobs", dependencies=[Depends(authorize)])
async def create_job(
    image: UploadFile = File(...),
    audio: UploadFile = File(...),
    anchor_id: str = Form(...),
    prompt: str = Form(default=""),
) -> dict:
    if image.content_type not in {"image/png", "image/jpeg"}:
        raise HTTPException(status_code=415, detail="Image must be PNG or JPEG")
    if audio.content_type not in {"audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4"}:
        raise HTTPException(status_code=415, detail="Audio must be MP3, WAV, or M4A")

    job_id = uuid.uuid4().hex
    work = INPUTS / job_id
    work.mkdir(parents=True)
    image_path = work / ("anchor.png" if image.content_type == "image/png" else "anchor.jpg")
    audio_path = work / ("voice.wav" if "wav" in audio.content_type else "voice.mp3")
    await save_upload(image, image_path)
    await save_upload(audio, audio_path)
    now = int(time.time())
    job = {"id": job_id, "anchor_id": anchor_id, "status": "queued", "progress": 0, "created_at": now, "updated_at": now}
    persist(job)
    executor.submit(run_job, job_id, image_path, audio_path, prompt)
    return job


@app.get("/v1/jobs/{job_id}", dependencies=[Depends(authorize)])
def get_job(job_id: str) -> dict:
    with job_lock:
        job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
