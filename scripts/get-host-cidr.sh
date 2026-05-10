#!/bin/bash
set -euo pipefail

get_primary_iface() {
    ip route show default 2>/dev/null | awk '{print $5; exit}' || {
        echo "Error: No default route found" >&2
        exit 1
    }
}

get_ip_cidr() {
    local iface=$1
    ip addr show "$iface" 2>/dev/null | awk '/inet / {print $2; exit}' || {
        echo "Error: No IP found for interface $iface" >&2
        exit 1
    }
}

get_ip_from_cidr() {
    local cidr=$1
    echo "$cidr" | cut -d'/' -f1
}

get_prefix_from_cidr() {
    local cidr=$1
    echo "$cidr" | cut -d'/' -f2
}

ip_to_int() {
    local ip=$1
    local a b c d
    IFS='.' read -r a b c d <<< "$ip"
    echo $(( (a << 24) + (b << 16) + (c << 8) + d ))
}

int_to_ip() {
    local int=$1
    echo "$((int >> 24 & 255)).$((int >> 16 & 255)).$((int >> 8 & 255)).$((int & 255))"
}

calc_broadcast() {
    local ip=$1
    local prefix=$2
    local ip_int=$(ip_to_int "$ip")
    local mask_int=$(( 0xFFFFFFFF << (32 - prefix) & 0xFFFFFFFF ))
    local bc_int=$(( ip_int | ~mask_int & 0xFFFFFFFF ))
    int_to_ip "$bc_int"
}

main() {
    local primary_iface
    local ip_cidr
    local host_ip
    local prefix
    local broadcast

    primary_iface=$(get_primary_iface)
    ip_cidr=$(get_ip_cidr "$primary_iface")
    host_ip=$(get_ip_from_cidr "$ip_cidr")
    prefix=$(get_prefix_from_cidr "$ip_cidr")
    broadcast=$(calc_broadcast "$host_ip" "$prefix")

    export IFACE=$primary_iface
    export HOST_IP=$host_ip
    export HOST_CIDR=$ip_cidr
    export BROADCAST=$broadcast

    echo "IFACE=$IFACE"
    echo "HOST_IP=$HOST_IP"
    echo "HOST_CIDR=$HOST_CIDR"
    echo "BROADCAST=$BROADCAST"
    echo
}

main
