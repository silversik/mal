// mal.kr 레포 파이프라인.
// - web (Next.js) 빌드 + crawler (Python/uv) 배포
// - db/migrations/*.sql 도 함께 올리지만, 실제 적용은 별도 run-migrations.sh 수행 (수동 트리거).

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
