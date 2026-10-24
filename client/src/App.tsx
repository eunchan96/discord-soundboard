import { useEffect, useState } from "react";
import type { PlaybackTestResponse } from "@soundboard/shared";
import { api, getSession, type Session } from "./discord.ts";

type Measurement = PlaybackTestResponse & { roundTripMs: number };

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [results, setResults] = useState<Measurement[]>([]);

  useEffect(() => {
    getSession().then(setSession, (e: Error) => setError(e.message));
  }, []);

  async function playTest() {
    if (!session?.guildId) return;
    setPlaying(true);
    setError(null);
    const started = performance.now();
    try {
      const r = await api<PlaybackTestResponse>(session, `/guilds/${session.guildId}/playback-requests/test`, {
        method: "POST",
      });
      setResults((prev) => [{ ...r, roundTripMs: Math.round(performance.now() - started) }, ...prev].slice(0, 10));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPlaying(false);
    }
  }

  if (!session && !error) return <main style={styles.main}>Discord 인증 중…</main>;

  return (
    <main style={styles.main}>
      <h1 style={styles.h1}>사운드보드 PoC</h1>

      {session && (
        <p style={styles.meta}>
          {session.user.username} · 서버 {session.guildId ?? "없음"} · 채널 {session.channelId ?? "없음"}
        </p>
      )}

      <button style={styles.button} onClick={playTest} disabled={!session?.guildId || playing}>
        {playing ? "재생 요청 중…" : "테스트 사운드 재생"}
      </button>

      {error && <p style={styles.error}>{error}</p>}

      {results.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th>왕복(ms)</th>
              <th>서버→재생(ms)</th>
              <th>채널 접속</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i}>
                <td>{r.roundTripMs}</td>
                <td>{r.serverLatencyMs}</td>
                <td>{r.joinedNewConnection ? "새로 접속" : "유지"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

const styles = {
  main: { fontFamily: "system-ui, sans-serif", color: "#f2f3f5", padding: 24, maxWidth: 520, margin: "0 auto" },
  h1: { fontSize: 22, margin: "0 0 8px" },
  meta: { fontSize: 13, color: "#b5bac1", margin: "0 0 20px" },
  button: {
    width: "100%",
    padding: "14px 16px",
    fontSize: 16,
    fontWeight: 600,
    border: "none",
    borderRadius: 8,
    background: "#5865f2",
    color: "white",
    cursor: "pointer",
  },
  error: { color: "#f23f43", fontSize: 14 },
  table: { width: "100%", marginTop: 20, fontSize: 14, textAlign: "center" as const, borderCollapse: "collapse" as const },
};
