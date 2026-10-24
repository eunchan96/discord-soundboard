import type { PlaybackState } from "@soundboard/shared";
import { usePanelHeight } from "../hooks.ts";

interface Props {
  state: PlaybackState;
  myUserId: string;
  canManage: boolean;
  onCancel: (requestId: string) => void;
  onSkip: () => void;
  onStop: () => void;
}

/** 하단 고정 재생 패널: 현재 재생 + 대기열 (S-03) */
export function PlaybackPanel({ state, myUserId, canManage, onCancel, onSkip, onStop }: Props) {
  const ref = usePanelHeight<HTMLDivElement>();
  const { current, queue } = state;

  return (
    <section className="panel" ref={ref} aria-label="재생 상태">
      <div className="panel-inner">
        <div className="panel-row">
          <div className="now" aria-live="polite">
            <div className="now-label">{current ? "재생 중" : "대기 중"}</div>
            {current ? (
              <>
                <div className="now-name">
                  <span className="eq" aria-hidden="true"><i /><i /><i /></span>
                  {current.sound.name}
                </div>
                <div className="now-by">{current.requestedBy.username}님의 요청</div>
              </>
            ) : (
              <div className="now-by">사운드를 누르면 지금 있는 음성 채널에서 재생돼요</div>
            )}
          </div>
          {current && (canManage || current.requestedBy.id === myUserId) && (
            <button className="btn btn-small" onClick={canManage ? onSkip : () => onCancel(current.requestId)}>
              건너뛰기
            </button>
          )}
          {canManage && (current || queue.length > 0) && (
            <button className="btn btn-small btn-danger" onClick={onStop}>
              전체 정지
            </button>
          )}
        </div>

        {queue.length > 0 && (
          <ul className="queue" aria-label={`대기열 ${queue.length}개`}>
            {queue.map((item, i) => {
              const mine = item.requestedBy.id === myUserId;
              return (
                <li key={item.requestId} className={mine ? "mine" : undefined}>
                  <span className="pos">{i + 1}</span>
                  <span className="q-name">{item.sound.name}</span>
                  <span>{item.requestedBy.username}</span>
                  {(mine || canManage) && (
                    <button className="icon-btn" aria-label={`${item.sound.name} 요청 취소`} onClick={() => onCancel(item.requestId)}>
                      ✕
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
