#!/usr/bin/env bash
set -u

echo "== system =="
uname -a
if [ -r /etc/os-release ]; then cat /etc/os-release; fi

echo "== cpu and memory =="
command -v nproc >/dev/null && nproc
command -v free >/dev/null && free -h

echo "== disk =="
df -h /

echo "== network listeners =="
if command -v ss >/dev/null; then ss -lntp 2>/dev/null | awk 'NR==1 || /:22 |:80 |:443 |:3000 |:3101 /'; fi

echo "== runtime =="
for command_name in node npm docker nginx git curl; do
  if command -v "$command_name" >/dev/null; then
    printf '%-8s ' "$command_name"
    "$command_name" --version 2>&1 | head -n 1
  else
    printf '%-8s missing\n' "$command_name"
  fi
done

echo "== outbound connectivity =="
if command -v curl >/dev/null; then
  for url in https://api.heygen.com https://upload.heygen.com https://api.minimax.io https://openiapi.com; do
    code=$(curl -L -sS -o /dev/null --connect-timeout 8 --max-time 15 -w '%{http_code}' "$url" || true)
    echo "$code $url"
  done
fi

echo "== clock =="
date -Is
timedatectl 2>/dev/null | sed -n '1,8p' || true
