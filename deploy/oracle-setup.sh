#!/usr/bin/env bash
# Oracle Cloud Ubuntu VM 최초 설정: Docker 설치, 방화벽(80/443) 열기, 레포 받기
# 사용법 (VM에 SSH 접속 후):
#   curl -fsSL https://raw.githubusercontent.com/eunchan96/discord-soundboard/main/deploy/oracle-setup.sh | bash
# 레포가 비공개라면 위 명령 대신 이 파일 내용을 복사해 실행하세요.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/eunchan96/discord-soundboard.git}"
APP_DIR="${APP_DIR:-$HOME/discord-soundboard}"

echo "▶ 1/4 패키지 업데이트"
sudo apt-get update -y
sudo apt-get install -y git curl iptables-persistent

echo "▶ 2/4 Docker 설치"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

echo "▶ 3/4 방화벽: 80, 443 열기"
# Oracle 우분투 이미지는 iptables가 SSH(22) 외 포트를 막아 둡니다. 맨 앞에 허용 규칙을 넣고 저장합니다.
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
  fi
done
sudo netfilter-persistent save

echo "▶ 4/4 레포 받기"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
fi

cat <<EOF

✅ 기본 설정 끝

다음 단계:
  1) 로그아웃 후 다시 SSH 접속 (docker 그룹 적용)
  2) nano $APP_DIR/.env   ← 값 채우기 (DOMAIN 포함)
  3) cd $APP_DIR && docker compose up -d --build
  4) docker compose logs -f app   ← '[bot] ... 로그인 완료' 확인

EOF
