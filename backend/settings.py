from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "ClashManager API"
    secret_key: str | None = None
    admin_username: str | None = None
    admin_password: str | None = None
    cors_allow_origins: str = "http://localhost,http://127.0.0.1"
    enable_api_docs: bool = False
    subscription_token: str | None = None
    subscription_header_name: str = "X-Subscription-Token"
    public_base_url: str | None = None
    subscription_cache_max_age: int = 300
    mihomo_external_controller: str | None = None
    mihomo_secret: str | None = None
    mihomo_controller_url: str = "http://mihomo:9090"
    mihomo_delay_test_url: str = "https://www.gstatic.com/generate_204"
    mihomo_delay_timeout_ms: int = 5000

    @property
    def cors_origins(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_allow_origins.split(",")
            if origin.strip()
        ]

    @property
    def normalized_public_base_url(self) -> str | None:
        if not self.public_base_url:
            return None
        return self.public_base_url.rstrip("/")

    def validate_runtime(self) -> None:
        missing = []
        if not self.secret_key:
            missing.append("SECRET_KEY")
        if not self.admin_username:
            missing.append("ADMIN_USERNAME")
        if not self.admin_password:
            missing.append("ADMIN_PASSWORD")
        if not self.subscription_token:
            missing.append("SUBSCRIPTION_TOKEN")

        if missing:
            joined = ", ".join(missing)
            raise RuntimeError(f"Missing required environment variables: {joined}")

        if self.mihomo_external_controller and not self.mihomo_secret:
            raise RuntimeError(
                "MIHOMO_SECRET must be set when MIHOMO_EXTERNAL_CONTROLLER is configured"
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
