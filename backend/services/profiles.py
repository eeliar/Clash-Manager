import re
from datetime import datetime

from sqlmodel import Session, delete, select

from models import ConfigProfile, GroupMember, Proxy, ProxyGroup, Rule


def slugify_profile_name(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return base or "profile"


def get_or_create_default_profile(session: Session) -> ConfigProfile:
    profile = session.exec(
        select(ConfigProfile).order_by(
            ConfigProfile.is_active.desc(),
            ConfigProfile.is_default.desc(),
            ConfigProfile.id.asc(),
        )
    ).first()
    if profile:
        return profile

    profile = ConfigProfile(
        name="Default",
        slug="default",
        description="Default configuration profile",
        is_default=True,
        is_active=True,
    )
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile


def resolve_profile(session: Session, profile_id: int | None = None) -> ConfigProfile:
    if profile_id is None:
        return get_or_create_default_profile(session)

    profile = session.get(ConfigProfile, profile_id)
    if not profile:
        raise ValueError("Profile not found")
    return profile


def set_active_profile(session: Session, profile: ConfigProfile) -> ConfigProfile:
    profiles = session.exec(select(ConfigProfile)).all()
    for existing in profiles:
        existing.is_active = existing.id == profile.id
        if existing.id == profile.id:
            existing.updated_at = datetime.utcnow()
        session.add(existing)
    session.commit()
    session.refresh(profile)
    return profile


def clear_profile_configuration(session: Session, profile_id: int) -> None:
    group_ids = session.exec(
        select(ProxyGroup.id).where(ProxyGroup.profile_id == profile_id)
    ).all()
    if group_ids:
        session.exec(delete(GroupMember).where(GroupMember.group_id.in_(group_ids)))

    session.exec(delete(ProxyGroup).where(ProxyGroup.profile_id == profile_id))
    session.exec(delete(Proxy).where(Proxy.profile_id == profile_id))
    session.exec(delete(Rule).where(Rule.profile_id == profile_id))
    session.commit()
