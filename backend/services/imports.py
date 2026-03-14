from sqlmodel import Session, select

from models import GroupMember, Proxy

PROXY_FIELD_NAMES = (
    "name",
    "type",
    "server",
    "port",
    "uuid",
    "network",
    "tls",
    "udp",
    "flow",
    "sni",
    "public_key",
    "short_id",
    "fingerprint",
    "cipher",
    "password",
    "private_key",
    "ip_address",
    "dns_servers",
    "mtu",
    "awg_jc",
    "awg_jmin",
    "awg_jmax",
    "awg_s1",
    "awg_s2",
    "awg_h1",
    "awg_h2",
    "awg_h3",
    "awg_h4",
    "status",
    "latency",
    "import_source_id",
    "import_source_key",
)


def ensure_unique_name(raw_name: str | None, existing_names: set[str], fallback: str) -> str:
    base_name = (raw_name or "").strip() or fallback
    candidate = base_name
    suffix = 2
    while candidate in existing_names:
        candidate = f"{base_name} ({suffix})"
        suffix += 1
    existing_names.add(candidate)
    return candidate


def apply_proxy_data(proxy: Proxy, payload: dict) -> Proxy:
    for field in PROXY_FIELD_NAMES:
        if field in payload:
            setattr(proxy, field, payload.get(field))
    return proxy


def delete_proxy_and_members(session: Session, proxy: Proxy) -> None:
    members = session.exec(
        select(GroupMember).where(GroupMember.proxy_id == proxy.id)
    ).all()
    for member in members:
        session.delete(member)
    session.delete(proxy)
