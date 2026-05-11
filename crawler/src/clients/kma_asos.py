"""KMA ASOS (지상 종관기상관측) 시간자료 클라이언트 — data.go.kr 1360000.

KRA(B551015) 와 다른 호스트라 KraClient 재사용하지 않고 별도 구현. 같은
data.go.kr 계열이라 인증/페이지네이션 패턴은 동일하다.

- 엔드포인트: https://apis.data.go.kr/1360000/AsosHourlyInfoService/getWthrDataList
- 시간자료(dateCd=HR) 1 row = (관측소 × 시각) 1시간 데이터.
- 경마 발주시각 기준 매칭이 필요해서 일자료(DAY) 대신 시간자료(HR).
- mal.kr 은 경마장과 가까운 3개 관측소만 사용 (MEET_TO_STATION).
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
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


BASE_URL = "https://apis.data.go.kr/1360000/AsosHourlyInfoService"
DEFAULT_TIMEOUT = httpx.Timeout(20.0, connect=5.0)

# KMA 가 KST 로 응답 — 명시적 timezone 객체.
KST = timezone(timedelta(hours=9))

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
    """기상청 ASOS 시간자료 조회 클라이언트."""

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
        start: datetime,
        end: datetime,
        page_no: int,
        page_size: int,
    ) -> dict[str, Any]:
        # KMA 시간자료 API 는 startDt/endDt 와 startHh/endHh 를 분리 요구.
        params = {
            "serviceKey": self.service_key,
            "dataType": "JSON",
            "dataCd": "ASOS",
            "dateCd": "HR",
            "pageNo": page_no,
            "numOfRows": page_size,
            "startDt": start.strftime("%Y%m%d"),
            "startHh": start.strftime("%H"),
            "endDt": end.strftime("%Y%m%d"),
            "endHh": end.strftime("%H"),
            "stnIds": station_id,
        }
        resp = self._client.get("/getWthrDataList", params=params)
        resp.raise_for_status()
        data = resp.json()
        _raise_for_api_error(data)
        return data

    def fetch_hourly(
        self,
        station_id: int,
        start: datetime,
        end: datetime,
        *,
        page_size: int = 999,
    ) -> list[dict[str, Any]]:
        """[start, end] 시간 범위 시간자료를 받아 정규화된 dict 목록 반환.

        start/end 는 KST(또는 naive=KST 로 해석) datetime, 시 단위 정밀도.
        """
        if start.tzinfo is None:
            start = start.replace(tzinfo=KST)
        if end.tzinfo is None:
            end = end.replace(tzinfo=KST)
        out: list[dict[str, Any]] = []
        page = 1
        while True:
            data = self._get_page(
                station_id=station_id,
                start=start.astimezone(KST),
                end=end.astimezone(KST),
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


def _to_int(s: Any) -> int | None:
    v = _to_decimal(s)
    return int(v) if v is not None else None


def _parse_obs_time(value: Any) -> datetime | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    # KMA 시간자료 tm 은 보통 "YYYY-MM-DD HH:MM" 형식 — 폭넓게 처리.
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y%m%d%H%M", "%Y%m%d%H"):
        try:
            naive = datetime.strptime(s, fmt)
            return naive.replace(tzinfo=KST)
        except ValueError:
            continue
    return None


def api_item_to_weather_fields(item: dict[str, Any]) -> dict[str, Any] | None:
    """KMA item → weather_observations row dict. 잘못된 row 는 None."""
    obs_time = _parse_obs_time(item.get("tm"))
    stn_raw = item.get("stnId")
    if obs_time is None or stn_raw in (None, ""):
        return None
    try:
        station_id = int(str(stn_raw).strip())
    except ValueError:
        return None
    return {
        "station_id": station_id,
        "obs_time": obs_time,
        "ta": _to_decimal(item.get("ta")),
        "rn": _to_decimal(item.get("rn")),
        "ws": _to_decimal(item.get("ws")),
        "wd": _to_int(item.get("wd")),
        "hm": _to_decimal(item.get("hm")),
        "raw": item,
    }
