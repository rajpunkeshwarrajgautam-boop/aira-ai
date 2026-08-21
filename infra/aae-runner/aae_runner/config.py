from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    api_token: str = Field(default='', alias='AAE_API_TOKEN')
    allowed_owner_id: str = Field(default='', alias='AAE_ALLOWED_OWNER_ID')
    openai_api_key: str = Field(default='', alias='OPENAI_API_KEY')
    model: str = Field(default='gpt-5.6-sol', alias='AAE_MODEL')
    workspace: Path = Field(default=Path('/workspace'), alias='AAE_WORKSPACE')
    database_path: Path = Field(default=Path('/data/jobs.db'), alias='AAE_DATABASE_PATH')
    session_database_path: Path = Field(default=Path('/data/sessions.db'), alias='AAE_SESSION_DATABASE_PATH')
    max_turns: int = Field(default=40, alias='AAE_MAX_TURNS', ge=1, le=200)
    max_file_bytes: int = Field(default=2_000_000, alias='AAE_MAX_FILE_BYTES', ge=1_024, le=20_000_000)
    max_output_chars: int = Field(default=120_000, alias='AAE_MAX_OUTPUT_CHARS', ge=1_000, le=500_000)
    allow_file_writes: bool = Field(default=True, alias='AAE_ALLOW_FILE_WRITES')
    allow_shell: bool = Field(default=True, alias='AAE_ALLOW_SHELL')
    enable_web_search: bool = Field(default=True, alias='AAE_ENABLE_WEB_SEARCH')
    sandbox_url: str = Field(default='http://sandbox:9000', alias='AAE_SANDBOX_URL')
    sandbox_token: str = Field(default='', alias='AAE_SANDBOX_TOKEN')
    shell_timeout_seconds: int = Field(default=120, alias='AAE_SHELL_TIMEOUT_SECONDS', ge=1, le=900)
    health_timeout_seconds: float = Field(default=2.0, alias='AAE_HEALTH_TIMEOUT_SECONDS', ge=0.2, le=10.0)

    def resolved_workspace(self) -> Path:
        return self.workspace.expanduser().resolve()

    def validate_runtime(self) -> None:
        if not self.api_token:
            raise RuntimeError('AAE_API_TOKEN must be configured.')
        if not self.openai_api_key:
            raise RuntimeError('OPENAI_API_KEY must be configured.')
        if not self.allowed_owner_id or len(self.allowed_owner_id) > 256:
            raise RuntimeError('AAE_ALLOWED_OWNER_ID must identify exactly one allowed AIRA user.')
        if self.allow_shell and not self.sandbox_token:
            raise RuntimeError('AAE_SANDBOX_TOKEN must be configured when shell execution is enabled.')
        self.resolved_workspace().mkdir(parents=True, exist_ok=True)
        self.database_path.expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self.session_database_path.expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_runtime()
    return settings
