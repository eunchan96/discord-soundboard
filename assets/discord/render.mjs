import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

// 다시 만들기: npm i -D @resvg/resvg-js 후 node assets/discord/render.mjs assets/discord
const OUT = process.argv[2];
const FONTS = [
  "/usr/share/fonts/opentype/inter/InterDisplay-Black.otf",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc",
];

const C = {
  bg0: "#0e0f24",
  bg1: "#1b1c46",
  blurple: "#5865f2",
  amber: "#ffcc4d",
  pink: "#ff7a9c",
  text: "#ffffff",
  muted: "#c3c8f5",
};

// 3×3 사운드 패드. lit: { "r,c": color }
function pads({ x, y, size, gap, lit = {}, idle = "rgba(255,255,255,0.20)", radius = 0.22, glow = true }) {
  let out = "";
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const px = x + c * (size + gap);
      const py = y + r * (size + gap);
      const color = lit[`${r},${c}`];
      if (color && glow) {
        out += `<rect x="${px - size * 0.18}" y="${py - size * 0.18}" width="${size * 1.36}" height="${size * 1.36}" rx="${size * 0.4}" fill="${color}" opacity="0.35" filter="url(#blur)"/>`;
      }
      out += `<rect x="${px}" y="${py}" width="${size}" height="${size}" rx="${size * radius}" fill="${color ?? idle}"/>`;
    }
  }
  return out;
}

function rings(cx, cy, color, count, start, step, width, opacity) {
  let out = "";
  for (let i = 0; i < count; i++) {
    const o = opacity * (1 - i / (count + 1));
    out += `<circle cx="${cx}" cy="${cy}" r="${start + i * step}" fill="none" stroke="${color}" stroke-width="${width}" opacity="${o.toFixed(3)}"/>`;
  }
  return out;
}

// 가장자리에 흩어진 작은 패드들 (배경 장식)
function scatter(seedRects) {
  return seedRects
    .map(([x, y, s, color, op]) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.22}" fill="${color}" opacity="${op}"/>`)
    .join("");
}

const defs = (w, h) => `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bg1}"/>
      <stop offset="1" stop-color="${C.bg0}"/>
    </linearGradient>
    <radialGradient id="center" cx="0.5" cy="0.45" r="0.55">
      <stop offset="0" stop-color="${C.blurple}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${C.blurple}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="icon" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6d78ff"/>
      <stop offset="1" stop-color="#3a3fb3"/>
    </linearGradient>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${Math.round(w / 90)}"/></filter>
  </defs>`;

// ── 1) 앱 아이콘 1024×1024 (Discord가 원형으로 자르므로 내용은 가운데 원 안에) ──
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${defs(1024, 1024)}
  <rect width="1024" height="1024" rx="224" fill="url(#icon)"/>
  ${rings(512, 512, "#ffffff", 3, 300, 70, 10, 0.16)}
  ${pads({ x: 253, y: 253, size: 150, gap: 34, lit: { "1,1": C.amber, "0,2": C.pink }, idle: "rgba(255,255,255,0.26)" })}
</svg>`;

// ── 2) Cover Art 1920×1080 (16:9로도, 가운데 13:11로도 잘려 보임 → 핵심은 x 322~1598 안에) ──
const coverScatter = scatter([
  [90, 120, 110, C.blurple, 0.35], [230, 150, 70, C.amber, 0.5], [120, 820, 90, C.pink, 0.35],
  [250, 900, 60, C.blurple, 0.4], [1700, 140, 90, C.pink, 0.35], [1600, 80, 60, C.blurple, 0.4],
  [1720, 830, 120, C.blurple, 0.3], [1610, 930, 70, C.amber, 0.45],
]);
const cover = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  ${defs(1920, 1080)}
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <rect width="1920" height="1080" fill="url(#center)"/>
  ${rings(760, 420, C.amber, 6, 120, 95, 6, 0.32)}
  ${rings(1160, 420, C.blurple, 6, 120, 95, 6, 0.45)}
  ${coverScatter}
  ${pads({ x: 820, y: 175, size: 72, gap: 18, lit: { "1,1": C.amber, "0,2": C.pink } })}
  <text x="960" y="640" text-anchor="middle" font-family="Inter Display" font-weight="900" font-size="168" letter-spacing="10" fill="${C.text}">ACESOUND</text>
  <text x="960" y="742" text-anchor="middle" font-family="Noto Sans CJK KR" font-weight="700" font-size="50" fill="${C.muted}">음성 채널에서 함께 누르는 사운드보드</text>
  <text x="960" y="822" text-anchor="middle" font-family="Noto Sans CJK KR" font-weight="700" font-size="34" fill="${C.amber}" opacity="0.9">여러 개를 눌러도 겹쳐서 바로 재생</text>
</svg>`;

// ── 3) Embedded Background 1920×1080 (그리드 뷰 배경, 가운데는 비워둠) ──
const bgScatter = scatter([
  [60, 90, 120, C.blurple, 0.30], [210, 140, 70, C.amber, 0.45], [80, 300, 80, C.pink, 0.28],
  [70, 760, 100, C.blurple, 0.28], [220, 880, 64, C.pink, 0.4], [300, 680, 50, C.amber, 0.35],
  [1720, 100, 110, C.pink, 0.28], [1610, 200, 64, C.blurple, 0.4], [1760, 330, 70, C.amber, 0.35],
  [1700, 760, 120, C.blurple, 0.28], [1580, 900, 70, C.amber, 0.42], [1800, 930, 56, C.pink, 0.35],
]);
const background = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  ${defs(1920, 1080)}
  <rect width="1920" height="1080" fill="url(#bg)"/>
  ${rings(-40, 540, C.amber, 7, 160, 90, 6, 0.30)}
  ${rings(1960, 540, C.blurple, 7, 160, 90, 6, 0.40)}
  ${bgScatter}
</svg>`;

const files = {
  "acesound-app-icon-1024.png": icon,
  "acesound-cover-art-1920x1080.png": cover,
  "acesound-embedded-background-1920x1080.png": background,
};

for (const [name, svg] of Object.entries(files)) {
  const png = new Resvg(svg, {
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Inter Display" },
  }).render().asPng();
  writeFileSync(`${OUT}/${name}`, png);
  console.log(name, (png.length / 1024).toFixed(0), "KB");
}
