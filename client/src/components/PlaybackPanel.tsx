import type { PlaybackState } from "@soundboard/shared";
import { usePanelHeight } from "../hooks.ts";

interface Props {
  state: PlaybackState;
  myUserId: string;
  canManage: boolean;
  onStop: () => void;
}

/** 하단 고정 재생 패널: 지금 겹쳐서 나오고 있는 소리들 (S-03) */
export function PlaybackPanel({ state, myUserId, canManage, onStop }: Props) {
  const ref = usePanelHeight<HTMLDivElement>();
  const { playing } = state;

  return (
    <section className="panel" ref={ref} aria-label="재생 상태">
      <div className="panel-inner">
        <div className="panel-row">
          <div className="now" aria-live="polite">
            <div className="now-label">{playing.length > 0 ? `재생 중 ${playing.length}개` : "조용함"}</div>
            {playing.length === 0 && (
              <div className="now-by">사운드를 누르면 지금 있는 음성 채널에서 바로 나와요. 여러 개를 눌러도 겹쳐서 나와요.</div>
            )}
          </div>
          {canManage && playing.length > 0 && (
            <button className="btn btn-small btn-danger" onClick={onStop}>
              전체 정지
            </button>
          )}
        </div>

        {playing.length > 0 && (
          <ul className="playing" aria-label="재생 중인 사운드">
            {playing.map((p) => (
              <li key={p.playId} className={p.requestedBy.id === myUserId ? "mine" : undefined}>
                <span className="eq" aria-hidden="true"><i /><i /><i /></span>
                <span className="p-name">{p.sound.name}</span>
                <span className="p-by">{p.requestedBy.username}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
