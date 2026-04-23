// mal.kr 레포 파이프라인.
// - web (Next.js) 빌드 + crawler (Python/uv) 배포
// - db/migrations/*.sql 자동 적용 (Build & restart 사이의 'Migrate' stage).
//   기존엔 수동 run-migrations.sh 였지만 nickname/owners 두 번 prod 500 발생 →
//   재발 방지로 자동화. 마이그레이션은 _migrations_applied 테이블로 idempotent.

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
        COMPOSE_SERVICES = 'mal-web mal-crawler'
        // mal.kr prod DB: stack-db 컨테이너 + mal_app role + app DB
        // run-migrations.sh 가 PG_CONTAINER/PG_USER/PG_DB env 로 override 가능.
        PG_CONTAINER     = 'stack-db'
        PG_USER          = 'mal_app'
        PG_DB            = 'app'
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
                        ssh $DEPLOY_HOST "cd $STACK_PATH && docker compose build $COMPOSE_SERVICES && docker compose up -d --no-deps $COMPOSE_SERVICES"
                    '''
                }
            }
        }

        stage('Smoke test') {
            steps {
                sshagent(credentials: ['service-ssh']) {
                    sh '''
                        set -e
                        ssh $DEPLOY_HOST "curl -fsS http://127.0.0.1:4000 >/dev/null"
                    '''
                }
            }
        }
    }

    post {
        success { echo "[mal] deployed ✔" }
        failure { echo "[mal] FAILED" }
    }
}
