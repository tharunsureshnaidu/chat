#!/usr/bin/env bash
# watch.sh  ─  Show key system counters while a k6 test is running.
# Run this in a separate terminal alongside k6.
#
# Usage:  bash load-tests/watch.sh

set -euo pipefail

echo "═══════════════════════════════════════════════════════════════"
echo " dis load-test monitor"
echo " Ctrl-C to stop"
echo "═══════════════════════════════════════════════════════════════"

while true; do
  clear
  echo "── $(date '+%H:%M:%S') ─────────────────────────────────────────────"

  echo ""
  echo "▶  Open file descriptors (dis process)"
  PID=$(pgrep -x dis 2>/dev/null || echo "")
  if [ -n "$PID" ]; then
    FDS=$(ls /proc/"$PID"/fd 2>/dev/null | wc -l)
    echo "   PID=$PID  open fds=$FDS"
    echo "   (limit: $(cat /proc/"$PID"/limits 2>/dev/null | grep 'open files' | awk '{print $4}'))"
  else
    echo "   dis process not found — is cargo run active?"
  fi

  echo ""
  echo "▶  TCP socket states"
  ss -s 2>/dev/null | grep -E "TCP:|estab|ESTABLISHED" || netstat -s 2>/dev/null | head -5

  echo ""
  echo "▶  ESTABLISHED connections TO :3000"
  CONNS=$(ss -tnp 2>/dev/null | grep ':3000' | grep ESTAB | wc -l)
  echo "   $CONNS"

  echo ""
  echo "▶  CPU + Memory (dis)"
  if [ -n "$PID" ]; then
    ps -p "$PID" -o %cpu,%mem,vsz,rss --no-headers 2>/dev/null | \
      awk '{printf "   CPU=%.1f%%  MEM=%.1f%%  VSZ=%dMB  RSS=%dMB\n", $1, $2, $3/1024, $4/1024}'
  fi

  echo ""
  echo "▶  Redis connected clients"
  redis-cli info clients 2>/dev/null | grep connected_clients || echo "   redis-cli not found"

  echo ""
  echo "▶  Kafka consumer lag (dis-persistence group)"
  if command -v kafka-consumer-groups.sh &>/dev/null; then
    kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
      --group dis-persistence --describe 2>/dev/null | tail -5
  else
    echo "   kafka-consumer-groups.sh not in PATH (docker exec into kafka container)"
  fi

  sleep 3
done
