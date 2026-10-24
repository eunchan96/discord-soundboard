import { useState } from "react";
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  type Category,
  type GuildSettings,
  type Sound,
  type Visibility,
} from "@soundboard/shared";
import { uploadWithProgress, type Session } from "../discord.ts";

interface Props {
  session: Session;
  guildId: string;
  categories: Category[];
  settings: GuildSettings | null;
  defaultCategoryId: string | null;
  onClose: () => void;
  onUploaded: (sound: Sound) => void;
}

const ACCEPT = ALLOWED_UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(",");

/** 사운드 등록 (S-04). 크기는 미리 확인하고, 길이·형식은 서버가 최종 검증합니다. */
export function UploadDialog({ session, guildId, categories, settings, defaultCategoryId, onClose, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? "");
  const [visibility, setVisibility] = useState<Visibility>("guild");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const maxMb = settings ? (settings.maxFileSizeBytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "") : null;
  const limitText = settings ? `${ALLOWED_UPLOAD_EXTENSIONS.join(", ").toUpperCase()} · 최대 ${maxMb}MB · ${settings.maxDurationSeconds}초` : "";

  function pick(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (settings && f.size > settings.maxFileSizeBytes) {
      setFile(null);
      setError(`파일이 너무 커요. ${maxMb}MB까지 올릴 수 있어요.`);
      return;
    }
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^.]+$/, "").slice(0, 50));
  }

  async function submit() {
    if (!file) return;
    setError(null);
    setProgress(0);
    const form = new FormData();
    form.append("file", file);
    form.append("name", name.trim());
    if (categoryId) form.append("categoryId", categoryId);
    form.append("visibility", visibility);
    try {
      const sound = await uploadWithProgress<Sound>(session, `/guilds/${guildId}/sounds`, form, setProgress);
      onUploaded(sound);
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  }

  const uploading = progress !== null;

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && !uploading && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <h2 id="upload-title">사운드 추가</h2>

        <label className={`drop${file ? " has-file" : ""}`}>
          <input
            type="file"
            accept={ACCEPT}
            hidden
            disabled={uploading}
            onChange={(e) => pick(e.target.files?.[0])}
          />
          {file ? `${file.name} (${(file.size / 1024).toFixed(0)}KB)` : "파일 선택"}
          <div className="hint">{limitText}</div>
        </label>
        <p />

        <label className="field">
          <span>이름</span>
          <input type="text" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} disabled={uploading} />
        </label>

        <label className="field">
          <span>카테고리</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={uploading}>
            <option value="">미분류</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <div className="field">
          <span>공개 범위</span>
          <div className="segmented">
            <button type="button" aria-pressed={visibility === "guild"} onClick={() => setVisibility("guild")} disabled={uploading}>
              서버 전체
            </button>
            <button type="button" aria-pressed={visibility === "private"} onClick={() => setVisibility("private")} disabled={uploading}>
              나만
            </button>
          </div>
        </div>

        {uploading && (
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.max(5, progress * 100)}%` }} />
          </div>
        )}
        {uploading && progress >= 1 && <p className="hint">변환 중… (음량 맞추는 중)</p>}
        {error && <p className="hint" style={{ color: "var(--danger)" }} role="alert">{error}</p>}

        <div className="sheet-actions">
          <button className="btn" onClick={onClose} disabled={uploading}>취소</button>
          <button className="btn btn-primary" onClick={submit} disabled={!file || !name.trim() || uploading}>
            {uploading ? "올리는 중…" : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}
