/** ACESOUND 로고: 3×3 사운드 패드 중 하나가 켜진 모양 (앱 아이콘과 같은 모티프) */
export function Logo({ size = 24 }: { size?: number }) {
  const cells = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => ({ r, c })));
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      {cells.map(({ r, c }) => {
        const lit = r === 1 && c === 1;
        return (
          <rect
            key={`${r}${c}`}
            x={1 + c * 10}
            y={1 + r * 10}
            width={8}
            height={8}
            rx={2}
            fill={lit ? "#ffcc4d" : "#5865f2"}
            opacity={lit ? 1 : 0.55 + ((r + c) % 2) * 0.25}
          />
        );
      })}
    </svg>
  );
}
