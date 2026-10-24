# Discord 사운드보드

음성 채널에서 Discord Activity를 열어 서버 사운드를 검색·미리듣기·재생하는 서비스입니다.
현재 단계: **M4 핵심 기능** (인증, 라이브러리·업로드, 겹쳐 재생, 권한)

```txt
client/    Activity (React + Vite + Embedded App SDK)
server/    REST API + discord.js 봇 (+ 배포 시 client/dist 정적 서빙)
shared/    API 타입·오류 코드
supabase/  마이그레이션 SQL
```

## 요구 사항

- Node.js **22.12.0 이상** (`@discordjs/voice` 요구 사항)
- FFmpeg는 따로 설치하지 않아도 됩니다 (`ffmpeg-static`이 설치 시 내려받음)
- 터널 도구 (예: `cloudflared`)

## 1. Discord Developer Portal

1. <https://discord.com/developers/applications> → 앱 선택(없으면 New Application)
2. **OAuth2**: Client ID·Client Secret 복사, Redirects에 `https://127.0.0.1` 하나 추가
3. **Bot**: Reset Token으로 토큰 복사
4. **OAuth2 → URL Generator**: scope `bot`·`applications.commands`, 권한 View Channels·Connect·Speak → 생성된 URL로 서버에 초대
5. **Activities → Settings**에서 Activities 활성화

## 2. Supabase

- 프로젝트: `discord-soundboard` (MyPik 조직, 서울 리전) — `0001_init.sql` 적용 완료
- 대시보드 → Project Settings → **API Keys** → Secret key를 `.env`의 `SUPABASE_SERVICE_ROLE_KEY`에 넣습니다

## 3. 설치

```bash
cp .env.example .env   # 값 채우기
npm install
```

## 4. 실행 (개발)

터미널 3개:

```bash
npm run dev:server                              # 3001
npm run dev:client                              # 5173 (/api → 3001 프록시)
cloudflared tunnel --url http://localhost:5173  # 출력된 https 주소 복사
```

1. Developer Portal → **Activities → URL Mappings** → Root(`/`)에 터널 주소를 `https://` 없이 입력
2. 음성 채널 → 앱 런처(🚀)에서 Activity 실행

터널 주소는 실행할 때마다 바뀌므로 URL Mapping도 매번 갱신해야 합니다.

## 동작 규칙

| 항목 | 기본값 (서버 설정으로 변경 가능) |
| --- | --- |
| 업로드 | MP3·OGG·WAV·M4A, 1MB·15초 이하, 모든 멤버 허용 → 서버에서 Ogg Opus로 변환·음량 정규화 |
| 재생 | 누르는 즉시 재생, 여러 개는 서버에서 섞어서 겹쳐 재생. 동시에 최대 8개, 한 사람당 3개 |
| 관리자 | 서버 관리(Manage Server) 권한 또는 지정 역할 |
| 채널 | 같은 서버에서 봇은 한 채널에만 있을 수 있음. 다른 채널에서 재생 중이면 거절, 조용하면 요청자 채널로 이동 |
| 퇴장 | 마지막 소리가 끝나고 5분 뒤, 또는 채널에 사람이 없을 때 |
| 작은 화면 | 음성 채널 타일·PIP에서는 재생 중인 소리만 크게 보여주는 축소 화면 |

## Developer Portal 이미지·문구

`assets/discord/`에 만들어 둔 이미지를 올립니다. (원본 SVG는 `render.mjs`)

| 위치 | 항목 | 파일 / 값 |
| --- | --- | --- |
| General Information | Name | `ACESOUND` |
| General Information | App Icon | `acesound-app-icon-1024.png` |
| General Information | Description | 음성 채널에서 친구들과 사운드를 올리고 버튼 하나로 함께 재생하는 사운드보드. 여러 개를 눌러도 겹쳐서 바로 나와요. |
| Activities → Art Assets | Cover Art (활동 목록 카드) | `acesound-cover-art-1920x1080.png` |
| Activities → Art Assets | Embedded Background (음성 채널 그리드 배경) | `acesound-embedded-background-1920x1080.png` |
| Bot | Icon (봇 프로필, 선택) | `acesound-app-icon-1024.png` |

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| Activity가 빈 화면 / 콘솔에 `blocked:csp` | URL Mapping 주소, 요청이 상대 경로(`/api/v1/...`)인지 |
| `요청 실패: HTTP 500 ... 응답 본문 없음` | 서버(3001)가 켜져 있는지, Vite 터미널의 `http proxy error` |
| 업로드 시 `Storage 업로드 실패` | `SUPABASE_SERVICE_ROLE_KEY`가 Secret key인지 |
| 봇이 들어오지만 소리가 안 남 | 채널에서 봇의 말하기 권한, PC Discord 출력 장치·헤드셋 음소거 |
| 토큰 교환 실패 | `DISCORD_CLIENT_ID`·`DISCORD_CLIENT_SECRET`, Redirects 항목 존재 여부 |

## 배포 (M5)

```bash
npm run build   # client/dist 생성
npm start       # 서버가 API + Activity 정적 파일을 함께 서빙
```

봇이 음성 연결을 유지해야 하므로 서버리스(Vercel 등)가 아닌 상시 실행 환경에 배포합니다.
