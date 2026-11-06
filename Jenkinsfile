// mal.kr 레포 파이프라인.
// - web (Next.js) 빌드 + crawler (Python/uv) 배포
// - db/migrations/*.sql 자동 적용 (Rsync 와 Build 사이의 'Migrate DB' stage).
//   기존엔 수동 run-migrations.sh 였지만 nickname/owners 두 번 prod 500 발생 →
//   재발 방지로 자동화. 마이그레이션은 _migrations_applied 테이블로 idempotent.
//
// 2026-11-06 보강 — betlive Jenkinsfile.crawler/.frontend 레퍼런스에 맞춤:
//   1) SCM-polling path 필터 + not triggeredBy SCMTrigger (전체를 Deploy 래퍼로 감쌈).
//      무관한 path(docs 등)만 바뀐 push 가 web(Next.js) 풀빌드 + 컨테이너 재생성을
//      무의미하게 유발하던 드리프트 제거. 수동/스케줄 빌드는 항상 실행.
//   2) 수동 정지(exit 0/143) 컨테이너 보존 — 운영자가 incident 중 멈춰둔 서비스를
//      자동 배포가 되살리는 사고 방지 (betlive 2026-05-19 score-v2 부활 사고와 동형).
//   3) 서비스당 직렬 빌드 — BuildKit 병렬 빌드가 8GB 호스트를 OOM 으로 몬 전례
//      (betlive 2026-09-12). mal 은 2개뿐이지만 동일 원칙 유지.

pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    environment {
        DEPLOY_HOST      = 'root@49.50.138.31'
        DEPLOY_PATH      = '/srv/services/mal'
        STACK_PATH       = '/srv/stack'
        // 배포 서비스 목록은 Build & restart / Smoke test 의 prod-측 heredoc 안 SERVICES
        // 변수에 하드코딩 (groovy<->shell quoting 회피). 변경 시 양쪽 모두 갱신할 것.
        // mal.kr prod DB: stack-db 컨테이너 + mal_app role + app DB
        // run-migrations.sh 가 PG_CONTAINER/PG_USER/PG_DB env 로 override 가능.
        PG_CONTAINER     = 'stack-db'
        PG_USER          = 'mal_app'
        PG_DB            = 'app'
    }

    stages {
        // SCM-polling 트리거의 path 필터. 무관한 path 만 바뀐 push 가 잡을 발동시키면
        // web(Next.js) 풀빌드 + mal-web/mal-crawler 재생성을 무의미하게 수행한다.
        // web/crawler/db/compose/Jenkinsfile 변경 시에만 자동 배포. 수동 빌드(UserIdCause),
        // 스케줄(TimerTrigger) 등 비-SCM 트리거는 항상 실행.
        stage('Deploy') {
            when {
                beforeAgent true
                anyOf {
                    changeset 'web/**'
                    changeset 'crawler/**'
                    changeset 'db/**'
                    changeset 'docker-compose.yml'
                    changeset 'Jenkinsfile'
                    not { triggeredBy 'SCMTrigger' }
                }
            }
            stages {
                stage('Checkout') {
                    steps { checkout scm }
                }

                stage('Web type-check') {
                    steps {
                        dir('web') {
                            sh '''
                                set -e
                                if [ -f package-lock.json ]; then npm ci; else npm install; fi
                                npx tsc --noEmit
                                # lint 는 non-blocking
                                npm run lint --if-present || echo "[warn] lint returned non-zero; continuing"
                            '''
                        }
                    }
                }

                stage('Rsync') {
                    steps {
                        sshagent(credentials: ['service-ssh']) {
                            sh '''
                                set -e
                                ssh -o StrictHostKeyChecking=accept-new $DEPLOY_HOST "mkdir -p $DEPLOY_PATH"
                                rsync -az --delete \
                                    --exclude='.git/' \
                                    --exclude='**/node_modules/' \
                                    --exclude='**/.next/' \
                                    --exclude='**/__pycache__/' \
                                    --exclude='**/*.pyc' \
                                    --exclude='**/.venv/' \
                                    ./ $DEPLOY_HOST:$DEPLOY_PATH/
                            '''
                        }
                    }
                }

                stage('Migrate DB') {
                    // Build/restart 직전에 마이그레이션을 적용해야 새 컬럼/테이블 참조하는
                    // 새 코드가 실행됐을 때 500 (column does not exist) 을 회피한다.
                    // run-migrations.sh 는 _migrations_applied 추적 테이블로 idempotent.
                    steps {
                        sshagent(credentials: ['service-ssh']) {
                            sh '''
                                set -e
                                ssh $DEPLOY_HOST "PG_CONTAINER=$PG_CONTAINER PG_USER=$PG_USER PG_DB=$PG_DB bash $DEPLOY_PATH/db/run-migrations.sh"
                            '''
                        }
                    }
                }

                stage('Build & restart') {
                    steps {
                        sshagent(credentials: ['service-ssh']) {
                            sh '''
                                set -e
                                # 수동 정지 컨테이너 보존 + 명시적 stop+rm 후 up. heredoc 으로 prod 측에
                                # 스크립트 그대로 전달 — quoting 단순화.
                                #
                                # 수동 정지(exit 0 또는 143=SIGTERM) 상태의 컨테이너는 deploy 대상에서 제외.
                                # 운영자가 `docker stop X` 로 멈춰둔 서비스를 Jenkins 자동 배포가 강제로
                                # 부활시키는 사고 방지. 다시 띄울 땐 `docker start X`.
                                # 크래시/OOM(exit code ≠ 0 && ≠ 143)은 일반 redeploy.
                                ssh $DEPLOY_HOST 'bash -s' <<'REMOTE'
set -e
cd /srv/stack

SERVICES="mal-web mal-crawler"

DEPLOY=""
for svc in $SERVICES; do
    s=$(docker inspect -f "{{.State.Status}}:{{.State.ExitCode}}" "$svc" 2>/dev/null || echo missing:)
    case "$s" in
        exited:0|exited:143)
            echo "[deploy] skip $svc — manually stopped ($s). Use 'docker start $svc' to bring back."
            ;;
        *)
            DEPLOY="$DEPLOY $svc"
            ;;
    esac
done
DEPLOY=$(echo "$DEPLOY" | xargs)

if [ -z "$DEPLOY" ]; then
    echo "[deploy] all listed services were manually stopped — nothing to do"
    exit 0
fi
echo "[deploy] target: $DEPLOY"

# 서비스당 1개씩 직렬 빌드 — `docker compose build $DEPLOY` 의 BuildKit 병렬 빌드가
# 8GB prod 호스트를 OOM 으로 몬 전례 (betlive 2026-09-12). mal-web(Next.js) 는 특히 무겁다.
for svc in $DEPLOY; do
    echo "[build] $svc"
    docker compose build "$svc"
done
# 명시적 stop+rm 후 up — `up -d --no-deps` 가 기존 컨테이너를 stop 안 하고 새 컨테이너를
# create 하려다 이름 충돌로 실패하는 케이스 회피. --remove-orphans 는 compose 에 없는
# 좀비만 정리하므로 정의된 서비스는 건드리지 않는다.
docker stop $DEPLOY 2>/dev/null || true
docker rm -f $DEPLOY 2>/dev/null || true
docker compose up -d --no-deps --remove-orphans $DEPLOY
REMOTE
                            '''
                        }
                    }
                }

                stage('Smoke test') {
                    steps {
                        sshagent(credentials: ['service-ssh']) {
                            sh '''
                                set -e
                                # mal-web 은 HTTP(:4000) 헬스, mal-crawler 는 status 만 확인.
                                # running 또는 수동 정지(exit 0/143) 는 OK, 그 외(crashed/missing) 는 실패.
                                ssh $DEPLOY_HOST 'bash -s' <<'REMOTE'
set -e
fail=0

web=$(docker inspect -f "{{.State.Status}}:{{.State.ExitCode}}" mal-web 2>/dev/null || echo "missing:")
case "$web" in
    running:*)
        if curl -fsS http://127.0.0.1:4000 >/dev/null; then
            echo "[smoke] mal-web OK ($web)"
        else
            echo "[smoke] mal-web running but HTTP :4000 실패"; fail=1
        fi ;;
    exited:0|exited:143)
        echo "[smoke] mal-web manually stopped ($web) — tolerated" ;;
    *)
        echo "[smoke] mal-web PROBLEM ($web)"; fail=1 ;;
esac

cr=$(docker inspect -f "{{.State.Status}}:{{.State.ExitCode}}" mal-crawler 2>/dev/null || echo "missing:")
case "$cr" in
    running:*)
        echo "[smoke] mal-crawler OK ($cr)" ;;
    exited:0|exited:143)
        echo "[smoke] mal-crawler manually stopped ($cr) — tolerated" ;;
    *)
        echo "[smoke] mal-crawler PROBLEM ($cr)"; fail=1 ;;
esac

exit $fail
REMOTE
                            '''
                        }
                    }
                }
            }  // Deploy.stages
        }      // Deploy
    }

    post {
        // Telegram 알림 — prod /srv/stack/.env 의 TELEGRAM_BOT_TOKEN/CHAT_ID 재사용.
        // 다른 Jenkinsfile들과 동일 패턴으로 표준화 (이전엔 Jenkins credential 'telegram-bot-token' 사용).
        success {
            echo "[mal] deployed ✔"
            sshagent(credentials: ['service-ssh']) {
                sh """
                    ssh \$DEPLOY_HOST 'set +e; . /srv/stack/.env 2>/dev/null; [ -n "\$TELEGRAM_BOT_TOKEN" ] && [ -n "\$TELEGRAM_CHAT_ID" ] || exit 0; curl -sS --max-time 10 -d "chat_id=\$TELEGRAM_CHAT_ID" -d "parse_mode=Markdown" --data-urlencode "text=✅ *mal* Jenkins #${env.BUILD_NUMBER} 배포 완료 (${env.BUILD_URL})" "https://api.telegram.org/bot\$TELEGRAM_BOT_TOKEN/sendMessage" > /dev/null' || true
                """
            }
        }
        failure {
            echo "[mal] FAILED"
            sshagent(credentials: ['service-ssh']) {
                sh """
                    ssh \$DEPLOY_HOST 'set +e; . /srv/stack/.env 2>/dev/null; [ -n "\$TELEGRAM_BOT_TOKEN" ] && [ -n "\$TELEGRAM_CHAT_ID" ] || exit 0; curl -sS --max-time 10 -d "chat_id=\$TELEGRAM_CHAT_ID" -d "parse_mode=Markdown" --data-urlencode "text=🚨 *mal* Jenkins #${env.BUILD_NUMBER} 빌드 실패 (${env.BUILD_URL})" "https://api.telegram.org/bot\$TELEGRAM_BOT_TOKEN/sendMessage" > /dev/null' || true
                """
            }
        }
    }
}
