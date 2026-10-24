# 무료 배포 가이드 — Oracle Cloud + DuckDNS + Caddy

비용 0원으로 봇과 Activity를 24시간 켜 둡니다.

```txt
Discord ──▶ https://acesound.duckdns.org ──▶ Caddy(HTTPS 자동) ──▶ app(API + 봇 + Activity)
                    (DuckDNS 무료 도메인)        Oracle 무료 ARM VM, Docker
```

| 구성 | 역할 | 비용 |
| --- | --- | --- |
| Oracle Cloud Always Free (Ampere A1) | 서버 | 무료 (가입 시 카드 인증만, 무료 한도 안에서는 청구 없음) |
| DuckDNS | `xxx.duckdns.org` 고정 주소 | 무료 |
| Caddy | Let's Encrypt 인증서 자동 발급·갱신 | 무료 |
| Supabase | DB·파일 | 무료 (기존 그대로) |

---

## 1. Oracle Cloud 가입

1. <https://www.oracle.com/cloud/free/> → 가입
2. **홈 리전**은 나중에 바꿀 수 없습니다. `South Korea Central (Seoul)` 또는 `South Korea North (Chuncheon)` 중 선택
3. 카드 인증은 본인 확인용입니다. 계정을 **유료로 업그레이드하지 않으면** 무료 한도를 넘는 자원은 아예 만들어지지 않습니다.

## 2. VM 만들기

**Compute → Instances → Create instance**

| 항목 | 값 |
| --- | --- |
| Image | Canonical **Ubuntu 24.04** |
| Shape | **Ampere → VM.Standard.A1.Flex**, OCPU **1**, 메모리 **6GB** (무료 한도: 합계 2 OCPU·12GB) |
| Networking | 새 VCN, **Assign a public IPv4 address** 체크 |
| SSH keys | **Generate a key pair** → 개인 키(`.key`) 다운로드해서 보관 |

> `Out of capacity` 오류가 나면 그 리전의 무료 ARM 자원이 잠시 부족한 것입니다. Availability domain을 바꾸거나 몇 시간 뒤 다시 시도하세요.

만들어지면 **Public IP**를 복사해 둡니다.

## 3. 포트 80·443 열기 (Oracle 콘솔)

**Networking → Virtual cloud networks → (VCN) → Security Lists → Default Security List → Add Ingress Rules**

| Source CIDR | IP Protocol | Destination Port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

VM 안쪽 방화벽은 4단계 스크립트가 엽니다.

## 4. DuckDNS 주소 만들기

1. <https://www.duckdns.org> → GitHub 등으로 로그인
2. sub domain에 원하는 이름(예: `acesound`) 입력 → **add domain**
3. **current ip**에 2단계의 Public IP 입력 → **update ip**

이제 `acesound.duckdns.org`가 VM을 가리킵니다.

## 5. 서버 설정 (SSH)

Windows PowerShell 예시:

```powershell
ssh -i C:\경로\ssh-key.key ubuntu@<Public IP>
```

VM 안에서:

```bash
curl -fsSL https://raw.githubusercontent.com/eunchan96/discord-soundboard/main/deploy/oracle-setup.sh | bash
exit   # docker 그룹 적용을 위해 한 번 나갔다가 다시 접속
```

## 6. `.env` 채우고 실행

```bash
cd ~/discord-soundboard
nano .env
```

로컬 `.env`와 같은 값을 넣고, 마지막에 `DOMAIN=acesound.duckdns.org`를 추가합니다 (`https://` 없이). `Ctrl+O` 저장, `Ctrl+X` 종료.

```bash
docker compose up -d --build      # 첫 빌드는 ARM에서 몇 분 걸립니다
docker compose logs -f app        # '[bot] ... 로그인 완료' 확인 후 Ctrl+C
```

브라우저에서 `https://acesound.duckdns.org/healthz` → `{"bot":true}`가 보이면 정상입니다.

## 7. Discord에 연결

Developer Portal → **Activities → URL Mappings** → Root(`/`) Target을 `acesound.duckdns.org`로 바꿉니다. 이제 터널 없이 언제든 실행됩니다.

---

## 업데이트 (코드 바뀌었을 때)

```bash
cd ~/discord-soundboard
git pull
docker compose up -d --build
```

## 자주 쓰는 명령

| 하고 싶은 것 | 명령 |
| --- | --- |
| 로그 보기 | `docker compose logs -f app` |
| 재시작 | `docker compose restart app` |
| 멈추기 | `docker compose down` |
| 상태 | `docker compose ps` |

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| `https://도메인` 접속 안 됨 | 3단계 Security List, `sudo iptables -L INPUT -n | head`, DuckDNS IP가 VM IP와 같은지 |
| Caddy 로그에 인증서 오류 | 80 포트가 열려 있어야 발급됩니다. DOMAIN 값 오타 |
| `VITE_DISCORD_CLIENT_ID 빌드 인자가 비어 있습니다` | `.env`에 값이 있는지 |
| 봇이 오프라인 | `docker compose logs app`에서 토큰·Supabase 키 오류 |

## 로컬 개발은 그대로

PC에서는 지금처럼 `npm run dev:server` + `npm run dev:client` + 터널로 개발합니다. 이때 URL Mapping을 터널 주소로 바꾸면 배포본 대신 로컬로 연결되니, 테스트가 끝나면 도메인으로 되돌려 주세요. (나중에 개발용 Discord 앱을 따로 만들면 이 전환이 필요 없어집니다.)

> Supabase 무료 프로젝트는 1주일 동안 활동이 없으면 일시정지됩니다. 서버가 켜져 있고 누군가 사용하면 활동으로 잡히지만, 오래 안 쓰다가 오류가 나면 Supabase 대시보드에서 프로젝트를 다시 켜 주세요.
