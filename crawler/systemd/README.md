# mal collector systemd units

Ubuntu 에서 `mal-collector` 를 주기적으로 돌리기 위한 템플릿 서비스 + 타이머.

## 구성

- `mal-collector@.service` — 템플릿. `%i` 에 CLI 서브커맨드가 들어간다.
  - 예: `systemctl start mal-collector@periodic-news.service` → `uv run python -m src.main periodic-news`
- `mal-collector-<job>.timer` — 각 job 의 스케줄.

| 타이머                                        | 호출하는 명령              | 기본 주기          |
| --------------------------------------------- | -------------------------- | ------------------ |
| `mal-collector-periodic-news.timer`           | `periodic-news`            | 30분               |
| `mal-collector-periodic-videos.timer`         | `periodic-videos`          | 3시간              |
| `mal-collector-periodic-races-today.timer`    | `periodic-races-today`     | 매일 22:00 KST     |
| `mal-collector-periodic-jockeys.timer`        | `periodic-jockeys`         | 매일 06:00 KST     |
| `mal-collector-periodic-horses-backfill.timer`| `periodic-horses-backfill` | 매일 06:30 KST     |
| `mal-collector-periodic-race-plan.timer`      | `periodic-race-plan`       | 매일 05:00 KST     |
| `mal-collector-periodic-race-entries.timer`   | `periodic-race-entries`    | 3시간              |
| `mal-collector-check-stale.timer`             | `check-stale`              | 매시 정각          |

> 주기의 "진실 소스" 는 `scraper_jobs.expected_interval_sec` 이며 대시보드에서 수정
> 가능하지만, **타이머 파일 자체의 스케줄은 systemd 쪽 파일을 수정**해야 한다.
> DB 의 interval 은 "기대 주기 대비 지연 여부(stale)" 판정용이다.
> 둘을 맞춰두자 — 대시보드에서 주기를 바꾸면 아래 명령으로 해당 `.timer` 도 수정:
>
> ```bash
> sudo systemctl edit --full mal-collector-periodic-news.timer
> ```

## 설치

```bash
# 1) 프로젝트 배포
sudo mkdir -p /opt/mal
sudo rsync -a ~/mal/ /opt/mal/
sudo useradd --system --home /opt/mal mal || true
sudo chown -R mal: /opt/mal

# 2) .env 준비 (DATABASE_URL, KRA_*, YOUTUBE_*, DISCORD_WEBHOOK_URL)
sudo -u mal vim /opt/mal/collector/.env

# 3) uv 설치 (사용자/시스템 중 택1. mal 유저 홈에 설치 예)
sudo -u mal bash -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'
sudo -u mal bash -c 'cd /opt/mal/collector && uv sync'

# 4) DB 마이그레이션 적용 — docker compose 를 쓰고 있다면 자동, 아니면 수동:
psql "$DATABASE_URL" -f /opt/mal/db/migrations/008_scraper_monitoring.sql

# 5) systemd unit 배치
sudo cp /opt/mal/collector/systemd/mal-collector@.service       /etc/systemd/system/
sudo cp /opt/mal/collector/systemd/mal-collector-*.timer        /etc/systemd/system/
sudo systemctl daemon-reload

# 6) 타이머 활성화
sudo systemctl enable --now \
    mal-collector-periodic-news.timer \
    mal-collector-periodic-videos.timer \
    mal-collector-periodic-races-today.timer \
    mal-collector-periodic-jockeys.timer \
    mal-collector-periodic-horses-backfill.timer \
    mal-collector-periodic-race-plan.timer \
    mal-collector-periodic-race-entries.timer \
    mal-collector-check-stale.timer
```

## 동작 확인

```bash
# 타이머 목록 / 다음 실행 시각
systemctl list-timers 'mal-collector-*'

# 수동 실행 (배치 파일 테스트)
sudo systemctl start mal-collector@periodic-news.service
sudo systemctl status mal-collector@periodic-news.service
journalctl -u 'mal-collector@periodic-news.service' -f

# 로그 — 지난 24시간 치 모든 job
journalctl -u 'mal-collector@*' --since '24h ago'
```

## 실패 알림 (Discord)

`.env` 에 `DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...` 를 넣으면
- 개별 실행 실패 → 즉시 웹훅 전송
- `check-stale` 이 hourly 로 돌며 expected_interval * 1.5 초과 job 을 digest 로 전송

미설정이면 웹훅 호출은 조용히 skip — 대시보드의 빨간 배너로만 확인.
