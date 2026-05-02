import { useEffect, useState } from "react";
import { Bookmark, Plus, Trash2 } from "lucide-react";
import { useAnnotationsStore } from "../store/useAnnotationsStore";
import { useDataStore } from "../store/useDataStore";
import { formatDate } from "../lib/format";
import { EmptyState } from "../components/EmptyState";

const COLORS = [
  { value: "#A78BFA", label: "Сиреневый" },
  { value: "#F59E0B", label: "Жёлтый" },
  { value: "#10B981", label: "Зелёный" },
  { value: "#EF4444", label: "Красный" },
  { value: "#22D3EE", label: "Циан" },
];

export function AnnotationsPage() {
  const transactions = useDataStore((s) => s.transactions);
  const annotations = useAnnotationsStore((s) => s.annotations);
  const add = useAnnotationsStore((s) => s.add);
  const remove = useAnnotationsStore((s) => s.remove);
  const hydrate = useAnnotationsStore((s) => s.hydrate);
  const loaded = useAnnotationsStore((s) => s.loaded);

  useEffect(() => {
    if (!loaded) hydrate();
  }, [loaded, hydrate]);

  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [color, setColor] = useState(COLORS[0].value);

  function submit() {
    if (!date || !title.trim()) return;
    add({ date, title: title.trim(), body: body.trim() || undefined, color });
    setDate("");
    setTitle("");
    setBody("");
  }

  if (transactions.length === 0) return <EmptyState />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bookmark className="w-6 h-6 text-accent2" />
          Аннотации
        </h1>
        <p className="text-muted text-sm mt-1">
          Заметки на временной шкале — отображаются вертикальной линией с подписью на графиках
          Cash-flow и совокупного баланса. Например: «Зарплата выросла», «Купил машину».
        </p>
      </div>

      <div className="card card-pad">
        <div className="font-semibold mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4 text-accent" />
          Новая аннотация
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input text-sm"
          />
          <input
            type="text"
            placeholder="Заголовок"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input text-sm md:col-span-2"
          />
          <select
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="input text-sm"
          >
            {COLORS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <textarea
          placeholder="Описание (опционально)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="input text-sm w-full mb-3"
          rows={2}
        />
        <button onClick={submit} className="btn-primary text-sm">
          Сохранить
        </button>
      </div>

      {annotations.length === 0 ? (
        <div className="card card-pad text-center py-12">
          <Bookmark className="w-10 h-10 text-muted mx-auto mb-3" />
          <div className="font-medium mb-1">Нет аннотаций</div>
          <div className="text-sm text-muted">
            Создайте первую — она появится на графиках Cash-flow и Совокупного баланса
          </div>
        </div>
      ) : (
        <div className="card card-pad">
          <div className="font-semibold mb-3">Все аннотации ({annotations.length})</div>
          <div className="space-y-2">
            {annotations.map((a) => (
              <div
                key={a.id}
                className="flex items-start gap-3 p-3 rounded-lg bg-panel2 border-l-4"
                style={{ borderLeftColor: a.color || "#A78BFA" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-xs text-muted whitespace-nowrap tabular-nums">
                      {formatDate(a.date)}
                    </span>
                    <span className="font-medium">{a.title}</span>
                  </div>
                  {a.body && <div className="text-sm text-muted">{a.body}</div>}
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Удалить «${a.title}»?`)) remove(a.id);
                  }}
                  className="btn-ghost !p-2 text-muted hover:text-expense shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
