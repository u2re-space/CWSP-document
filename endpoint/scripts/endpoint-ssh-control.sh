#!/usr/bin/env bash

set -euo pipefail

SSH_OPTS=(
    -o BatchMode=yes
    -o ConnectTimeout=10
)

HOST_LINUX="u2re-dev@192.168.0.200"
HOST_WINDOWS="U2RE@192.168.0.110"
LINUX_ROOT="/home/u2re-dev/U2RE.space/apps/CrossWord/src/endpoint"
WINDOWS_ROOT="C:/Users/U2RE/endpoint-portable"
PM2_APP_NAME="cws"

ACTION="${1:-status}"
TARGET="${2:-both}"

run_linux() {
    ssh "${SSH_OPTS[@]}" "$HOST_LINUX" "source ~/.nvm/nvm.sh >/dev/null 2>&1 || true; $1"
}

run_windows() {
    ssh "${SSH_OPTS[@]}" "$HOST_WINDOWS" "$1"
}

linux_start() {
    run_linux "bash -lc 'cd \"$LINUX_ROOT\" && \
        if command -v pm2 >/dev/null 2>&1; then \
            if [ -f ecosystem.config.cjs ]; then \
                pm2 restart \"$PM2_APP_NAME\" --update-env || pm2 start ecosystem.config.cjs --update-env; \
            else \
                echo \"[linux] pm2 available but ecosystem.config.cjs is missing\"; \
                npm run start; \
            fi; \
        else \
            if ! command -v node >/dev/null 2>&1; then echo \"[linux] node is missing\"; exit 1; fi; \
            nohup npm run start >/tmp/airpad-endpoint.log 2>&1 & \
        fi'"
}

linux_restart() {
    run_linux "bash -lc 'cd \"$LINUX_ROOT\" && \
        if command -v pm2 >/dev/null 2>&1; then \
            if [ -f ecosystem.config.cjs ]; then \
                pm2 restart \"$PM2_APP_NAME\" --update-env || pm2 start ecosystem.config.cjs --update-env; \
            else \
                npm run start; \
            fi; \
        else \
            if ! command -v node >/dev/null 2>&1; then echo \"[linux] node is missing\"; exit 1; fi; \
            pkill -f \"node .*server/index.ts\" 2>/dev/null || true; \
            nohup npm run start >/tmp/airpad-endpoint.log 2>&1 & \
        fi'"
}

linux_stop() {
    run_linux "bash -lc 'cd \"$LINUX_ROOT\" && \
        if command -v pm2 >/dev/null 2>&1; then \
            pm2 stop \"$PM2_APP_NAME\" 2>/dev/null || true; \
            pm2 delete \"$PM2_APP_NAME\" 2>/dev/null || true; \
        else \
            pkill -f \"node .*server/index.ts\" 2>/dev/null || true; \
        fi'"
}

linux_status() {
    run_linux "bash -lc 'cd \"$LINUX_ROOT\"; echo === 200 \(linux\) ===; \
        command -v node || echo node: missing; \
        command -v pm2 || echo pm2: missing; \
        if command -v pm2 >/dev/null 2>&1; then pm2 list; fi; \
        ss -ltnp 2>/dev/null | grep -E \"(:8080|:8443)\" || true; \
        if [ -f /tmp/airpad-endpoint.log ]; then echo -- /tmp/airpad-endpoint.log tail; tail -n 30 /tmp/airpad-endpoint.log; fi'"
}

windows_start() {
    run_windows "cmd /c \"cd /d \"$WINDOWS_ROOT\" && if not exist \"ecosystem.config.cjs\" (call run.cmd) else (where pm2 >nul 2>nul && (pm2 list ^| findstr /C:\"$PM2_APP_NAME\" >nul && pm2 restart $PM2_APP_NAME --update-env || pm2 start ecosystem.config.cjs --update-env) || call run.cmd)\""
}

windows_restart() {
    run_windows "cmd /c \"cd /d \"$WINDOWS_ROOT\" && if not exist \"ecosystem.config.cjs\" (call run.cmd) else (where pm2 >nul 2>nul && (pm2 restart $PM2_APP_NAME --update-env || pm2 start ecosystem.config.cjs --update-env) || call run.cmd)\""
}

windows_stop() {
    run_windows "cmd /c \"cd /d \"$WINDOWS_ROOT\" && where pm2 >nul 2>nul && (pm2 stop $PM2_APP_NAME 2>nul || true) && (pm2 delete $PM2_APP_NAME 2>nul || true)\""
}

windows_status() {
    run_windows "cmd /c \"cd /d \"$WINDOWS_ROOT\" && echo === 110 (windows) === && if exist \"ecosystem.config.cjs\" (echo [portable] ecosystem.config.cjs: yes) else (echo [portable] ecosystem.config.cjs: no) && if exist run.cmd (echo [portable] run.cmd: yes) else (echo [portable] run.cmd: no) && where pm2 >nul 2>nul && pm2 list || echo pm2: missing && echo -- LISTENERS && netstat -ano | findstr :8080 || true && netstat -ano | findstr :8443 || true\""
}

windows_logs() {
    run_windows "cmd /c \"cd /d \"$WINDOWS_ROOT\" && (if exist run.out.log type run.out.log) && (if exist run.err.log type run.err.log)\""
}

case "$TARGET" in
    200|linux)
        case "$ACTION" in
            start) linux_start ;;
            restart) linux_restart ;;
            stop) linux_stop ;;
            status) linux_status ;;
            logs) run_linux 'bash -lc "tail -n 30 /tmp/airpad-endpoint.log 2>/dev/null || true"' ;;
            *) echo "Unsupported action: $ACTION"; exit 1 ;;
        esac
        ;;
    110|win|windows)
        case "$ACTION" in
            start) windows_start ;;
            restart) windows_restart ;;
            stop) windows_stop ;;
            status) windows_status ;;
            logs) windows_logs ;;
            *) echo "Unsupported action: $ACTION"; exit 1 ;;
        esac
        ;;
    both|all)
        case "$ACTION" in
            start)
                linux_start
                windows_start
                ;;
            restart)
                linux_restart
                windows_restart
                ;;
            stop)
                linux_stop
                windows_stop
                ;;
            status)
                linux_status
                windows_status
                ;;
            logs)
                linux_status
                windows_logs
                ;;
            *)
                echo "Unsupported action for both: $ACTION"
                exit 1
                ;;
        esac
        ;;
    *)
        echo "Unknown target: $TARGET"
        exit 1
        ;;
esac
