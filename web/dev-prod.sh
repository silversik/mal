#!/usr/bin/env bash
# 실서버 DB로 SSH 터널을 열고 Next.js dev server를 실행합니다.
# 종료(Ctrl+C)하면 터널도 함께 닫힙니다.

set -euo pipefail

SSH_KEY="/Users/esik/keyfile/service-ssh.pem"
REMOTE="root@49.50.138.31"
LOCAL_PORT=15433
REMOTE_PORT=5432

echo "→ SSH 터널 시작 (localhost:${LOCAL_PORT} → 실서버 DB)"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no \
    -L "${LOCAL_PORT}:localhost:${REMOTE_PORT}" \
    -N "$REMOTE" &
TUNNEL_PID=$!

# 터널이 뜰 때까지 잠깐 대기
sleep 1

cleanup() {
  echo ""
  echo "→ SSH 터널 종료 (PID: $TUNNEL_PID)"
  kill "$TUNNEL_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "→ Next.js dev server 시작 (포트 4000, 실서버 DB 연결 중)"
npm run dev
