from src.jobs.sync_race_dividends import _UPSERT_CHUNK, _chunks


def test_chunks_cover_all_rows_under_param_limit():
    rows = [{"i": i} for i in range(13_500)]
    parts = list(_chunks(rows))
    assert sum(len(p) for p in parts) == len(rows)
    assert [r["i"] for p in parts for r in p] == list(range(13_500))
    # combo row ~10 컬럼 → 청크당 파라미터 수가 65535 미만이어야 함
    assert max(len(p) for p in parts) * 12 < 65535
    assert _UPSERT_CHUNK * 12 < 65535


def test_chunks_empty():
    assert list(_chunks([])) == []
