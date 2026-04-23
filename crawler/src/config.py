"""Runtime configuration loaded from environment / .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load .env from collector/ root (one level up from src/)
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_PATH)


@dataclass(frozen=True)
class Settings:
    database_url: str
    kra_key_horse_detail: str
    kra_key_race_result: str
    kra_key_horse_race_history: str
    kra_key_jockey: str
    kra_key_race_info: str
    kra_key_race_dividend: str
    kra_key_horse_rating: str
    kra_key_trainer: str
    kra_key_owner: str
    kra_key_jockey_change: str
    kra_rss_url: str
    youtube_api_key: str
    youtube_krbc_channel_id: str
    kra_chulma_operation: str
    telegram_bot_token: str
    telegram_chat_id: str
    log_level: str

    @classmethod
    def load(cls) -> Settings:
        # All KRA APIs share the same per-account key, but we keep
        # separate slots for flexibility.
        default_key = os.environ.get("KRA_SERVICE_KEY", "")
        # 공용 .env 는 `postgresql://` 스킴을 쓰고 있어 SQLAlchemy 가 psycopg2 로
        # 붙으려고 시도해 실패한다. 우리는 psycopg (v3) 만 설치하므로 드라이버를
        # 명시적으로 강제. 이미 `+psycopg` 가 붙어있으면 그대로 둔다.
        db_url = os.environ.get(
            "DATABASE_URL",
            "postgresql+psycopg://mal:mal_dev_pw@localhost:5434/mal",
        )
        if db_url.startswith("postgresql://"):
            db_url = "postgresql+psycopg://" + db_url[len("postgresql://"):]
        elif db_url.startswith("postgres://"):
            db_url = "postgresql+psycopg://" + db_url[len("postgres://"):]
        return cls(
            database_url=db_url,
            kra_key_horse_detail=os.environ.get("KRA_SERVICE_KEY_HORSE_DETAIL", default_key),
            kra_key_race_result=os.environ.get("KRA_SERVICE_KEY_RACE_RESULT", default_key),
            kra_key_horse_race_history=os.environ.get(
                "KRA_SERVICE_KEY_HORSE_RACE_HISTORY", default_key
            ),
            kra_key_jockey=os.environ.get("KRA_SERVICE_KEY_JOCKEY", default_key),
            kra_key_race_info=os.environ.get("KRA_SERVICE_KEY_RACE_INFO", default_key),
            kra_key_race_dividend=os.environ.get("KRA_SERVICE_KEY_RACE_DIVIDEND", default_key),
            kra_key_horse_rating=os.environ.get("KRA_SERVICE_KEY_HORSE_RATING", default_key),
            kra_key_trainer=os.environ.get("KRA_SERVICE_KEY_TRAINER", default_key),
            kra_key_owner=os.environ.get("KRA_SERVICE_KEY_OWNER", default_key),
            kra_key_jockey_change=os.environ.get(
                "KRA_SERVICE_KEY_JOCKEY_CHANGE", default_key
            ),
            kra_rss_url=os.environ.get(
                "KRA_RSS_URL",
                "http://board.kra.co.kr/down/KRAFile_per_BoardNo/135/rss.xml",
            ),
            youtube_api_key=os.environ.get("YOUTUBE_API_KEY", ""),
            # KRBC 한국마사회 경마방송 — UC...로 시작하는 채널 ID를 .env에 박아둘 것.
            # 미설정 시 채널 핸들 lookup이 추가 호출 1회를 소비하므로 운영시엔 항상 지정.
            youtube_krbc_channel_id=os.environ.get("YOUTUBE_KRBC_CHANNEL_ID", ""),
            # 출전표 API26_2 의 operation 이름 — Swagger 확인 후 설정. 비어있으면 job skip.
            kra_chulma_operation=os.environ.get("KRA_CHULMA_OPERATION", ""),
            # 실패/stale 알림용 Telegram 봇. 둘 다 채워져야 전송, 아니면 조용히 skip.
            # BotFather 로 봇 생성 → getUpdates 로 chat_id 확인.
            telegram_bot_token=os.environ.get("TELEGRAM_BOT_TOKEN", ""),
            telegram_chat_id=os.environ.get("TELEGRAM_CHAT_ID", ""),
            log_level=os.environ.get("LOG_LEVEL", "INFO"),
        )


settings = Settings.load()
