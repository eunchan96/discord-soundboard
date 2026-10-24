import { useState } from "react";
import type { Category } from "@soundboard/shared";

interface Props {
  categories: Category[];
  selectedId: string | null;
  canManage: boolean;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => Promise<void>;
  onDelete: (category: Category) => void;
}

export function CategoryChips({ categories, selectedId, canManage, onSelect, onCreate, onDelete }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const selected = categories.find((c) => c.id === selectedId);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setAdding(false);
    await onCreate(trimmed);
    setName("");
    setAdding(false);
  }

  return (
    <div className="chips" role="toolbar" aria-label="카테고리">
      <button className="chip" aria-pressed={selectedId === null} onClick={() => onSelect(null)}>
        전체
      </button>
      {categories.map((c) => (
        <button key={c.id} className="chip" aria-pressed={selectedId === c.id} onClick={() => onSelect(c.id)}>
          {c.name} <span aria-hidden="true">· {c.soundCount}</span>
        </button>
      ))}

      {canManage &&
        (adding ? (
          <input
            className="chip-input"
            autoFocus
            maxLength={20}
            placeholder="새 카테고리"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") setAdding(false);
            }}
            onBlur={() => void submit()}
          />
        ) : (
          <button className="chip chip-add" onClick={() => setAdding(true)}>
            + 카테고리
          </button>
        ))}

      {canManage && selected && (
        <button className="chip chip-add" onClick={() => onDelete(selected)} aria-label={`${selected.name} 카테고리 삭제`}>
          🗑 {selected.name}
        </button>
      )}
    </div>
  );
}
