# Архив: Аннотации (Annotations)

Раздел и функциональность «Аннотации» выпилены из приложения, но код сохранён здесь
на случай возврата. Данные пользователей не теряются: ключ IndexedDB `annotations`
по-прежнему включён в бэкап (`src/lib/backup.ts`, помечен как legacy/archived), так что
существующие аннотации сохраняются и переживут бэкап/восстановление.

## Что это было
Вертикальные линии-заметки на графиках (Дашборд, Cash-flow): дата + подпись + цвет.
Управлялись на отдельной странице `/annotations`.

## Файлы в архиве
- `useAnnotationsStore.ts` — Zustand-стор (`Annotation`, `useAnnotationsStore`), персист в IndexedDB-ключ `annotations`.
- `AnnotationMarker.tsx` — `<AnnotationMarker ann viewBox />`, рендер метки для Recharts `<ReferenceLine label={...}>`.
- `AnnotationsPage.tsx` — страница CRUD `/annotations`.

## Как вернуть (точки интеграции, которые были удалены)
1. Переместить 3 файла обратно:
   - `useAnnotationsStore.ts` → `src/store/`
   - `AnnotationMarker.tsx` → `src/components/`
   - `AnnotationsPage.tsx` → `src/pages/`
2. **Роут** — `src/App.tsx`: импорт `AnnotationsPage` + `<Route path="/annotations" element={<AnnotationsPage />} />`.
3. **Навигация**:
   - `src/components/TopNav.tsx`: `{ to: "/annotations", label: "Аннотации", icon: Bookmark }`.
   - `src/components/CommandPalette.tsx`: `{ path: "/annotations", title: "Аннотации", icon: Bookmark, aliases: ["annotations"] }`.
4. **Метки на графиках** (Recharts `<ReferenceLine>` с `label={<AnnotationMarker ann={a} />}`):
   - `src/pages/DashboardPage.tsx` — стор (`annotations`/`hydrate`/`loaded` + `useEffect` гидрации) и `annotations.map(...)` внутри основного графика.
   - `src/pages/CashflowPage.tsx` — то же + `annotationsInRange` (фильтр по диапазону `chartYms`).
5. **Гидрация при старте** — `src/pages/ImportPage.tsx` вызывал `useAnnotationsStore.getState().hydrate()` (и упоминал «аннотации» в текстах подтверждений/справки).
6. **Справка** — `src/pages/HelpPage.tsx`: секция с `id: "page-annotations"` и упоминания в перечислениях фич.

Удаление выполнено в обратном порядке этого списка. Git-история содержит исходные версии
всех правок.
