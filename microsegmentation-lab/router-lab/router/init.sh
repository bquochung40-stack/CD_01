#!/bin/sh
set -eu

# Rules affect only this isolated router container's network namespace.
iptables -F FORWARD
iptables -A FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -s 10.10.10.10 -d 10.10.20.10 -p tcp --dport 3000 -j ACCEPT
iptables -A FORWARD -s 10.10.20.10 -d 10.10.30.10 -p tcp --dport 5432 -j ACCEPT
iptables -P FORWARD DROP

exec /usr/lib/frr/docker-start
