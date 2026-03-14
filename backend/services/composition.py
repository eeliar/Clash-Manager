from sqlmodel import Session, select

from models import ConfigProfile, GroupMember, Proxy, ProxyGroup, Rule
from services.imports import ensure_unique_name

BUILTIN_TARGETS = {"DIRECT", "REJECT", "PROXY"}
PROXY_COPY_FIELDS = (
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
)


def copy_profile_items(
    session: Session,
    *,
    target_profile: ConfigProfile,
    source_profile_id: int,
    proxy_ids: list[int],
    group_ids: list[int],
    rule_ids: list[int],
) -> dict:
    source_profile = session.get(ConfigProfile, source_profile_id)
    if not source_profile:
        raise ValueError("Source profile not found")

    source_proxies = session.exec(
        select(Proxy).where(Proxy.profile_id == source_profile.id)
    ).all()
    source_groups = session.exec(
        select(ProxyGroup)
        .where(ProxyGroup.profile_id == source_profile.id)
        .order_by(ProxyGroup.order.asc(), ProxyGroup.id.asc())
    ).all()
    source_rules = session.exec(
        select(Rule)
        .where(Rule.profile_id == source_profile.id, Rule.id.in_(rule_ids))
        .order_by(Rule.order.asc(), Rule.id.asc())
    ).all()

    proxies_by_id = {proxy.id: proxy for proxy in source_proxies}
    proxies_by_name = {proxy.name: proxy for proxy in source_proxies}
    groups_by_id = {group.id: group for group in source_groups}
    groups_by_name = {group.name: group for group in source_groups}

    selected_proxy_ids = {proxy_id for proxy_id in proxy_ids if proxy_id in proxies_by_id}
    selected_group_ids: set[int] = set()

    def include_group(group_id: int) -> None:
        if group_id in selected_group_ids:
            return
        group = groups_by_id.get(group_id)
        if not group:
            return
        selected_group_ids.add(group_id)
        for member in sorted(group.members, key=lambda item: item.order):
            if member.proxy_id and member.proxy_id in proxies_by_id:
                selected_proxy_ids.add(member.proxy_id)
            elif member.target_name and member.target_name not in BUILTIN_TARGETS:
                nested_group = groups_by_name.get(member.target_name)
                if nested_group:
                    include_group(nested_group.id)
                    continue
                nested_proxy = proxies_by_name.get(member.target_name)
                if nested_proxy:
                    selected_proxy_ids.add(nested_proxy.id)

    for group_id in group_ids:
        include_group(group_id)

    for rule in source_rules:
        if rule.target in BUILTIN_TARGETS:
            continue
        target_group = groups_by_name.get(rule.target)
        if target_group:
            include_group(target_group.id)
            continue
        target_proxy = proxies_by_name.get(rule.target)
        if target_proxy:
            selected_proxy_ids.add(target_proxy.id)

    target_proxy_names = {
        proxy.name
        for proxy in session.exec(
            select(Proxy).where(Proxy.profile_id == target_profile.id)
        ).all()
    }
    target_group_names = {
        group.name
        for group in session.exec(
            select(ProxyGroup).where(ProxyGroup.profile_id == target_profile.id)
        ).all()
    }
    target_existing_targets = target_proxy_names | target_group_names | BUILTIN_TARGETS

    copied_proxies: dict[int, Proxy] = {}
    proxy_name_map: dict[str, str] = {}
    for proxy_id in sorted(
        selected_proxy_ids,
        key=lambda item: (proxies_by_id[item].name.lower(), item),
    ):
        source_proxy = proxies_by_id[proxy_id]
        next_name = ensure_unique_name(source_proxy.name, target_proxy_names, "Copied Proxy")
        payload = {
            field: getattr(source_proxy, field)
            for field in PROXY_COPY_FIELDS
        }
        payload.update(
            {
                "profile_id": target_profile.id,
                "name": next_name,
                "status": "unknown",
                "latency": None,
                "import_source_id": None,
                "import_source_key": None,
            }
        )
        copied = Proxy(**payload)
        session.add(copied)
        session.commit()
        session.refresh(copied)
        copied_proxies[proxy_id] = copied
        proxy_name_map[source_proxy.name] = copied.name
        target_existing_targets.add(copied.name)

    last_group = session.exec(
        select(ProxyGroup)
        .where(ProxyGroup.profile_id == target_profile.id)
        .order_by(ProxyGroup.order.desc(), ProxyGroup.id.desc())
    ).first()
    next_group_order = (last_group.order + 1) if last_group else 0

    copied_groups: dict[int, ProxyGroup] = {}
    group_name_map: dict[str, str] = {}
    for source_group in source_groups:
        if source_group.id not in selected_group_ids:
            continue
        next_name = ensure_unique_name(source_group.name, target_group_names, "Copied Group")
        copied_group = ProxyGroup(
            profile_id=target_profile.id,
            name=next_name,
            type=source_group.type,
            order=next_group_order,
            test_url=source_group.test_url,
            interval=source_group.interval,
            tolerance=source_group.tolerance,
        )
        session.add(copied_group)
        session.commit()
        session.refresh(copied_group)
        copied_groups[source_group.id] = copied_group
        group_name_map[source_group.name] = copied_group.name
        target_existing_targets.add(copied_group.name)
        next_group_order += 1

    for source_group in source_groups:
        if source_group.id not in copied_groups:
            continue
        copied_group = copied_groups[source_group.id]
        for order, member in enumerate(sorted(source_group.members, key=lambda item: item.order)):
            if member.proxy_id and member.proxy_id in copied_proxies:
                session.add(
                    GroupMember(
                        group_id=copied_group.id,
                        proxy_id=copied_proxies[member.proxy_id].id,
                        order=order,
                    )
                )
                continue

            if not member.target_name:
                continue

            target_name = member.target_name
            if target_name in group_name_map:
                target_name = group_name_map[target_name]
            elif target_name in proxy_name_map:
                target_name = proxy_name_map[target_name]
            elif target_name not in target_existing_targets:
                continue

            session.add(
                GroupMember(
                    group_id=copied_group.id,
                    target_name=target_name,
                    order=order,
                )
            )

    last_rule = session.exec(
        select(Rule)
        .where(Rule.profile_id == target_profile.id)
        .order_by(Rule.order.desc(), Rule.id.desc())
    ).first()
    next_rule_order = (last_rule.order + 1) if last_rule else 0

    copied_rule_count = 0
    for source_rule in source_rules:
        target_name = source_rule.target
        if target_name in group_name_map:
            target_name = group_name_map[target_name]
        elif target_name in proxy_name_map:
            target_name = proxy_name_map[target_name]
        elif target_name not in target_existing_targets:
            continue

        session.add(
            Rule(
                profile_id=target_profile.id,
                type=source_rule.type,
                payload=source_rule.payload,
                target=target_name,
                order=next_rule_order,
                comment=source_rule.comment,
            )
        )
        next_rule_order += 1
        copied_rule_count += 1

    session.commit()
    return {
        "source_profile_id": source_profile.id,
        "target_profile_id": target_profile.id,
        "copied_proxy_count": len(copied_proxies),
        "copied_group_count": len(copied_groups),
        "copied_rule_count": copied_rule_count,
    }
