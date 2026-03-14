import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from database import get_session
from models import Device, SubscriptionToken
from settings import get_settings
from services.profiles import resolve_profile

router = APIRouter(prefix="/devices", tags=["devices"])


class DeviceCreate(SQLModel):
    name: str
    platform: Optional[str] = None
    description: Optional[str] = None
    profile_id: Optional[int] = None


class DeviceMove(SQLModel):
    profile_id: int


class TokenCreate(SQLModel):
    name: str = "default"
    expires_at: Optional[datetime] = None


class SubscriptionTokenRead(SQLModel):
    id: int
    profile_id: int
    device_id: Optional[int] = None
    name: str
    token: str
    is_active: bool
    created_at: datetime
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    subscription_url: str


def normalize_utc_datetime(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def build_subscription_url(token: str) -> str:
    settings = get_settings()
    base_url = settings.normalized_public_base_url
    if base_url:
        return f"{base_url}/sub/{token}"
    return f"/sub/{token}"


def serialize_token(token: SubscriptionToken) -> SubscriptionTokenRead:
    return SubscriptionTokenRead(
        id=token.id,
        profile_id=token.profile_id,
        device_id=token.device_id,
        name=token.name,
        token=token.token,
        is_active=token.is_active,
        created_at=token.created_at,
        expires_at=token.expires_at,
        last_used_at=token.last_used_at,
        subscription_url=build_subscription_url(token.token),
    )


@router.get("/")
def list_devices(profile_id: Optional[int] = None, session: Session = Depends(get_session)):
    profile = resolve_profile(session, profile_id)
    return session.exec(select(Device).where(Device.profile_id == profile.id)).all()


@router.post("/", response_model=Device)
def create_device(payload: DeviceCreate, session: Session = Depends(get_session)):
    profile = resolve_profile(session, payload.profile_id)
    device = Device(
        profile_id=profile.id,
        name=payload.name,
        platform=payload.platform,
        description=payload.description,
    )
    session.add(device)
    session.commit()
    session.refresh(device)
    return device


@router.post("/{device_id}/move", response_model=Device)
def move_device(device_id: int, payload: DeviceMove, session: Session = Depends(get_session)):
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    profile = resolve_profile(session, payload.profile_id)
    if device.profile_id == profile.id:
        return device

    device.profile_id = profile.id
    session.add(device)

    tokens = session.exec(
        select(SubscriptionToken).where(SubscriptionToken.device_id == device.id)
    ).all()
    for token in tokens:
        token.profile_id = profile.id
        session.add(token)

    session.commit()
    session.refresh(device)
    return device


@router.delete("/{device_id}")
def delete_device(device_id: int, session: Session = Depends(get_session)):
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    tokens = session.exec(
        select(SubscriptionToken).where(SubscriptionToken.device_id == device.id)
    ).all()
    for token in tokens:
        session.delete(token)

    session.delete(device)
    session.commit()
    return {"message": "Device deleted"}


@router.get("/{device_id}/tokens", response_model=list[SubscriptionTokenRead])
def list_device_tokens(device_id: int, session: Session = Depends(get_session)):
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    tokens = session.exec(
        select(SubscriptionToken).where(SubscriptionToken.device_id == device.id)
    ).all()
    return [serialize_token(token) for token in tokens]


@router.post("/{device_id}/tokens", response_model=SubscriptionTokenRead)
def create_device_token(device_id: int, payload: TokenCreate, session: Session = Depends(get_session)):
    device = session.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    expires_at = normalize_utc_datetime(payload.expires_at)
    if expires_at and expires_at <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Token expiry must be in the future")

    token = SubscriptionToken(
        profile_id=device.profile_id,
        device_id=device.id,
        name=payload.name,
        token=secrets.token_urlsafe(24),
        expires_at=expires_at,
    )
    session.add(token)
    session.commit()
    session.refresh(token)
    return serialize_token(token)


@router.post("/tokens/{token_id}/rotate", response_model=SubscriptionTokenRead)
def rotate_token(token_id: int, session: Session = Depends(get_session)):
    token = session.get(SubscriptionToken, token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    token.is_active = False
    session.add(token)

    rotated = SubscriptionToken(
        profile_id=token.profile_id,
        device_id=token.device_id,
        name=token.name,
        token=secrets.token_urlsafe(24),
        expires_at=token.expires_at,
    )
    session.add(rotated)
    session.commit()
    session.refresh(rotated)
    return serialize_token(rotated)


def revoke_token(token_id: int, session: Session) -> dict:
    token = session.get(SubscriptionToken, token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")

    token.is_active = False
    session.add(token)
    session.commit()
    return {"message": "Token revoked"}


@router.post("/tokens/{token_id}/revoke")
def deactivate_token(token_id: int, session: Session = Depends(get_session)):
    return revoke_token(token_id, session)


@router.delete("/tokens/{token_id}")
def delete_token(token_id: int, session: Session = Depends(get_session)):
    token = session.get(SubscriptionToken, token_id)
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    if token.is_active:
        raise HTTPException(status_code=400, detail="Active tokens must be revoked before deletion")

    session.delete(token)
    session.commit()
    return {"message": "Token deleted"}
