#!/usr/bin/env bash
# tune.sh  ─  Apply OS-level settings required before testing > ~1 000 connections.
#
# These settings are EPHEMERAL (lost on reboot).  Do NOT apply on production
# without understanding each one.  Safe to run on a local dev machine.
#
# Usage:  sudo bash load-tests/tune.sh

set -euo pipefail

echo "── Raising file descriptor limits ──────────────────────────────────"
# Each WebSocket is a file descriptor.  Default is 1024 per process.
ulimit -n 1048576

echo "── Kernel TCP tunables ──────────────────────────────────────────────"
# Allow more connections in TIME_WAIT state
sysctl -w net.ipv4.tcp_tw_reuse=1              2>/dev/null || true
# Enlarge inbound connection queue (SYN backlog)
sysctl -w net.core.somaxconn=65535             2>/dev/null || true
sysctl -w net.ipv4.tcp_max_syn_backlog=65535   2>/dev/null || true
# Increase ephemeral port range for k6 outbound connections
sysctl -w net.ipv4.ip_local_port_range="1024 65535" 2>/dev/null || true
# Enlarge socket receive buffers (helps with high-throughput WebSocket traffic)
sysctl -w net.core.rmem_max=16777216           2>/dev/null || true
sysctl -w net.core.wmem_max=16777216           2>/dev/null || true

echo ""
echo "── Current limits ──────────────────────────────────────────────────"
ulimit -n
echo "somaxconn: $(cat /proc/sys/net/core/somaxconn)"
echo "port range: $(cat /proc/sys/net/ipv4/ip_local_port_range)"
echo ""
echo "Done.  Now run:"
echo "  k6 run --env VU_COUNT=500 load-tests/baseline.js"
