import type { PlaybackState } from "@soundboard/shared";
import { Logo } from "./Logo.tsx";

/**
 * 음성 채널 타일(그리드)·PIP처럼 작게 보일 때의 화면.
 * 작은 창에서는 버튼을 누르기 어려우므로 "무엇이 나오는 중인지"만 크게 보여주고,
 * 조작은 Activity를 크게 열어서 하도록 안내합니다.
 */
export function CompactView({ state, canPlay }: { state: PlaybackState; canPlay: boolean }) {
  const shown = state.playing.slice(-2);
  const more = state.playing.length - shown.length;

  return (
    <main className="compact">
      <div className="compact-brand">
        <Logo size={28} />
        <span>ACESOUND</span>
      </div>

      {state.playing.length > 0 ? (
        <ul className="compact-playing" aria-live="polite">
          {shown.map((p) => (
            <li key={p.playId}>
              <span className="eq" aria-hidden="true"><i /><i /><i /></span>
              <span className="c-name">{p.sound.name}</span>
              <span className="c-by">{p.requestedBy.username}</span>
            </li>
          ))}
          {more > 0 && <li className="c-more">외 {more}개</li>}
        </ul>
      ) : (
        <p className="compact-hint">{canPlay ? "크게 열어서 사운드를 눌러 보세요" : "음성 채널에서 함께 쓰는 사운드보드"}</p>
      )}
    </main>
  );
}
