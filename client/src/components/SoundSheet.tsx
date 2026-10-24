import { useState } from "react";
import type { Category, Sound, SoundPatch, Visibility } from "@soundboard/shared";
import { formatSeconds } from "../hooks.ts";

interface Props {
  sound: Sound;
  categories: Category[];
  onClose: () => void;
  onSave: (patch: SoundPatch) => Promise<void>;
  onDelete: () => Promise<void>;
}

/** 사운드 상세·관리 (S-05). 수정·삭제는 업로더 본인 또는 관리자에게만 보입니다. */
export function SoundSheet({ sound, categories, onClose, onSave, onDelete }: Props) {
  const [name, setName] = useState(sound.name);
  const [categoryId, setCategoryId] = useState(sound.category?.id ?? "");
  const [visibility, setVisibility] = useState<Visibility>(sound.visibility);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty =
    name.trim() !== sound.name || categoryId !== (sound.category?.id ?? "") || visibility !== sound.visibility;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sound-title">
        <h2 id="sound-title">{sound.name}</h2>

        <div className="detail-row"><span>길이</span><span>{formatSeconds(sound.durationSeconds)}</span></div>
        <div className="detail-row"><span>올린 사람</span><span>{sound.uploader.username}</span></div>
        <div className="detail-row"><span>등록일</span><span>{new Date(sound.createdAt).toLocaleDateString("ko-KR")}</span></div>
        <div className="detail-row"><span>재생 횟수</span><span>{sound.playCount}회</span></div>
        <p />

        {sound.canEdit && (
          <>
            <label className="field">
              <span>이름</span>
              <input type="text" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </label>
            <label className="field">
              <span>카테고리</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={busy}>
                <option value="">미분류</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>공개 범위</span>
              <div className="segmented">
                <button type="button" aria-pressed={visibility === "guild"} onClick={() => setVisibility("guild")}>서버 전체</button>
                <button type="button" aria-pressed={visibility === "private"} onClick={() => setVisibility("private")}>나만</button>
              </div>
            </div>
          </>
        )}

        <div className="sheet-actions">
          {sound.canEdit &&
            (confirmDelete ? (
              <button className="btn btn-danger" disabled={busy} onClick={() => run(onDelete)}>
                정말 삭제
              </button>
            ) : (
              <button className="btn btn-danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                삭제
              </button>
            ))}
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>닫기</button>
          {sound.canEdit && (
            <button
              className="btn btn-primary"
              disabled={!dirty || !name.trim() || busy}
              onClick={() =>
                run(() =>
                  onSave({
                    name: name.trim(),
                    categoryId: categoryId || null,
                    visibility,
                  }),
                )
              }
            >
              저장
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
