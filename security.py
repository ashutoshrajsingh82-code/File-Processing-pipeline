"""Webhook URL validation to reduce SSRF risk."""
import ipaddress
import socket
from urllib.parse import urlparse

def validate_webhook_url(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("webhook_url must be an HTTPS URL without embedded credentials")
    host = parsed.hostname.rstrip(".").lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith((".local", ".internal", ".localhost")):
        raise ValueError("webhook_url host is not publicly routable")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)}
        if not addresses:
            raise ValueError("webhook host did not resolve")
        for address in addresses:
            ip = ipaddress.ip_address(address.split("%", 1)[0])
            if not ip.is_global:
                raise ValueError("webhook_url must resolve only to public IP addresses")
    except socket.gaierror as exc:
        raise ValueError("webhook host could not be resolved") from exc
    return url
