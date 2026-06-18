# Критичний розбір ТЗ v2 — RMV Admin (ClickHouse 26.5+)

> **Метод.** Все нижче перевірено двома незалежними шляхами:
> 1. **Наживо** — піднято ClickHouse **26.5.1.882** через `docker compose` (`docker/validation/`), створено тест-в'юхи на всі режими (REPLACE / APPEND / TO / DEPENDS ON / AFTER / RANDOMIZE / failing / slow) і знято реальну поведінку.
> 2. **Первинні джерела** — C++-код ClickHouse (`StorageSystemViewRefreshes.cpp`, `RefreshTask.h/.cpp`, `AccessType.h`, `ParserRefreshStrategy.cpp`), офіційна дока, GitHub-issues/PR, changelog'и (паралельний дослідницький воркфлоу).
>
> **Ціль зафіксована як CH 26.5+.** Це саме по собі прибирає половину занепокоєнь ТЗ (версійні розбіжності 24.10↔25.x↔26.x). Нижче все прив'язано до 26.5; де поведінка зміниться у 26.6/master — позначено окремо.

---

## 0. Головний висновок

ТЗ v2 **значно якісніше** за v1 і в основному технічно коректне: ключові «gotchas» (історія ≠ `view_refreshes`, APPEND дублює, каскад не нативний, DEPENDS ON лише з EVERY, RunningOnAnotherReplica) — **підтверджено наживо**. Але є **4 фактичні помилки**, які треба виправити до старту, і **2 великі спрощення**, які прибирають найскладніші частини.

**Must-fix (інакше код буде хибним):**
1. ❌ `dependencies_database/dependencies_table` **НЕ** дають `DEPENDS ON` (порожні) → парсити DDL. ТЗ §3.2 SQL вводить в оману.
2. ❌ На 26.5 `next_refresh_time` у `WaitingForDependencies`/`MissingDependencies` **НЕ NULL** (NULL-гілка є лише в master/26.6+). → стан очікування визначати за `status`, не за NULL.
3. ❌ `retry` — `UInt64` (НЕ Nullable). У `RunningOnAnotherReplica` він **0/«недоступний»**, а не NULL. NULL-ляться лише 6 лічильників.
4. ❌ Привілей називається **`SYSTEM VIEWS`** (один грант на все), а не «GRANT SYSTEM REFRESH/STOP/...».

**Найбільші спрощення:**
- 🟢 Історію з `query_log` брати по `log_comment = 'refresh of db.view'` (тег з 25.4) — **без** матчингу `inner_id.<uuid>`/`.tmp`/`tables[]`. Перевірено наживо.
- 🟢 Фіксована ціль 26.5+ → прибрати всю мультиверсійну сумісність. Лишити один `DESCRIBE` на старті як sanity-check.

---

## A. Що підтверджено (залишити як є)

| Твердження ТЗ | Статус | Підстава (наживо/код) |
|---|---|---|
| Колонка стану — `status` (String), `last_refresh_result` немає | ✅ | `DESCRIBE` на 26.5.1; `last_refresh_result` був лише ≤24.9 |
| `DEPENDS ON` + `REFRESH AFTER` → `Code: 36 BAD_ARGUMENTS` | ✅ | Відтворено наживо; `ParserRefreshStrategy.cpp` |
| Каскад не нативний; refresh не тригерить downstream | ✅ | `RefreshTask::notify()` лише ре-планує; код |
| Історія НЕ в `view_refreshes` (1 рядок на в'юху) | ✅ | `view_refreshes` — поточний стан |
| APPEND дублює дані при ручному refresh | ✅ | insert-only за дизайном; потрібне попередження |
| `#77856`: dependent з меншим інтервалом оновлюється частіше | ✅ | by-design heuristic, issue відкрита |
| REPLACE = staging `.tmp.inner_id.<uuid>` → EXCHANGE | ✅ | наживо в `query_log`; `RefreshTask.cpp` |
| inner-таблиця = `.inner_id.<uuid>`; `TO` → без inner | ✅ | наживо `system.tables` |
| Detection: за наявністю `REFRESH` у DDL, не лише engine | ✅ | наживо (див. B5) |
| RunningOnAnotherReplica → 6 лічильників NULL | ✅* | `DESCRIBE` 26.5: Nullable (з 25.11); *крім `retry` — див. B3 |
| `clusterAllReplicas(cluster, merge(system,'^query_log'))` для Cloud | ✅ | коректний синтаксис |
| Стан після `SYSTEM STOP VIEW` = `Disabled` | ✅ | наживо (ТЗ вгадало назву) |

---

## B. Помилки та неточності (виправити)

### B1. `dependencies_*` не дають DEPENDS ON — парсити DDL (CRITICAL)
ТЗ §3.2 у SQL списку RMV тягне `dependencies_database, dependencies_table` так, ніби це джерело `DEPENDS ON`.
**Наживо:** для `mv_dep` (з `DEPENDS ON t.mv_replace`) усі колонки `dependencies_*` та `loading_dependencies_*` — **порожні `[]`**. У коді вони заповнюються з `getDependentViews` (data-flow інкрементальних MV), а не з `refresh_strategy`. Граф `DEPENDS ON` живе тільки в DDL (`create_table_query`) та in-memory `RefreshSet`.
**Виправлення:** будувати ребра `DEPENDS ON` регулярним виразом з `create_table_query`. Враховувати, що між інтервалом і `DEPENDS ON` можуть стояти `OFFSET`/`RANDOMIZE FOR`, а імена — кілька, через кому, з/без БД.

### B2. `next_refresh_time` НЕ NULL у станах очікування (на 26.5)
ТЗ: «у `WaitingForDependencies`/`MissingDependencies` `next_refresh_time = NULL`». Дока це теж пише — **але дока випереджає код**. У всіх релізах ≤ 26.5.1 колонка заповнюється безумовно (NULL-гілка додана лише в master, ~26.6+). Наживо на 26.5 `next_refresh_time` завжди має значення.
**Виправлення:** стан очікування визначати **виключно** за `status IN ('WaitingForDependencies','MissingDependencies')`, ніколи — за `next_refresh_time IS NULL`.

### B3. `retry` не NULL-иться
ТЗ перелічує `retry` серед NULL-полів у `RunningOnAnotherReplica`. **`DESCRIBE` 26.5:** `retry UInt64` (НЕ Nullable) → він не може бути NULL; у цьому стані це `0`/«недоступно». NULL-ляться рівно шість: `progress, read_rows, read_bytes, total_rows, written_rows, written_bytes`. У §2.1/§6.6 додати `total_rows` і прибрати `retry` зі списку NULL.

### B4. Привілей — `SYSTEM VIEWS` (один грант)
ТЗ §3.5: «права на `SYSTEM REFRESH/STOP/START/CANCEL VIEW`». Насправді це **один** привілей `SYSTEM VIEWS` (аліаси: `SYSTEM REFRESH/STOP/START/PAUSE/CANCEL VIEW`, `SYSTEM WAIT VIEW` теж під ним). Перевірено наживо:
```sql
GRANT SYSTEM VIEWS ON db.* TO rmv_ui_svc;   -- покриває refresh/stop/start/cancel/wait/pause
```
Сервісний юзер: `SELECT` на `system.tables`, `system.view_refreshes`, `system.query_log` + `SYSTEM VIEWS ON <db>.*`.

### B5. Detection RMV — engine у RMV це `MaterializedView`, не MergeTree
ТЗ §3.2 у коментарі: «RMV мають реальний storage engine (MergeTree)» і `engine NOT IN ('View')`. **Наживо:** і refreshable, і звичайна MV мають `engine = 'MaterializedView'` (MergeTree — це engine *inner*-таблиці, не самого об'єкта MV). Тому `engine NOT IN ('View')` + `ILIKE '%REFRESH%'` ненадійне (ILIKE зловить слово REFRESH у SELECT/колонці).
**Виправлення (перевірено — повертає рівно RMV, без звичайних MV):**
```sql
WHERE engine = 'MaterializedView'
  AND match(create_table_query, '(?i)REFRESH\s+(EVERY|AFTER)')
```

### B6. `SYSTEM REFRESH VIEW` — асинхронний (прибрати «sleep 1s»)
ТЗ §2.3 і старий App.tsx чекають ~1с і перечитують граф. `SYSTEM REFRESH VIEW` — fire-and-forget (issue #87038). Для детермінованого «Refresh Now з результатом»:
```sql
SYSTEM REFRESH VIEW db.view;  -- async
SYSTEM WAIT VIEW  db.view;     -- блокує до завершення; кидає REFRESH_FAILED при помилці
```
**Наживо:** `WAIT VIEW` реально блокує (заміряно ~10с на повільному refresh) і пробрасує помилку. ⚠️ Це означає: бекенд має тримати з'єднання весь час refresh (довгий/безлімітний таймаут) і **не** робити WAIT у тому ж воркері, що й polling.

### B7. Колір/статуси — джерело успіху/помилки
Повний набір `status` (з enum `RefreshState`, 7 значень): `Disabled, Scheduling, Scheduled, WaitingForDependencies, MissingDependencies, Running, RunningOnAnotherReplica`. **Немає** `Succeeded`/`Failed`. **Наживо:** після збою статус — знову `Scheduled`, помилка лише в `exception != ''`. Тобто зелений/червоний визначається не статусом, а `exception` + `last_success_time`.

---

## C. Пропущене (додати)

- **`SYSTEM PAUSE VIEW`** (з ~26.2; на 26.5 є). Відрізняється від STOP: PAUSE дає поточному refresh добігти, STOP — перериває. Обидва показують `status='Disabled'` → UI не відрізнить STOP від PAUSE лише за статусом. Якщо ціль 26.5+ — варто винести обидві кнопки.
- **`Disabled` не переживає рестарт сервера** (локальний STOP/PAUSE). `STOP REPLICATED VIEW` (znode у Keeper) — переживає. Не вважати, що зупинена в'юха лишиться зупиненою після рестарту CH.
- **Стан `Scheduling`** — короткоживучий транзитний; додати в мапу кольорів (трактувати як нейтральний/scheduled), інакше впаде в «unknown».
- **`SQL SECURITY DEFINER`** — наживо всі RMV створюються з `DEFINER = <user> SQL SECURITY DEFINER`. Refresh виконує SELECT з правами **definer'а**, не того, хто натиснув. Нюанс для безпеки/прав сервісного юзера — згадати.
- **`all_replicas` (APPEND-only, CREATE-time, immutable)** — у Replicated БД некоординований refresh можливий лише з APPEND + `SETTINGS all_replicas=1`. Non-APPEND завжди координований і потребує `ReplicatedMergeTree` як target.
- **`MissingDependencies`** vs `WaitingForDependencies` — перший означає биту/неіснуючу/нерефрешабельну залежність або помилку в `DEPENDS ON` (часта пастка: вказали ім'я `TO`-таблиці замість імені в'юхи). UI має показувати це окремо.
- **Multi-shard caveat (#88027):** «один replica на refresh» — це **на логічний шард**; у multi-shard Replicated БД refresh іде раз на шард.

---

## D. Переускладнене (спростити)

### D1. Історія з query_log — без UUID/inner_id (ВЕЛИКЕ спрощення)
ТЗ §2.2/§3.2 пропонує матчити `INSERT INTO ...inner_id.<uuid>` / `.tmp.inner_id.<uuid>` і розрізняти REPLACE/APPEND/TO. **Не потрібно.** З 25.4 (PR #71333) refresh-запити тегуються. **Перевірено наживо на 26.5.1:**
```
interface=9 (BACKGROUND) │ client_name='refreshable materialized view' │ log_comment='refresh of t.mv_replace'
```
Уся історія — один запит, без uuid, без знання режиму:
```sql
SELECT event_time, query_duration_ms, type, read_rows, written_rows, memory_usage, exception
FROM system.query_log
WHERE log_comment = concat('refresh of ', {db:String}, '.', {view:String})
  AND type IN ('QueryFinish','ExceptionWhileProcessing')
ORDER BY event_time DESC
LIMIT {n:UInt32};
-- Cloud/кластер: FROM clusterAllReplicas({cluster}, merge(system, '^query_log'))
-- fallback (надійніше): додати OR has(tables, concat(db,'.',view)) для крайових кейсів
```

### D2. Мультиверсійність — прибрати
ТЗ багато разів «звірити на цільовому кластері / залежить від версії». При фіксованій цілі 26.5+ це зайве. Лишити **один** `DESCRIBE system.view_refreshes` на старті бекенда як health/sanity-check (і лог-варнінг, якщо схема інша). Решту хардкодити під 26.5.

### D3. ON CLUSTER для refresh — прибрати з MVP
ТЗ §2.3 пропонує вибір «поточна репліка чи ON CLUSTER». Для refresh це зайве: координація через Keeper сама обирає одну репліку; окремої `SYSTEM REFRESH REPLICATED VIEW` немає. Достатньо видавати `SYSTEM REFRESH VIEW` **один раз** (на будь-якій ноді). ON CLUSTER релевантний хіба для `STOP/START` через `STOP/START REPLICATED VIEW`. У MVP — не потрібно.

### D4. Каскад через WAIT, не через polling
Для каскаду/множинного вибору замість самописного polling `view_refreshes` використовувати `SYSTEM REFRESH VIEW` + `SYSTEM WAIT VIEW` послідовно у топологічному порядку. Менше коду, детермінованіше. (Пам'ятати про блокування з'єднання — B6.)

---

## E. Фронтенд — переглянути вибір графа

ТЗ §3.3 рекомендує **Cytoscape.js**, а React Flow — «лише якщо потрібен кастомний рендер вузлів». Але задача саме така: кастомні вузли з бейджем REPLACE/APPEND, кольором статусу, часом, прогрес-баром. За власним критерієм ТЗ перемагає **React Flow**.

**Рекомендований стек (2026, перевірено версії в npm):**
- **`@xyflow/react` v12** (не legacy `reactflow` v11). MIT. Кастомні вузли = React-компоненти; пунктир = `style={{strokeDasharray:'5 5'}}`. Для 100–300 вузлів — з запасом. Cytoscape виграє лише на тисячах вузлів / графовій аналітиці (а його WebGL — ще preview з 3.31).
- **`@dagrejs/dagre` v3** (MIT) для автолейауту — **не** unscoped `dagre` (0.8.5, 2019, занедбаний). `elkjs` лише якщо треба port-routing (увага: ліцензія **EPL-2.0**, не MIT).
- **TanStack Query v5** замість `setInterval(30s)`: `useQuery({refetchInterval})` сам пауза при втраті фокусу, дедуплікація, кеш; після мутації refresh — `invalidateQueries` замість «sleep 1s».
- **shadcn/ui** (Tailwind v4), **Zustand v5** (тримати selection поза масивом nodes), **Vite** — усі ✅ актуальні.
- Бонус: старий проєкт **вже** на React Flow + Dagre → менше міграції, ніж перехід на Cytoscape.

---

## F. Готова мапа статус → UI

| `status` | exception | UI-стан | Колір |
|---|---|---|---|
| `Scheduled` | `''` | OK / очікує | 🟢 зелений |
| `Scheduled` / будь-який | `!= ''` | помилка останнього refresh | 🔴 червоний |
| `Running` | — | виконується (progress-bar) | 🟡 жовтий |
| `RunningOnAnotherReplica` | — | на іншій репліці (метрики = NULL) | 🟣 фіолетовий |
| `WaitingForDependencies` | — | чекає залежності | 🔵 блакитний |
| `MissingDependencies` | — | бита залежність (помилка конфіга) | 🔵 блакитний (+іконка ⚠) |
| `Disabled` | — | зупинено (STOP/PAUSE) | ⚪ сірий |
| `Scheduling` | — | транзит → як Scheduled | 🟢/нейтральний |

> Червоний має пріоритет над статусом: спершу перевіряй `exception != ''`, потім мапь `status`.

---

## G. Рекомендований MVP scope (з урахуванням 26.5)

Лишити як у ТЗ, з правками: B1–B7 виправлено, D1–D4 спрощено, фронтенд = React Flow. У «Фаза 2» історію з query_log можна **підняти в MVP** — вона тепер тривіальна (D1). ON CLUSTER та `MODIFY REFRESH` — лишити у Фазі 2 / прибрати.

---

## H. Артефакти валідації

- `docker/validation/docker-compose.yml` — ізольований CH 26.5.1 (порти 18123/19000, без volume — одноразовий).
- `docker/validation/setup.sql` — тест-в'юхи на всі режими.
- Кореневий `docker-compose.yml` — ClickHouse піднято `25.12 → 26.5`.
