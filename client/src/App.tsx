import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Category,
  CategoryListResponse,
  GuildSettings,
  MeResponse,
  PlaybackRequestResponse,
  PlaybackState,
  Sound,
  SoundListResponse,
  SoundPatch,
} from "@soundboard/shared";
import { api, fetchAudioUrl, getSession, type Session } from "./discord.ts";
import { formatSeconds, useDebounced, usePolling, useToast } from "./hooks.ts";
import { CategoryChips } from "./components/CategoryChips.tsx";
import { PlaybackPanel } from "./components/PlaybackPanel.tsx";
import { SoundSheet } from "./components/SoundSheet.tsx";
import { UploadDialog } from "./components/UploadDialog.tsx";

type Sort = "recent" | "popular" | "name";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    getSession().then(setSession, (e: Error) => setFatal(e.message));
  }, []);

  if (fatal) return <div className="center">{fatal}</div>;
  if (!session) return <div className="center">Discord 인증 중…</div>;
  if (!session.guildId) {
    return <div className="center">서버의 음성 채널에서 Activity를 열어 주세요.<br />DM이나 그룹 통화에서는 사용할 수 없어요.</div>;
  }
  return <Soundboard session={session} guildId={session.guildId} />;
}

function Soundboard({ session, guildId }: { session: Session; guildId: string }) {
  const toast = useToast();
  const base = `/guilds/${guildId}`;

  const [me, setMe] = useState<MeResponse | null>(null);
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sounds, setSounds] = useState<Sound[] | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>({ voiceChannelId: null, current: null, queue: [] });

  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("recent");
  const debouncedQuery = useDebounced(query, 250);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [detail, setDetail] = useState<Sound | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);
  const [pendingSoundId, setPendingSoundId] = useState<string | null>(null);

  // ── 데이터 불러오기 ──
  const loadMe = useCallback(() => {
    const q = session.channelId ? `?channelId=${session.channelId}` : "";
    api<MeResponse>(session, `${base}/me${q}`).then(setMe, (e: Error) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, base]);

  const loadCategories = useCallback(() => {
    api<CategoryListResponse>(session, `${base}/categories`).then((r) => setCategories(r.items), () => undefined);
  }, [session, base]);

  const loadSounds = useCallback(() => {
    const params = new URLSearchParams({ sort });
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    if (categoryId) params.set("categoryId", categoryId);
    api<SoundListResponse>(session, `${base}/sounds?${params}`).then(
      (r) => setSounds(r.items),
      (e: Error) => toast.error(e.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, base, sort, debouncedQuery, categoryId]);

  const loadPlayback = useCallback(() => {
    api<PlaybackState>(session, `${base}/playback-requests/state`).then(setPlayback, () => undefined);
  }, [session, base]);

  useEffect(() => {
    loadCategories();
    api<GuildSettings>(session, `${base}/settings`).then(setSettings, () => undefined);
  }, [loadCategories, session, base]);

  useEffect(loadSounds, [loadSounds]);
  usePolling(loadPlayback, 1500, true); // TODO: WebSocket으로 교체 (FR-16)
  usePolling(loadMe, 15000, true); // 음성 채널 입장·퇴장 반영

  // ── 미리듣기 (내 기기에서만) ──
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrls = useRef(new Map<string, string>());
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  async function togglePreview(sound: Sound) {
    const audio = (audioRef.current ??= new Audio());
    if (previewingId === sound.id) {
      audio.pause();
      setPreviewingId(null);
      return;
    }
    try {
      let url = audioUrls.current.get(sound.id);
      if (!url) {
        url = await fetchAudioUrl(session, `${base}/sounds/${sound.id}/audio`);
        audioUrls.current.set(sound.id, url);
      }
      audio.src = url;
      audio.onended = () => setPreviewingId(null);
      await audio.play();
      setPreviewingId(sound.id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // ── 동작 ──
  async function play(sound: Sound) {
    setPendingSoundId(sound.id);
    try {
      const r = await api<PlaybackRequestResponse>(session, `${base}/playback-requests`, {
        method: "POST",
        body: { soundId: sound.id },
      });
      if (r.position > 0) toast.ok(`대기 ${r.position}번째: ${sound.name}`);
      loadPlayback();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPendingSoundId(null);
    }
  }

  async function act(path: string, method: string, okText?: string) {
    try {
      await api(session, `${base}${path}`, { method });
      if (okText) toast.ok(okText);
      loadPlayback();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function createCategory(name: string) {
    try {
      await api(session, `${base}/categories`, { method: "POST", body: { name } });
      loadCategories();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteCategory(category: Category) {
    try {
      await api(session, `${base}/categories/${category.id}`, { method: "DELETE" });
      if (categoryId === category.id) setCategoryId(null);
      loadCategories();
      loadSounds();
      toast.ok(`'${category.name}' 카테고리를 지웠어요. 사운드는 미분류로 남아요.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCategoryToDelete(null);
    }
  }

  async function saveSound(sound: Sound, patch: SoundPatch) {
    try {
      const updated = await api<Sound>(session, `${base}/sounds/${sound.id}`, { method: "PATCH", body: patch });
      setDetail(null);
      setSounds((list) => list?.map((s) => (s.id === updated.id ? updated : s)) ?? list);
      loadCategories();
      toast.ok("저장했어요.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteSound(sound: Sound) {
    try {
      await api(session, `${base}/sounds/${sound.id}`, { method: "DELETE" });
      setDetail(null);
      setSounds((list) => list?.filter((s) => s.id !== sound.id) ?? list);
      loadCategories();
      toast.ok(`'${sound.name}'을(를) 지웠어요.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // ── 화면 ──
  const canPlay = me?.inVoiceChannel ?? false;
  const filtered = Boolean(debouncedQuery.trim() || categoryId);

  return (
    <div className="app">
      <header className="topbar">
        <h1>사운드보드</h1>
        {me?.canUpload && (
          <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>+ 추가</button>
        )}
      </header>

      {me && !me.botInGuild && <div className="notice">이 서버에 봇이 아직 없어요. 관리자에게 봇 초대를 요청해 주세요.</div>}
      {me && me.botInGuild && !canPlay && (
        <div className="notice">음성 채널에 들어가 있어야 재생할 수 있어요. 목록 보기와 미리듣기는 지금도 돼요.</div>
      )}

      <div className="filters">
        <input
          className="search"
          type="search"
          placeholder="사운드 검색"
          aria-label="사운드 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="select" aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="recent">최신순</option>
          <option value="popular">많이 쓴 순</option>
          <option value="name">이름순</option>
        </select>
      </div>

      <CategoryChips
        categories={categories}
        selectedId={categoryId}
        canManage={me?.canManage ?? false}
        onSelect={setCategoryId}
        onCreate={createCategory}
        onDelete={setCategoryToDelete}
      />

      {sounds === null ? (
        <p className="empty">불러오는 중…</p>
      ) : sounds.length === 0 ? (
        <p className="empty">
          {filtered
            ? "조건에 맞는 사운드가 없어요."
            : me?.canUpload
              ? "아직 사운드가 없어요. 오른쪽 위 '+ 추가'로 첫 사운드를 올려 보세요."
              : "아직 사운드가 없어요. 관리자에게 업로드 권한을 요청해 보세요."}
        </p>
      ) : (
        <div className="grid">
          {sounds.map((sound) => (
            <div key={sound.id} style={{ position: "relative" }}>
              <button
                className="sound"
                style={{ width: "100%" }}
                disabled={!canPlay || pendingSoundId === sound.id}
                onClick={() => play(sound)}
                aria-label={`${sound.name} 재생`}
              >
                <span className="sound-name">{sound.name}</span>
                <span className="sound-meta">
                  {formatSeconds(sound.durationSeconds)}
                  {sound.visibility === "private" && <span className="badge">나만</span>}
                  {sound.category && <span className="badge">{sound.category.name}</span>}
                </span>
              </button>
              <div className="sound-actions">
                <button
                  className="icon-btn"
                  aria-label={previewingId === sound.id ? `${sound.name} 미리듣기 정지` : `${sound.name} 미리듣기`}
                  title="내 기기에서만 미리듣기"
                  onClick={() => togglePreview(sound)}
                >
                  {previewingId === sound.id ? "■" : "🎧"}
                </button>
                <button className="icon-btn" aria-label={`${sound.name} 상세`} onClick={() => setDetail(sound)}>
                  ⋯
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <PlaybackPanel
        state={playback}
        myUserId={session.user.id}
        canManage={me?.canManage ?? false}
        onCancel={(id) => act(`/playback-requests/${id}`, "DELETE")}
        onSkip={() => act("/playback-requests/skip", "POST")}
        onStop={() => act("/playback-requests/stop", "POST", "재생을 멈추고 대기열을 비웠어요.")}
      />

      {uploadOpen && (
        <UploadDialog
          session={session}
          guildId={guildId}
          categories={categories}
          settings={settings}
          defaultCategoryId={categoryId}
          onClose={() => setUploadOpen(false)}
          onUploaded={(sound) => {
            setUploadOpen(false);
            toast.ok(`'${sound.name}'을(를) 추가했어요.`);
            loadSounds();
            loadCategories();
          }}
        />
      )}

      {detail && (
        <SoundSheet
          sound={detail}
          categories={categories}
          onClose={() => setDetail(null)}
          onSave={(patch) => saveSound(detail, patch)}
          onDelete={() => deleteSound(detail)}
        />
      )}

      {categoryToDelete && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setCategoryToDelete(null)}>
          <div className="sheet" role="dialog" aria-modal="true">
            <h2>'{categoryToDelete.name}' 카테고리를 지울까요?</h2>
            <p className="hint">사운드 {categoryToDelete.soundCount}개는 지워지지 않고 미분류로 남아요.</p>
            <div className="sheet-actions">
              <button className="btn" onClick={() => setCategoryToDelete(null)}>취소</button>
              <button className="btn btn-danger" onClick={() => deleteCategory(categoryToDelete)}>삭제</button>
            </div>
          </div>
        </div>
      )}

      {toast.toast && (
        <div className={`toast ${toast.toast.kind}`} role="status">{toast.toast.text}</div>
      )}
    </div>
  );
}
