import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  envDir: "..", // 루트 .env의 VITE_ 값만 읽음
  server: {
    port: 5173,
    // 터널 주소(임의 도메인)로 들어오는 요청 허용
    allowedHosts: true,
    // Discord 프록시를 거쳐 HTTPS(443)로 들어오므로 HMR 웹소켓도 443으로 연결
    hmr: { clientPort: 443 },
    // 개발 중에는 Vite가 /api 요청을 로컬 서버로 넘김 → 터널은 5173 하나만 열면 됨
    proxy: { "/api": "http://localhost:3001" },
  },
});
