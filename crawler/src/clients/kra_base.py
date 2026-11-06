"""Base HTTP client for KRA OpenAPI (data.go.kr).

All KRA endpoints share the same quirks:
- Base host: https://apis.data.go.kr/B551015
- XML by default; JSON via `_type=json` (but some endpoints still return XML)
- Paginated via `pageNo` / `numOfRows`
- `serviceKey` may be URL-encoded or decoded depending on what you copied
  from data.go.kr — httpx will encode it again, so we detect & decode.

This base class wraps retry, error parsing, and the XML→dict fallback.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import unquote

import httpx
import xmltodict
from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from ..logging import get_logger

log = get_logger(__name__)

BASE_URL = "https://apis.data.go.kr/B551015"
DEFAULT_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class KraApiError(RuntimeError):
    """Non-retryable API error surfaced from the response body."""

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        # data.go.kr resultCode ("03" = NODATA 등) — 호출부가 분기할 수 있게 보존
        self.code = code


# data.go.kr resultCode "03" = NODATA_ERROR — 비경주일·미발표·미공개는 실패가 아니라 0건.
# 비교는 zero-padding 정규화 후 (`"3"` / `"03"` / `"003"` 모두 동일).
_KRA_NO_DATA_CODES = frozenset({"3"})


def normalize_kra_code(code: object) -> str | None:
    """resultCode 의 앞쪽 0 을 떼어 정규화 (`"03"` → `"3"`, `"00"` → `"0"`). 없으면 None."""
    if code is None:
        return None
    s = str(code).strip()
    if not s:
        return None
    return s.lstrip("0") or "0"


def is_kra_no_data(exc: BaseException) -> bool:
    """KRA NODATA 응답(resultCode 03 또는 메시지에 NODATA)인지."""
    return isinstance(exc, KraApiError) and (
        normalize_kra_code(exc.code) in _KRA_NO_DATA_CODES or "NODATA" in str(exc).upper()
    )


# data.go.kr 공통 오류코드 22 = LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR
# (일일 트래픽 초과). `_raise_for_api_error` 가 `KRA API error 22: <msg>` 로 올린다.
_QUOTA_CODE22_RE = re.compile(r"KRA API error 0*22\b")


def is_quota_error(exc: BaseException) -> bool:
    """쿼터/트래픽 초과 오류인지 — 호출부가 즉시 중단할 때 사용."""
    # HTTP 429 는 상태코드로만 본다 — 메시지의 "429" 부분일치는 URL 의 rc_date=…0429
    # (4월 29일) 같은 5xx/404 를 쿼터로 오판한다.
    resp = getattr(exc, "response", None)
    if getattr(resp, "status_code", None) == 429:
        return True
    errmsg = str(exc)
    return (
        "quota exceeded" in errmsg.lower()
        or "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS" in errmsg.upper()
        or _QUOTA_CODE22_RE.search(errmsg) is not None
    )


class KraClient:
    """Thin wrapper around httpx for a single KRA endpoint family."""

    def __init__(self, service_key: str, endpoint: str) -> None:
        if not service_key:
            raise ValueError(f"Missing KRA service key for endpoint {endpoint}")
        # If the key appears URL-encoded ("%2B", "%2F"...), decode once so
        # httpx's own urlencoding does not double-encode it.
        self.service_key = unquote(service_key) if "%" in service_key else service_key
        self.endpoint = endpoint.lstrip("/")
        self._client = httpx.Client(
            base_url=BASE_URL,
            timeout=DEFAULT_TIMEOUT,
            headers={"Accept": "application/json, application/xml"},
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> KraClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ------------------------------------------------------------------ GET

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        # 4xx 는 재시도해도 의미 없음 (404 op 오류, 403 활성화 대기 등).
        # 네트워크 오류와 5xx 만 재시도 대상.
        retry=retry_if_exception_type(httpx.TransportError),
        before_sleep=before_sleep_log(log, 30),  # 30=WARNING
    )
    def get(self, operation: str, **params: Any) -> dict[str, Any]:
        """Call `{endpoint}/{operation}` and return a normalized dict.

        Always asks for JSON via `_type=json`. If the server still returns
        XML (some KRA endpoints do on error paths), we parse it with xmltodict.
        """
        query = {
            "serviceKey": self.service_key,
            "_type": "json",
            **params,
        }
        path = f"/{self.endpoint}/{operation}"
        log.debug("kra_request", path=path, params={k: v for k, v in params.items()})

        resp = self._client.get(path, params=query)
        resp.raise_for_status()

        ctype = resp.headers.get("content-type", "")
        data = resp.json() if "json" in ctype else xmltodict.parse(resp.text)

        self._raise_for_api_error(data)
        return data

    # --------------------------------------------------------------- helpers

    @staticmethod
    def _raise_for_api_error(payload: dict[str, Any]) -> None:
        """data.go.kr wraps errors in OpenAPI_ServiceResponse — catch those."""
        if "OpenAPI_ServiceResponse" in payload:
            header = (
                payload["OpenAPI_ServiceResponse"]
                .get("cmmMsgHeader", {})
            )
            code = header.get("returnReasonCode")
            msg = header.get("errMsg") or header.get("returnAuthMsg")
            raise KraApiError(
                f"KRA API error {code}: {msg}",
                code=str(code) if code is not None else None,
            )

        # Normal response header
        response = payload.get("response", {})
        header = response.get("header", {}) if isinstance(response, dict) else {}
        result_code = header.get("resultCode")
        if result_code and result_code not in ("00", "0000"):
            raise KraApiError(
                f"KRA API error {result_code}: {header.get('resultMsg')}",
                code=str(result_code),
            )

    # ------------------------------------------------------------- iteration

    def iter_items(
        self,
        operation: str,
        *,
        page_size: int = 100,
        max_pages: int | None = None,
        **params: Any,
    ) -> list[dict[str, Any]]:
        """Paginate through `response.body.items.item` and return flat list."""
        out: list[dict[str, Any]] = []
        page = 1
        while True:
            data = self.get(
                operation,
                pageNo=page,
                numOfRows=page_size,
                **params,
            )
            body = data.get("response", {}).get("body", {})
            items_field = body.get("items") or {}
            raw_items = items_field.get("item") if isinstance(items_field, dict) else None
            if raw_items is None:
                break
            if isinstance(raw_items, dict):
                raw_items = [raw_items]
            out.extend(raw_items)

            total = int(body.get("totalCount") or 0)
            if page * page_size >= total:
                break
            page += 1
            if max_pages and page > max_pages:
                break
        return out
