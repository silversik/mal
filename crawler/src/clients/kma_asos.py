"""KMA ASOS (지상 종관기상관측) 일자료 클라이언트 — data.go.kr 1360000.

KRA(B551015) 와 다른 호스트라 KraClient 재사용하지 않고 별도 구현. 같은
data.go.kr 계열이라 인증/페이지네이션 패턴은 동일하다.

- 엔드포인트: https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList
- 일자료 1 row = (관측소 stnId × 날짜 tm) 의 일통계.
- mal.kr 은 경마장과 가까운 3개 관측소만 사용 (MEET_TO_STATION).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any
from urllib.parse import unquote

import httpx
from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from ..config import settings
from ..logging import get_logger

log = get_logger(__name__)


BASE_URL = "https://apis.data.go.kr/1360000/AsosDalyInfoService"
DEFAULT_TIMEOUT = httpx.Timeout(15.0, connect=5.0)

# 경마장 한글 라벨 → ASOS 관측소 ID. races.meet 는 "서울"/"제주"/"부경" 한글 저장.
# 서울경마공원(과천)은 ASOS 관측소가 없어 수원(119)이 가장 근접.
MEET_TO_STATION: dict[str, int] = {
    "서울": 119,  # 수원
    "제주": 184,  # 제주
    "부경": 159,  # 부산
}
ALL_STATIONS: tuple[int, ...] = (119, 184, 159)


class KmaApiError(RuntimeError):
    """비재시도 KMA API 오류."""


class KmaAsosClient:
    """기상청 ASOS 일자료 조회 클라이언트."""

    def __init__(self, service_key: str | None = None) -> None:
        key = service_key or settings.kma_service_key
        if not key:
            raise ValueError("KMA_SERVICE_KEY 미설정 — data.go.kr 활용신청 필요")
        # data.go.kr 일반 인증키는 종종 URL-encoded(%2B, %2F) 로 복사됨.
        # httpx 가 다시 encode 하면 이중 인코딩 → 한 번 decode 해서 전달.
        self.service_key = unquote(key) if "%" in key else key
        self._client = httpx.Client(
            base_url=BASE_URL,
            timeout=DEFAULT_TIMEOUT,
            headers={"Accept": "application/json"},
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> KmaAsosClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        retry=retry_if_exception_type(httpx.TransportError),
        before_sleep=before_sleep_log(log, 30),
    )
    def _get_page(
        self,
        *,
        station_id: int,
        start: date,
        end: date,
        page_no: int,
        page_size: int,
    ) -> dict[str, Any]:
        params = {
            "serviceKey": self.service_key,
            "dataType": "JSON",
            "dataCd": "ASOS",
            "dateCd": "DAY",
            "pageNo": page_no,
            "numOfRows": page_size,
            "startDt": start.strftime("%Y%m%d"),
            "endDt": end.strftime("%Y%m%d"),
            "stnIds": station_id,
        }
        resp = self._client.get("/getWthrDataList", params=params)
        resp.raise_for_status()
        data = resp.json()
        _raise_for_api_error(data)
        return data

    def fetch_daily(
        self,
        station_id: int,
        start: date,
        end: date,
        *,
        page_size: int = 500,
    ) -> list[dict[str, Any]]:
        """[start, end] 범위 일자료를 받아 정규화된 dict 목록 반환."""
        out: list[dict[str, Any]] = []
        page = 1
        while True:
            data = self._get_page(
                station_id=station_id,
                start=start,
                end=end,
                page_no=page,
                page_size=page_size,
            )
            body = data.get("response", {}).get("body", {})
            items_field = body.get("items") or {}
            raw_items = items_field.get("item") if isinstance(items_field, dict) else None
            if not raw_items:
                break
            if isinstance(raw_items, dict):
                raw_items = [raw_items]
            out.extend(raw_items)
            total = int(body.get("totalCount") or 0)
            if page * page_size >= total:
                break
            page += 1
        log.info(
            "kma_asos_fetched",
            station=station_id,
            start=start.isoformat(),
            end=end.isoformat(),
            count=len(out),
        )
        return out


def _raise_for_api_error(payload: dict[str, Any]) -> None:
    if "OpenAPI_ServiceResponse" in payload:
        header = payload["OpenAPI_ServiceResponse"].get("cmmMsgHeader", {})
        code = header.get("returnReasonCode")
        msg = header.get("errMsg") or header.get("returnAuthMsg")
        raise KmaApiError(f"KMA API error {code}: {msg}")
    response = payload.get("response", {})
    header = response.get("header", {}) if isinstance(response, dict) else {}
    result_code = header.get("resultCode")
    # KMA 는 "00" 성공, "03" = 데이터 없음 (정상). 그 외는 에러.
    if result_code and result_code not in ("00", "0000", "03"):
        raise KmaApiError(f"KMA API error {result_code}: {header.get('resultMsg')}")


def _to_decimal(s: Any) -> float | None:
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    text = str(s).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _parse_obs_date(value: Any) -> date | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    # KMA 는 보통 "YYYY-MM-DD" 반환. 안전하게 양식 모두 처리.
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def api_item_to_weather_fields(item: dict[str, Any]) -> dict[str, Any] | None:
    """KMA item → weather_observations row dict. 잘못된 row 는 None."""
    obs_date = _parse_obs_date(item.get("tm"))
    stn_raw = item.get("stnId")
    if obs_date is None or stn_raw in (None, ""):
        return None
    try:
        station_id = int(str(stn_raw).strip())
    except ValueError:
        return None
    return {
        "station_id": station_id,
        "obs_date": obs_date,
        "avg_ta": _to_decimal(item.get("avgTa")),
        "min_ta": _to_decimal(item.get("minTa")),
        "max_ta": _to_decimal(item.get("maxTa")),
        "sum_rn": _to_decimal(item.get("sumRn")),
        "avg_ws": _to_decimal(item.get("avgWs")),
        "avg_rhm": _to_decimal(item.get("avgRhm")),
        "iscs": (item.get("iscs") or "").strip() or None,
        "raw": item,
    }
