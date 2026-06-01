from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, delete, select

from database import get_session
from models import ConfigProfile, ConfigRevision, Device, Proxy, ProxyGroup, Rule, SubscriptionToken
from services.composition import copy_profile_items
from services.generator import generate_yaml, save_config
from services.parser import parse_clash_yaml
from services.profiles import (
    clear_profile_configuration,
    get_or_create_default_profile,
    resolve_profile,
    set_active_profile,
    slugify_profile_name,
)
from services.revisions import import_parsed_profile_data

router = APIRouter(prefix="/profiles", tags=["profiles"])


class ProfileCreate(SQLModel):
    name: str
    description: Optional[str] = None
    clone_from_profile_id: Optional[int] = None
    activate_after_create: bool = False


class ProfileCopyItems(SQLModel):
    source_profile_id: int
    proxy_ids: list[int] = []
    group_ids: list[int] = []
    rule_ids: list[int] = []

    model_config = {
        "json_schema_extra": {
            "example": {
                "source_profile_id": 2,
                "proxy_ids": [10, 11],
                "group_ids": [4],
                "rule_ids": [21, 22],
            }
        }
    }


class ProfileSummary(SQLModel):
    id: int
    name: str
    slug: str
    description: Optional[str] = None
    is_default: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime
    proxy_count: int = 0
    group_count: int = 0
    rule_count: int = 0
    revision_count: int = 0
    device_count: int = 0
    token_count: int = 0
    external_controller: Optional[str] = None
    external_ui: Optional[str] = None
    secret: Optional[str] = None
    mixed_port: Optional[int] = None
    allow_lan: Optional[bool] = None


class ProfileCopyItemsResponse(SQLModel):
    copied_proxy_count: int
    copied_group_count: int
    copied_rule_count: int


@router.get(
    "/",
    response_model=list[ProfileSummary],
    summary="List config profiles",
    description="Return all managed profiles with counts for proxies, groups, rules, revisions, devices, and tokens.",
)
def list_profiles(session: Session = Depends(get_session)):
    profiles = session.exec(select(ConfigProfile).order_by(ConfigProfile.name.asc())).all()
    result = []
    for profile in profiles:
        data = profile.model_dump()
        data["proxy_count"] = len(session.exec(select(Proxy.id).where(Proxy.profile_id == profile.id)).all())
        data["group_count"] = len(session.exec(select(ProxyGroup.id).where(ProxyGroup.profile_id == profile.id)).all())
        data["rule_count"] = len(session.exec(select(Rule.id).where(Rule.profile_id == profile.id)).all())
        data["revision_count"] = len(session.exec(select(ConfigRevision.id).where(ConfigRevision.profile_id == profile.id)).all())
        data["device_count"] = len(session.exec(select(Device.id).where(Device.profile_id == profile.id)).all())
        data["token_count"] = len(session.exec(select(SubscriptionToken.id).where(SubscriptionToken.profile_id == profile.id)).all())
        result.append(data)
    return result


@router.get(
    "/current",
    response_model=ConfigProfile,
    summary="Get the active profile",
    description="Return the currently active profile, creating the default profile if needed.",
)
def get_current_profile(session: Session = Depends(get_session)):
    return get_or_create_default_profile(session)


class ProfileUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    external_controller: Optional[str] = None
    external_ui: Optional[str] = None
    secret: Optional[str] = None
    mixed_port: Optional[int] = None
    allow_lan: Optional[bool] = None


@router.put(
    "/{profile_id}",
    response_model=ConfigProfile,
    summary="Update a profile",
    description="Update a profile, including its external configuration options.",
)
def update_profile(profile_id: int, payload: ProfileUpdate, session: Session = Depends(get_session)):
    profile = session.get(ConfigProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)

    session.add(profile)
    session.commit()
    session.refresh(profile)
    save_config(session)
    return profile


@router.post(
    "/",
    response_model=ConfigProfile,
    summary="Create a profile",
    description="Create a new managed profile, optionally cloning configuration from another profile.",
)
def create_profile(payload: ProfileCreate, session: Session = Depends(get_session)):
    source_profile = None
    if payload.clone_from_profile_id is not None:
        source_profile = session.get(ConfigProfile, payload.clone_from_profile_id)
        if not source_profile:
            raise HTTPException(status_code=404, detail="Source profile not found")

    slug_base = slugify_profile_name(payload.name)
    slug = slug_base
    index = 2
    while session.exec(select(ConfigProfile).where(ConfigProfile.slug == slug)).first():
        slug = f"{slug_base}-{index}"
        index += 1

    profile = ConfigProfile(
        name=payload.name,
        slug=slug,
        description=payload.description,
        is_default=False,
        is_active=False,
        updated_at=datetime.utcnow(),
    )
    session.add(profile)
    session.commit()
    session.refresh(profile)

    if source_profile is not None:
        parsed = parse_clash_yaml(generate_yaml(session, source_profile.id))
        import_parsed_profile_data(session, profile, parsed)
        session.refresh(profile)

    if payload.activate_after_create:
        return set_active_profile(session, profile)

    session.refresh(profile)
    return profile


@router.post(
    "/{profile_id}/activate",
    response_model=ConfigProfile,
    summary="Activate a profile",
    description="Switch the active profile used for generation and subscription delivery.",
)
def activate_profile(profile_id: int, session: Session = Depends(get_session)):
    profile = session.get(ConfigProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return set_active_profile(session, profile)


@router.post(
    "/{profile_id}/copy-items",
    response_model=ProfileCopyItemsResponse,
    summary="Copy selected items from another profile",
    description=(
        "Import selected proxies, groups, and rules from a source profile. "
        "Dependencies are copied automatically and naming conflicts are resolved non-destructively."
    ),
)
def copy_profile_selection(
    profile_id: int,
    payload: ProfileCopyItems,
    session: Session = Depends(get_session),
):
    target_profile = resolve_profile(session, profile_id)
    try:
        result = copy_profile_items(
            session,
            target_profile=target_profile,
            source_profile_id=payload.source_profile_id,
            proxy_ids=payload.proxy_ids,
            group_ids=payload.group_ids,
            rule_ids=payload.rule_ids,
        )
        save_config(session)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete(
    "/{profile_id}",
    summary="Delete a profile",
    description="Delete an inactive non-default profile and its associated devices, tokens, revisions, and configuration data.",
)
def delete_profile(profile_id: int, session: Session = Depends(get_session)):
    profile = session.get(ConfigProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    if profile.is_default:
        raise HTTPException(status_code=400, detail="Default profile cannot be deleted")
    if profile.is_active:
        raise HTTPException(status_code=400, detail="Active profile cannot be deleted")

    clear_profile_configuration(session, profile.id)
    session.exec(delete(ConfigRevision).where(ConfigRevision.profile_id == profile.id))
    session.exec(delete(SubscriptionToken).where(SubscriptionToken.profile_id == profile.id))
    session.exec(delete(Device).where(Device.profile_id == profile.id))
    session.delete(profile)
    session.commit()
    return {"message": "Profile deleted"}
