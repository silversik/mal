"""KRA NODATA 판정 단일 헬퍼 — zero-padding('3'/'03') 정규화 + 메시지 폴백."""
from __future__ import annotations

import pytest

from src.clients import kra_base
from src.clients.kra_base import KraApiError, KraClient, is_kra_no_data, normalize_kra_code
from src.jobs import _failloud, sync_horses, sync_race_plan


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("03", "3"),
        ("3", "3"),
        ("003", "3"),
        (3, "3"),
        ("00", "0"),
        ("0000", "0"),
        ("22", "22"),
        ("022", "22"),
        (" 03 ", "3"),
        ("", None),
        (None, None),
    ],
)
def test_normalize_kra_code(code: object, expected: str | None) -> None:
    assert normalize_kra_code(code) == expected


@pytest.mark.parametrize("code", ["03", "3", "003"])
def test_nodata_code_padding_tolerant(code: str) -> None:
    assert is_kra_no_data(KraApiError(f"KRA API error {code}: X", code=code))


def test_nodata_message_fallback() -> None:
    assert is_kra_no_data(KraApiError("KRA API error 99: NODATA_ERROR", code=None))
    assert is_kra_no_data(KraApiError("nodata_error"))


@pytest.mark.parametrize(
    "exc",
    [
        KraApiError("KRA API error 22: LIMITED", code="22"),
        KraApiError("KRA API error 30: SERVICE_KEY_IS_NOT_REGISTERED", code="30"),
        KraApiError("KRA API error 13: X", code="13"),  # '3' 접미 오탐 없음
        RuntimeError("NODATA but not a KraApiError"),
    ],
)
def test_not_nodata(exc: BaseException) -> None:
    assert not is_kra_no_data(exc)


@pytest.mark.parametrize("rc", ["03", "3"])
def test_parser_path_produces_nodata(rc: str) -> None:
    # 실제 data.go.kr 응답 형태를 파서에 태워 동일 경로로 판정
    payload = {"response": {"header": {"resultCode": rc, "resultMsg": "NO DATA"}}}
    with pytest.raises(KraApiError) as ei:
        KraClient._raise_for_api_error(payload)
    assert is_kra_no_data(ei.value)


def test_single_helper_shared() -> None:
    # 잡 모듈이 각자 사본을 갖지 않고 같은 헬퍼를 쓴다
    assert _failloud.is_kra_no_data is kra_base.is_kra_no_data
    assert sync_race_plan.is_kra_no_data is kra_base.is_kra_no_data
    assert sync_horses.is_kra_no_data is kra_base.is_kra_no_data
    for mod in (_failloud, sync_race_plan, sync_horses):
        assert not hasattr(mod, "_NO_DATA_CODES")
        assert not hasattr(mod, "_NODATA_CODES")
        assert not hasattr(mod, "_KRA_NO_DATA_CODES")
