# Discord 사운드보드

음성 채널에서 Discord Activity를 열어 서버 사운드를 검색·재생하는 서비스입니다.
현재 단계: **M3 기반 환경 + 음성 재생 PoC**

```txt
client/    Activity (React + Vite + Embedded App SDK)
server/    REST API + discord.js 봇 (+ 배포 시 client/dist 정적 서빙)
shared/    API 타입·오류 코드
supabase/  마이그레이션 SQL
```

## 요구 사항

- Node.js **22.12.0 이상** (`@discordjs/voice` 요구 사항)
- Discord 개발자 모드가 켜진 계정, 봇을 초대할 테스트 서버
- 터널 도구 (예: `cloudflared`)

## 1. Discord Developer Portal

1. <https://discord.com/developers/applications> → **New Application**
2. **OAuth2**
   - Client ID, Client Secret 복사
   - Redirects에 `https://127.0.0.1` 하나 추가 (비어 있으면 안 됨)
3. **Bot** → Reset Token으로 토큰 복사
4. **Installation** 또는 **OAuth2 → URL Generator**
   - scope: `bot`, `applications.commands`
   - 권한: View Channels, Connect, Speak
   - 생성된 URL로 테스트 서버에 봇 초대
5. **Activities → Settings**에서 Activities 활성화 (URL Mapping은 3단계에서)

## 2. 설치

```bash
cp .env.example .env   # 값 채우기 (DEV_GUILD_ID = 테스트 서버 ID)
npm install
```

## 3. PoC ① — 봇만으로 재생 확인

```bash
npm run dev:server
```

테스트 서버 음성 채널에 들어간 뒤 `/sound-test` 입력 → 짧은 "삐" 소리와 함께 재생 시작까지 걸린 시간이 답장으로 옵니다.
처음 한 번은 채널 접속 시간이 포함되고, 두 번째부터가 순수 재생 지연입니다.

## 4. PoC ② — Activity 버튼으로 재생

터미널 3개:

```bash
npm run dev:server                              # 3001
npm run dev:client                              # 5173 (/api → 3001 프록시)
cloudflared tunnel --url http://localhost:5173  # 출력된 https 주소 복사
```

1. Developer Portal → **Activities → URL Mappings** → Root(`/`)에 터널 주소를 `https://` 없이 입력
2. 테스트 서버 음성 채널 → 앱 런처(🚀)에서 Activity 실행
3. 권한 허용 → **테스트 사운드 재생** 버튼 → 표에 지연 시간 기록

터널 주소는 실행할 때마다 바뀌므로 URL Mapping도 매번 갱신해야 합니다.

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| Activity가 빈 화면 / 콘솔에 `blocked:csp` | URL Mapping 주소, 요청이 상대 경로(`/api/v1/...`)인지 |
| `/sound-test`가 안 보임 | `.env`의 `DEV_GUILD_ID`, 봇 초대 시 `applications.commands` scope |
| 봇이 들어오지만 소리가 안 남 | 채널에서 봇의 말하기 권한, 서버 로그의 재생 오류 |
| 토큰 교환 실패 | `DISCORD_CLIENT_ID`·`DISCORD_CLIENT_SECRET`, Redirects 항목 존재 여부 |

## 배포 (M5)

```bash
npm run build   # client/dist 생성
npm start       # 서버가 API + Activity 정적 파일을 함께 서빙
```

봇이 음성 연결을 유지해야 하므로 서버리스(Vercel 등)가 아닌 상시 실행 환경에 배포합니다.
