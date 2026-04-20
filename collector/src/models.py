"""ORM models — mirror of db/migrations/*.sql.

We declare these so SQLAlchemy can UPSERT / query, but the SQL migrations
remain the source of truth for schema creation.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
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
