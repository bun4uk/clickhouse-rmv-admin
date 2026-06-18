from functools import cached_property
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- ClickHouse connection ---
    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    clickhouse_user: str = "default"
    clickhouse_password: str = ""
    clickhouse_database: str = "default"
    clickhouse_secure: bool = False  # HTTPS (8443) for Cloud

    # --- Scope / behaviour ---
    # Comma-separated allowlist of databases to show. Empty = all databases.
    # Kept as a raw str (not List[str]) so pydantic-settings does NOT try to
    # JSON-decode the env var; parsed by the `databases` property below.
    default_databases: str = ""
    poll_interval_seconds: int = 15
    # Cluster name for clusterAllReplicas() when reading query_log on a cluster/Cloud.
    # Empty = single node (read local system.query_log).
    query_log_cluster: str = ""
    # IANA tz the frontend uses to render UTC timestamps (e.g. Europe/Kyiv).
    display_timezone: str = "UTC"

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)

    @cached_property
    def databases(self) -> List[str]:
        return [db.strip() for db in self.default_databases.split(",") if db.strip()]


settings = Settings()
