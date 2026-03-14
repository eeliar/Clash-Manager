from datetime import datetime

from sqlmodel import Session, select

from models import ConfigProfile, ConfigRevision, GroupMember, Proxy, ProxyGroup, Rule
from services.generator import generate_yaml, sanitize_yaml_string
from services.parser import is_valid_wireguard_key, parse_clash_yaml
from services.profiles import clear_profile_configuration, resolve_profile


def _next_revision_version(session: Session, profile_id: int) -> int:
    revisions = session.exec(
        select(ConfigRevision)
        .where(ConfigRevision.profile_id == profile_id)
        .order_by(ConfigRevision.version.desc())
    ).all()
    return (revisions[0].version + 1) if revisions else 1


def validate_profile_config(session: Session, profile_id: int | None = None) -> dict:
    profile = resolve_profile(session, profile_id)
    errors: list[str] = []
    warnings: list[str] = []

    proxies = session.exec(select(Proxy).where(Proxy.profile_id == profile.id)).all()
    groups = session.exec(
        select(ProxyGroup)
        .where(ProxyGroup.profile_id == profile.id)
        .order_by(ProxyGroup.order.asc(), ProxyGroup.id.asc())
    ).all()

    proxy_names = [proxy.name for proxy in proxies]
    group_names = [group.name for group in groups]

    if len(proxy_names) != len(set(proxy_names)):
        errors.append("Proxy names must be unique within a profile.")
    if len(group_names) != len(set(group_names)):
        errors.append("Group names must be unique within a profile.")

    for proxy in proxies:
        if proxy.type != "wireguard":
            continue
        if not is_valid_wireguard_key(proxy.private_key):
            errors.append(f'WireGuard proxy "{proxy.name}" has an invalid private key.')
        if not is_valid_wireguard_key(proxy.public_key):
            errors.append(f'WireGuard proxy "{proxy.name}" has an invalid public key.')

    try:
        yaml_str = generate_yaml(session, profile.id)
        parse_clash_yaml(yaml_str)
    except Exception as exc:
        errors.append(f"Generated config is invalid: {exc}")

    if not proxies:
        warnings.append("Profile has no proxies configured.")
    if not groups:
        warnings.append("Profile has no proxy groups configured.")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "profile_id": profile.id,
    }


def create_revision_snapshot(
    session: Session,
    profile_id: int | None = None,
    *,
    status: str = "draft",
    source: str = "manual",
    change_summary: str | None = None,
) -> ConfigRevision:
    profile = resolve_profile(session, profile_id)
    revision = ConfigRevision(
        profile_id=profile.id,
        version=_next_revision_version(session, profile.id),
        status=status,
        source=source,
        change_summary=change_summary,
        generated_yaml=generate_yaml(session, profile.id),
        published_at=datetime.utcnow() if status == "published" else None,
    )
    session.add(revision)
    session.commit()
    session.refresh(revision)
    return revision


def publish_profile_revision(
    session: Session,
    profile_id: int | None = None,
    *,
    source: str = "manual",
    change_summary: str | None = None,
) -> ConfigRevision:
    profile = resolve_profile(session, profile_id)
    validation = validate_profile_config(session, profile.id)
    if not validation["valid"]:
        raise ValueError("; ".join(validation["errors"]))

    published_revisions = session.exec(
        select(ConfigRevision).where(
            ConfigRevision.profile_id == profile.id,
            ConfigRevision.status == "published",
        )
    ).all()
    for revision in published_revisions:
        revision.status = "archived"
        session.add(revision)
    session.commit()

    return create_revision_snapshot(
        session,
        profile.id,
        status="published",
        source=source,
        change_summary=change_summary,
    )


def import_parsed_profile_data(
    session: Session,
    profile: ConfigProfile,
    parsed_data: dict,
) -> None:
    clear_profile_configuration(session, profile.id)

    proxy_objs = {}
    for proxy_data in parsed_data["proxies"]:
        proxy_data["profile_id"] = profile.id
        proxy = Proxy(**proxy_data)
        session.add(proxy)
        session.commit()
        session.refresh(proxy)
        proxy_objs[proxy.name] = proxy

    group_objs = {}
    for group_order, group_data in enumerate(parsed_data["groups"]):
        group = ProxyGroup(
            name=group_data.get("name"),
            type=group_data.get("type"),
            profile_id=profile.id,
            order=group_order,
        )
        session.add(group)
        session.commit()
        session.refresh(group)
        group_objs[group.name] = group

    for group_data in parsed_data["groups"]:
        group_name = group_data.get("name")
        for order, proxy_name in enumerate(group_data.get("proxies", [])):
            if proxy_name in proxy_objs:
                member = GroupMember(
                    group_id=group_objs[group_name].id,
                    proxy_id=proxy_objs[proxy_name].id,
                    order=order,
                )
            else:
                member = GroupMember(
                    group_id=group_objs[group_name].id,
                    target_name=proxy_name,
                    order=order,
                )
            session.add(member)

    for order, rule_data in enumerate(parsed_data["rules"]):
        rule_data["profile_id"] = profile.id
        rule = Rule(**rule_data, order=order)
        session.add(rule)

    session.commit()


def rollback_to_revision(session: Session, revision_id: int) -> ConfigRevision:
    revision = session.get(ConfigRevision, revision_id)
    if not revision:
        raise ValueError("Revision not found")
    if not revision.generated_yaml:
        raise ValueError("Revision has no generated YAML")

    parsed_data = parse_clash_yaml(revision.generated_yaml)
    profile = resolve_profile(session, revision.profile_id)
    import_parsed_profile_data(session, profile, parsed_data)

    return publish_profile_revision(
        session,
        profile.id,
        source="rollback",
        change_summary=f"Rollback to revision {revision.version}",
    )


def get_latest_published_revision(
    session: Session,
    profile_id: int | None = None,
) -> ConfigRevision | None:
    profile = resolve_profile(session, profile_id)
    return session.exec(
        select(ConfigRevision)
        .where(
            ConfigRevision.profile_id == profile.id,
            ConfigRevision.status == "published",
        )
        .order_by(ConfigRevision.version.desc())
    ).first()


def get_served_config(
    session: Session,
    profile_id: int | None = None,
) -> tuple[ConfigProfile, str, ConfigRevision | None]:
    profile = resolve_profile(session, profile_id)
    published = get_latest_published_revision(session, profile.id)
    if published and published.generated_yaml:
        sanitized_yaml, _removed_proxy_names = sanitize_yaml_string(published.generated_yaml)
        return profile, sanitized_yaml, published
    return profile, generate_yaml(session, profile.id), None


def get_served_yaml(session: Session, profile_id: int | None = None) -> str:
    _profile, yaml_str, _revision = get_served_config(session, profile_id)
    return yaml_str
