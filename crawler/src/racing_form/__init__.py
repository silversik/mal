"""경마지(racing form) — 경주 전날 18:00 에 고정 발행하는 데이터 예상단.

설계·운영 문서: docs/feature/racing-form.md

원칙
- 패키지 안에서는 현재 시각을 읽지 않는다. 시각은 모두 인자(now)로 받는다
  (잡 래퍼가 datetime.now(KST) 를 넘김 — e2e 가짜 시계와 맞추기 위함).
- 과거 성적은 race_date < H(=D-1) 만 쓴다 (as-of). SQL 과 Python 양쪽에서 막는다.
- 발행본·예상·기록은 추가 전용이다. 정정·철회는 notices 추가로만 한다.
"""
