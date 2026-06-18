-- Create database for test data
CREATE DATABASE IF NOT EXISTS rmv_demo;

-- Base table: Events from e-commerce platform
CREATE TABLE IF NOT EXISTS rmv_demo.events (
    event_time DateTime,
    event_date Date,
    user_id UInt64,
    session_id String,
    event_type String,
    product_id UInt32,
    product_category String,
    product_price Decimal(10, 2),
    quantity UInt16,
    country String,
    device_type String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (event_date, event_time, user_id);

-- Insert sample data (last 30 days of events)
INSERT INTO rmv_demo.events
SELECT
    now() - INTERVAL number HOUR AS event_time,
    toDate(now() - INTERVAL number HOUR) AS event_date,
    (number % 1000) + 1 AS user_id,
    concat('session_', toString((number % 5000) + 1)) AS session_id,
    arrayElement(['view', 'click', 'add_to_cart', 'purchase', 'search'], (number % 5) + 1) AS event_type,
    (number % 100) + 1 AS product_id,
    arrayElement(['Electronics', 'Clothing', 'Books', 'Home', 'Sports'], (number % 5) + 1) AS product_category,
    round((rand() % 50000) / 100.0, 2) AS product_price,
    (number % 10) + 1 AS quantity,
    arrayElement(['USA', 'UK', 'Germany', 'France', 'Canada'], (number % 5) + 1) AS country,
    arrayElement(['desktop', 'mobile', 'tablet'], (number % 3) + 1) AS device_type
FROM numbers(50000);

-- Target table for hourly events aggregation
CREATE TABLE IF NOT EXISTS rmv_demo.events_hourly_target (
    hour DateTime,
    event_type String,
    product_category String,
    country String,
    event_count UInt64,
    total_revenue Decimal(18, 2),
    unique_users UInt64,
    unique_sessions UInt64
) ENGINE = MergeTree()
ORDER BY (hour, event_type, product_category, country);

-- RMV 1: Hourly events aggregation
CREATE MATERIALIZED VIEW IF NOT EXISTS rmv_demo.events_hourly_mv
REFRESH EVERY 5 MINUTE
TO rmv_demo.events_hourly_target
AS
SELECT
    toStartOfHour(event_time) AS hour,
    event_type,
    product_category,
    country,
    count() AS event_count,
    sum(product_price * quantity) AS total_revenue,
    uniq(user_id) AS unique_users,
    uniq(session_id) AS unique_sessions
FROM rmv_demo.events
GROUP BY hour, event_type, product_category, country;

-- Target table for daily product performance
CREATE TABLE IF NOT EXISTS rmv_demo.product_daily_target (
    event_date Date,
    product_id UInt32,
    product_category String,
    views UInt64,
    clicks UInt64,
    cart_adds UInt64,
    purchases UInt64,
    revenue Decimal(18, 2),
    ctr Float64,
    conversion_rate Float64
) ENGINE = MergeTree()
ORDER BY (event_date, product_id);

-- RMV 2: Daily product performance
CREATE MATERIALIZED VIEW IF NOT EXISTS rmv_demo.product_daily_mv
REFRESH EVERY 10 MINUTE
TO rmv_demo.product_daily_target
AS
SELECT
    event_date,
    product_id,
    product_category,
    countIf(event_type = 'view') AS views,
    countIf(event_type = 'click') AS clicks,
    countIf(event_type = 'add_to_cart') AS cart_adds,
    countIf(event_type = 'purchase') AS purchases,
    sumIf(product_price * quantity, event_type = 'purchase') AS revenue,
    round(countIf(event_type = 'click') / countIf(event_type = 'view'), 4) AS ctr,
    round(countIf(event_type = 'purchase') / countIf(event_type = 'click'), 4) AS conversion_rate
FROM rmv_demo.events
GROUP BY event_date, product_id, product_category;

-- Target table for user behavior summary
CREATE TABLE IF NOT EXISTS rmv_demo.user_summary_target (
    user_id UInt64,
    total_events UInt64,
    total_purchases UInt64,
    lifetime_value Decimal(18, 2),
    first_seen DateTime,
    last_seen DateTime,
    active_days Int32,
    favorite_categories Array(String),
    country String,
    preferred_device String
) ENGINE = MergeTree()
ORDER BY user_id;

-- RMV 3: User behavior summary
CREATE MATERIALIZED VIEW IF NOT EXISTS rmv_demo.user_summary_mv
REFRESH EVERY 15 MINUTE
TO rmv_demo.user_summary_target
AS
SELECT
    user_id,
    count() AS total_events,
    countIf(event_type = 'purchase') AS total_purchases,
    sum(product_price * quantity) AS lifetime_value,
    min(event_time) AS first_seen,
    max(event_time) AS last_seen,
    dateDiff('day', min(event_date), max(event_date)) + 1 AS active_days,
    groupArray(DISTINCT product_category) AS favorite_categories,
    any(country) AS country,
    any(device_type) AS preferred_device
FROM rmv_demo.events
GROUP BY user_id;

-- Target table for category performance
CREATE TABLE IF NOT EXISTS rmv_demo.category_performance_target (
    date Date,
    product_category String,
    total_events UInt64,
    total_revenue Decimal(18, 2),
    total_unique_users UInt64,
    avg_revenue_per_event Float64
) ENGINE = MergeTree()
ORDER BY (date, product_category);

-- RMV 4: Category performance (depends on hourly aggregation)
CREATE MATERIALIZED VIEW IF NOT EXISTS rmv_demo.category_performance_mv
REFRESH EVERY 20 MINUTE
TO rmv_demo.category_performance_target
AS
WITH aggregated AS (
    SELECT
        toDate(hour) AS date,
        product_category,
        sum(event_count) AS total_events,
        sum(total_revenue) AS total_revenue,
        sum(unique_users) AS total_unique_users
    FROM rmv_demo.events_hourly_target
    WHERE event_type = 'purchase'
    GROUP BY date, product_category
)
SELECT
    date,
    product_category,
    total_events,
    total_revenue,
    total_unique_users,
    total_revenue / nullIf(total_events, 0) AS avg_revenue_per_event
FROM aggregated;

-- Target table for country stats
CREATE TABLE IF NOT EXISTS rmv_demo.country_stats_target (
    country String,
    date Date,
    total_events UInt64,
    purchases UInt64,
    revenue Decimal(18, 2),
    unique_users UInt64,
    avg_product_price Float64
) ENGINE = MergeTree()
ORDER BY (country, date);

-- RMV 5: Country stats
CREATE MATERIALIZED VIEW IF NOT EXISTS rmv_demo.country_stats_mv
REFRESH EVERY 30 MINUTE
TO rmv_demo.country_stats_target
AS
SELECT
    country,
    toDate(event_time) AS date,
    count() AS total_events,
    countIf(event_type = 'purchase') AS purchases,
    sum(product_price * quantity) AS revenue,
    uniq(user_id) AS unique_users,
    avg(product_price) AS avg_product_price
FROM rmv_demo.events
GROUP BY country, date;

-- Create a simple monitoring table
CREATE TABLE IF NOT EXISTS rmv_demo.refresh_log (
    timestamp DateTime DEFAULT now(),
    view_name String,
    status String,
    message String
) ENGINE = MergeTree()
ORDER BY (timestamp, view_name);
