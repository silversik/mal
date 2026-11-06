"""typer CLI(`python -m src.main`) 미처리 예외 출력에 API 키가 실리지 않는지."""
from __future__ import annotations

import importlib
import sys
import types
from typing import Any

import httpx
import pytest
import typer

SECRET = "SECRETKEY%2Bvalue123"


@pytest.fixture
def cli(monkeypatch: pytest.MonkeyPatch) -> Any:
    # crawler_core(sibling 레포) 는 테스트 환경에 없을 수 있어 가짜 모듈로 대체.
    client = types.SimpleNamespace(
        safe_register=lambda **kw: None,
        safe_start_run=lambda job_key: None,
        safe_finish_run=lambda run_id, **kw: None,
    )
    pkg = types.ModuleType("crawler_core")
    pkg.client = client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "crawler_core", pkg)
    monkeypatch.setitem(sys.modules, "crawler_core.client", client)  # type: ignore[arg-type]
    for name in ("src.monitoring", "src.jobs.periodic", "src.main"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    mod = importlib.import_module("src.main")
    # run() 이 바꾸는 전역 hook 은 테스트 뒤 원복
    monkeypatch.setattr(sys, "excepthook", sys.excepthook)
    return mod


def _install_app(mod: Any, monkeypatch: pytest.MonkeyPatch, fn: Any) -> None:
    app = typer.Typer(add_completion=False, pretty_exceptions_show_locals=False)
    app.command("boom")(fn)
    app.command("noop")(lambda: None)
    monkeypatch.setattr(mod, "app", app)
    monkeypatch.setattr(sys, "argv", ["src.main", "boom"])


def _http_error() -> httpx.HTTPStatusError:
    req = httpx.Request(
        "GET",
        "https://apis.data.go.kr/B551015/API42_1/getX",
        params={"serviceKey": SECRET, "pageNo": 1},
    )
    resp = httpx.Response(500, request=req)
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        return e
    raise AssertionError("unreachable")


def test_uncaught_exception_is_redacted(
    cli: Any, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def boom() -> None:
        raise _http_error()

    _install_app(cli, monkeypatch, boom)
    with pytest.raises(SystemExit) as ei:
        cli.run()
    assert ei.value.code == 1
    err = capsys.readouterr().err
    assert "HTTPStatusError" in err
    assert "Traceback" in err
    assert "serviceKey=***" in err
    assert "SECRETKEY" not in err


def test_chained_cause_is_redacted(
    cli: Any, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def boom() -> None:
        try:
            raise _http_error()
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"wrapped: {e}") from e

    _install_app(cli, monkeypatch, boom)
    with pytest.raises(SystemExit):
        cli.run()
    err = capsys.readouterr().err
    assert "RuntimeError: wrapped" in err
    assert "SECRETKEY" not in err


def test_typer_exit_passes_through(
    cli: Any, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def boom() -> None:
        typer.echo("bad input")
        raise typer.Exit(code=3)

    _install_app(cli, monkeypatch, boom)
    with pytest.raises(SystemExit) as ei:
        cli.run()
    assert ei.value.code == 3
    assert "Traceback" not in capsys.readouterr().err


def test_excepthook_redacts(cli: Any, capsys: pytest.CaptureFixture[str]) -> None:
    exc = _http_error()
    cli._redacting_excepthook(type(exc), exc, exc.__traceback__)
    err = capsys.readouterr().err
    assert "serviceKey=***" in err
    assert "SECRETKEY" not in err
