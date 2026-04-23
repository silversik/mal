"""ORM models — mirror of db/migrations/*.sql.

We declare these so SQLAlchemy can UPSERT / query, but the SQL migrations
remain the source of truth for schema creation.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Horse(Base):
    __tablename__ = "horses"

    horse_no: Mapped[str] = mapped_column(String(20), primary_key=True)
    horse_name: Mapped[str] = mapped_column(String(100), nullable=False)
    country: Mapped[str | None] = mapped_column(String(50))
    sex: Mapped[str | None] = mapped_column(String(10))
    birth_date: Mapped[date | None] = mapped_column(Date)
    sire_name: Mapped[str | None] = mapped_column(String(100))
    dam_name: Mapped[str | None] = mapped_column(String(100))
    total_race_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    first_place_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    coat_color: Mapped[str | None] = mapped_column(String(20))
    characteristics: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    raw: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    results: Mapped[list[RaceResult]] = relationship(
        back_populates="horse", cascade="all, delete-orphan"
    )


class RaceResult(Base):
    __tablename__ = "race_results"
    __table_args__ = (
        UniqueConstraint(
            "horse_no", "race_date", "meet", "race_no", name="uq_race_results"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    horse_no: Mapped[str] = mapped_column(
        String(20), ForeignKey("horses.horse_no", ondelete="CASCADE"), nullable=False
    )
    race_date: Mapped[date] = mapped_column(Date, nullable=False)
    meet: Mapped[str | None] = mapped_column(String(20))
    race_no: Mapped[int] = mapped_column(Integer, nullable=False)
    track_condition: Mapped[str | None] = mapped_column(String(20))
    rank: Mapped[int | None] = mapped_column(Integer)
    record_time: Mapped[float | None] = mapped_column(Numeric(6, 2))
    weight: Mapped[float | None] = mapped_column(Numeric(5, 1))
    jockey_name: Mapped[str | None] = mapped_column(String(50))
    trainer_name: Mapped[str | None] = mapped_column(String(50))
    raw: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    jk_no: Mapped[str | None] = mapped_column(String(20))

    horse: Mapped[Horse] = relationship(back_populates="results")


class Jockey(Base):
    __tablename__ = "jockeys"

    jk_no: Mapped[str] = mapped_column(String(20), primary_key=True)
    jk_name: Mapped[str] = mapped_column(String(50), nullable=False)
    meet: Mapped[str | None] = mapped_column(String(20))
    birth_date: Mapped[date | None] = mapped_column(Date)
    debut_date: Mapped[date | None] = mapped_column(Date)
    total_race_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    first_place_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    second_place_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    third_place_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    win_rate: Mapped[float | None] = mapped_column(Numeric(5, 2))
    raw: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Trainer(Base):
    __tablename__ = "trainers"

    tr_no: Mapped[str] = mapped_column(String(20), primary_key=True)
    tr_name: Mapped[str] = mapped_column(String(50), nullable=False)
    tr_name_en: Mapped[str | None] = mapped_column(String(100))
    meet: Mapped[str | None] = mapped_column(String(20))
    birth_date: Mapped[date | None] = mapped_column(Date)
    debut_date: Mapped[date | None] = mapped_column(Date)
    total_race_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    first_place_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    second_place_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    third_place_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    win_rate: Mapped[float | None] = mapped_column(Numeric(5, 2))
    raw: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Owner(Base):
    """마주 마스터 — KRA API309/horseOwnerInfo (dataset 15130589).

    개인+법인 혼재. trainers/jockeys 와 동일한 형태.
    See: db/migrations/018_owners.sql
    """

    __tablename__ = "owners"

    ow_no: Mapped[str] = mapped_column(String(20), primary_key=True)
    ow_name: Mapped[str] = mapped_column(String(100), nullable=False)
    ow_name_en: Mapped[str | None] = mapped_column(String(200))
    meet: Mapped[str | None] = mapped_column(String(20))
    reg_date: Mapped[date | None] = mapped_column(Date)
    total_race_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    first_place_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    second_place_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    third_place_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    win_rate: Mapped[float | None] = mapped_column(Numeric(5, 2))
    raw: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Race(Base):
    __tablename__ = "races"
    __table_args__ = (
        UniqueConstraint("race_date", "meet", "race_no", name="uq_races"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    race_date: Mapped[date] = mapped_column(Date, nullable=False)
    meet: Mapped[str] = mapped_column(String(20), nullable=False)
    race_no: Mapped[int] = mapped_column(Integer, nullable=False)
    race_name: Mapped[str | None] = mapped_column(String(200))
    distance: Mapped[int | None] = mapped_column(Integer)
    grade: Mapped[str | None] = mapped_column(String(50))
    track_type: Mapped[str | None] = mapped_column(String(20))
    track_condition: Mapped[str | None] = mapped_column(String(20))
    entry_count: Mapped[int | None] = mapped_column(Integer)
    start_time: Mapped[str | None] = mapped_column(String(10))  # HH:MM 발주시각
    raw: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class KraNews(Base):
    """공식 공지/뉴스 (한국마사회 RSS)."""

    __tablename__ = "kra_news"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    guid: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False, default="KRA")
    raw: Mapped[dict | None] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class KraVideo(Base):
    """KRBC 한국마사회 경마방송 공식 유튜브."""

    __tablename__ = "kra_videos"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    video_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    channel_id: Mapped[str] = mapped_column(Text, nullable=False)
    channel_title: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    thumbnail_url: Mapped[str] = mapped_column(Text, nullable=False)
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    view_count: Mapped[int | None] = mapped_column(BigInteger)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    race_date: Mapped[date | None] = mapped_column(Date)
    meet: Mapped[str | None] = mapped_column(Text)
    race_no: Mapped[int | None] = mapped_column(Integer)
    raw: Mapped[dict | None] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RacePlan(Base):
    """연간 대상(스테이크) 경주 계획 — API40/raceAnnualPlan."""

    __tablename__ = "race_plans"
    __table_args__ = (
        UniqueConstraint("meet", "year", "race_name", name="uq_race_plans"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    meet: Mapped[str] = mapped_column(String(20), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    race_date: Mapped[date | None] = mapped_column(Date)
    race_no: Mapped[int | None] = mapped_column(Integer)
    race_name: Mapped[str] = mapped_column(Text, nullable=False)
    grade: Mapped[str | None] = mapped_column(String(20))
    distance: Mapped[int | None] = mapped_column(Integer)
    track_type: Mapped[str | None] = mapped_column(String(20))
    age_cond: Mapped[str | None] = mapped_column(String(50))
    prize_1st: Mapped[int | None] = mapped_column(BigInteger)
    total_prize: Mapped[int | None] = mapped_column(BigInteger)
    raw: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RaceEntry(Base):
    """출전표 (예정 경주의 출전 마필) — API26_2/<op>."""

    __tablename__ = "race_entries"
    __table_args__ = (
        UniqueConstraint(
            "race_date", "meet", "race_no", "horse_no", name="uq_race_entries"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    race_date: Mapped[date] = mapped_column(Date, nullable=False)
    meet: Mapped[str] = mapped_column(String(20), nullable=False)
    race_no: Mapped[int] = mapped_column(Integer, nullable=False)
    horse_no: Mapped[str] = mapped_column(String(20), nullable=False)
    chul_no: Mapped[int | None] = mapped_column(Integer)
    horse_name: Mapped[str | None] = mapped_column(String(100))
    jk_no: Mapped[str | None] = mapped_column(String(20))
    jockey_name: Mapped[str | None] = mapped_column(String(50))
    trainer_name: Mapped[str | None] = mapped_column(String(50))
    weight: Mapped[float | None] = mapped_column(Numeric(5, 1))
    age: Mapped[str | None] = mapped_column(String(10))
    sex: Mapped[str | None] = mapped_column(String(10))
    rating: Mapped[int | None] = mapped_column(Integer)
    raw: Mapped[dict | None] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RaceDividend(Base):
    """경주별·마필별 단/연 배당 — API301/Dividend_rate_total.

    한 row = (race, horse) 의 단승/연승 배당. 복식(QNL/QPL/EXA/TRI/TLA) 은 후속 작업.
    """

    __tablename__ = "race_dividends"
    __table_args__ = (
        UniqueConstraint(
            "race_date", "meet", "race_no", "horse_no", name="uq_race_dividends"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    race_date: Mapped[date] = mapped_column(Date, nullable=False)
    meet: Mapped[str] = mapped_column(String(20), nullable=False)
    race_no: Mapped[int] = mapped_column(Integer, nullable=False)
    horse_no: Mapped[str] = mapped_column(String(20), nullable=False)

    win_rate: Mapped[float | None] = mapped_column(Numeric(8, 1))
    plc_rate: Mapped[float | None] = mapped_column(Numeric(8, 1))

    raw_win: Mapped[dict | None] = mapped_column(JSONB)
    raw_plc: Mapped[dict | None] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RaceComboDividend(Base):
    """경주별·복식 조합 배당 — API301/Dividend_rate_total 의 QNL/QPL/EXA/TRI/TLA pool.

    한 row = (race, pool, combo_key) 의 단일 배당. canonical combo_key 는
    unordered pool (QNL/QPL/TRI) 의 경우 horse_no 정렬, ordered pool (EXA/TLA) 는
    원순서. horse_no_1/2/3 은 KRA 응답 원순서.

    See: db/migrations/017_race_combo_dividends.sql
    """

    __tablename__ = "race_combo_dividends"
    __table_args__ = (
        UniqueConstraint(
            "race_date", "meet", "race_no", "pool", "combo_key",
            name="uq_race_combo_dividends",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    race_date: Mapped[date] = mapped_column(Date, nullable=False)
    meet: Mapped[str] = mapped_column(String(20), nullable=False)
    race_no: Mapped[int] = mapped_column(Integer, nullable=False)
    pool: Mapped[str] = mapped_column(String(8), nullable=False)
    combo_key: Mapped[str] = mapped_column(Text, nullable=False)

    horse_no_1: Mapped[str] = mapped_column(String(20), nullable=False)
    horse_no_2: Mapped[str] = mapped_column(String(20), nullable=False)
    horse_no_3: Mapped[str | None] = mapped_column(String(20))

    odds: Mapped[float | None] = mapped_column(Numeric(10, 1))
    raw: Mapped[dict | None] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class HorseRating(Base):
    """경주마 레이팅 스냅샷 시계열 — KRA API77/raceHorseRating (dataset 15057323).

    응답에 공시일자가 없으므로 fetch 시점(`snapshot_date = fetched_at::date`)을
    PK 의 일부로 사용. 같은 날 재실행은 update, 다른 날은 insert (시계열 누적).
    rating1~rating4 는 의미 미공개 — raw 보존.

    See: db/migrations/016_horse_ratings_timeseries.sql
    """

    __tablename__ = "horse_ratings"

    horse_no: Mapped[str] = mapped_column(String(20), primary_key=True)
    snapshot_date: Mapped[date] = mapped_column(
        Date, primary_key=True, server_default=func.current_date()
    )
    horse_name: Mapped[str | None] = mapped_column(String(100))
    meet: Mapped[str | None] = mapped_column(String(20))

    rating1: Mapped[int | None] = mapped_column(Integer)
    rating2: Mapped[int | None] = mapped_column(Integer)
    rating3: Mapped[int | None] = mapped_column(Integer)
    rating4: Mapped[int | None] = mapped_column(Integer)

    raw: Mapped[dict | None] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SyncMeta(Base):
    """동기화 상태 (ETag, Last-Modified, pageToken 등)."""

    __tablename__ = "sync_meta"

    source: Mapped[str] = mapped_column(Text, primary_key=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    etag: Mapped[str | None] = mapped_column(Text)
    last_modified: Mapped[str | None] = mapped_column(Text)
    page_token: Mapped[str | None] = mapped_column(Text)
    last_error: Mapped[str | None] = mapped_column(Text)
    raw: Mapped[dict | None] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ScraperJob(Base):
    """스크래퍼 job 메타. 대시보드에서 주기를 수정할 수 있다."""

    __tablename__ = "scraper_jobs"

    job_key: Mapped[str] = mapped_column(Text, primary_key=True)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    expected_interval_sec: Mapped[int] = mapped_column(Integer, nullable=False)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ScraperRun(Base):
    """스크래퍼 실행 로그."""

    __tablename__ = "scraper_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    job_key: Mapped[str] = mapped_column(
        Text, ForeignKey("scraper_jobs.job_key", ondelete="CASCADE"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(Text, nullable=False)  # running/success/failed
    rows_upserted: Mapped[int | None] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
