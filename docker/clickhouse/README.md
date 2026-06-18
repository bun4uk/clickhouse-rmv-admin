# ClickHouse Test Environment

Цей каталог містить конфігурацію та init скрипти для локального ClickHouse.

## Що створюється

### База даних: `rmv_demo`

### Таблиці:

1. **events** - базова таблиця з e-commerce подіями (50,000 записів за останні 30 днів)
   - Поля: event_time, user_id, session_id, event_type, product_id, category, price, тощо

### Refreshable Materialized Views:

1. **events_hourly_mv** (REFRESH EVERY 5 MINUTE)
   - Погодинна агрегація подій за типом, категорією, країною
   - Показує: кількість подій, виручка, унікальні користувачі

2. **product_daily_mv** (REFRESH EVERY 10 MINUTE)
   - Щоденна статистика по продуктах
   - Метрики: views, clicks, cart adds, purchases, CTR, conversion rate

3. **user_summary_mv** (REFRESH EVERY 15 MINUTE)
   - Зведення по користувачам
   - Lifetime value, улюблені категорії, активні дні

4. **category_performance_mv** (REFRESH EVERY 20 MINUTE)
   - Продуктивність категорій (залежить від events_hourly_mv)
   - Загальна виручка, середня виручка на подію

5. **country_stats_mv** (REFRESH EVERY 30 MINUTE)
   - Статистика по країнах
   - Покупки, виручка, унікальні користувачі

## Граф залежностей

```
events (table)
    ├─> events_hourly_mv
    │       └─> category_performance_mv
    ├─> product_daily_mv
    ├─> user_summary_mv
    └─> country_stats_mv
```

## Підключення

Після запуску `docker-compose up -d`:

- **HTTP порт**: 8123
- **Native порт**: 9000
- **User**: default
- **Password**: (пустий)

## ClickHouse Client

```bash
# З хоста
docker exec -it rmv_admin-clickhouse-1 clickhouse-client

# Перевірити RMV
SELECT database, name, engine
FROM system.tables
WHERE database = 'rmv_demo' AND engine LIKE '%Refreshable%';

# Подивитись статуси refresh
SELECT *
FROM system.view_refreshes
WHERE database = 'rmv_demo'
ORDER BY refresh_time DESC;
```

## Тестові запити

```sql
-- Подивитись події
SELECT * FROM rmv_demo.events LIMIT 10;

-- Погодинна статистика
SELECT * FROM rmv_demo.events_hourly_mv LIMIT 10;

-- Топ продукти
SELECT product_id, product_category, revenue, purchases
FROM rmv_demo.product_daily_mv
ORDER BY revenue DESC
LIMIT 10;

-- Топ користувачі
SELECT user_id, lifetime_value, total_purchases
FROM rmv_demo.user_summary_mv
ORDER BY lifetime_value DESC
LIMIT 10;
```

## Ручний refresh

```sql
SYSTEM REFRESH VIEW rmv_demo.events_hourly_mv;
```
