# CHANGELOG

모든 주목할 만한 변경 사항은 이 파일에 기록됩니다.
[Keep a Changelog](https://keepachangelog.com/ko/1.0.0/) 형식을 따릅니다.

## [Unreleased]

### Added
- **홈 h1 SEO 마크업** — race-day hero에 h1 추가 (a11y/SEO 미비 수정). (#42)

### Changed
- **새 디자인 시스템** — ink/green/gold/navy 팔레트 기반 theme-v2. 홈 + 공통 chrome 수직 슬라이스 적용. (#44)
- **DESIGN.md** — 전면 리프레시 + CLAUDE.md 참조 연결. (#43)

### Fixed
- **theme-v2 색 대비** — navy+gold 조합이 ink+green으로 뒤집혀 저대비가 된 문제 복구. (#45, #46)
- **보안 하드닝** — 댓글·베팅·정산·로그인 CRITIQUE 지적사항 일괄 수정. (#41)

## [2026-05-21]

### Added
- **엔티티별 댓글 시스템** — 커뮤니티·채팅 제거 후 경주/마필/기수/마주 엔티티별 댓글로 전환. (#40)
- **Jenkins 배포 알림** — 성공/실패 텔레그램 notify. SSH 별칭 `mal-prod → server` 통일. (#38, #39)

## [2026-05-17]

### Added
- **SEO sitemap** — sitemap.xml index 구조 + chunk 분할 + 정적 페이지 7종 추가. (#35~#37)
- **모바일 UI 개선** — 홈 최근경기 탭바, 분석 대시보드 TOP 리스트 링크, races 상세 정보 밀도, DB 직링크. (#34, #35)
- **KRBC 업로드 backfill** — 1년 walk bulk backfill 잡. (#31)

### Fixed
- **실시간/잔여 결과 catchup** — `sync_races_live` 일원화 + `sync_yesterday_residual` 신설. (#30)
