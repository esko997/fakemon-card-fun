#!/usr/bin/env bash
# Local HTTPS for the tablet: browsers only allow camera + microphone on secure origins.
# Creates a long-lived local CA once (install it on the tablet to remove the warning) and
# re-issues the server certificate whenever this machine's LAN addresses change.
set -euo pipefail

dir="${1:-data/certs}"
mkdir -p "$dir"
cd "$dir"

host="$(hostname)"

if [[ ! -f ca.key ]]; then
  # Name constraints: even if ca.key leaked, it could only vouch for this machine's name and
  # private-network addresses, never for real websites the tablet visits.
  constraints="critical,permitted;DNS:localhost,permitted;DNS:${host},permitted;DNS:local"
  constraints+=",permitted;IP:127.0.0.0/255.0.0.0,permitted;IP:10.0.0.0/255.0.0.0"
  constraints+=",permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout ca.key -out ca.crt -subj "/CN=Fakemon Home CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "nameConstraints=${constraints}" 2>/dev/null
  chmod 600 ca.key
  rm -f server.crt server.sans
fi

sans="DNS:localhost,DNS:${host},DNS:${host}.local,IP:127.0.0.1"
for ip in $(hostname -I); do
  # Only addresses the CA's name constraints allow (10/8, 172.16/12, 192.168/16). Any other SAN,
  # e.g. a VPN's 100.64/10 address, makes clients reject the whole certificate.
  case "$ip" in
    10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) sans+=",IP:${ip}" ;;
  esac
done

if [[ -f server.crt && -f server.sans && "$(cat server.sans)" == "$sans" ]]; then
  exit 0
fi

openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr \
  -subj "/CN=${host}" 2>/dev/null
printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' "$sans" > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 825 -sha256 -extfile server.ext -out server.crt 2>/dev/null
chmod 600 server.key
rm -f server.csr server.ext
echo "$sans" > server.sans
echo "Issued HTTPS certificate for: $sans"
