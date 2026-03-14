import hashlib
from datetime import datetime, timezone
from email.utils import format_datetime, parsedate_to_datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from fastapi.responses import Response as FastAPIResponse
from sqlmodel import Session, select
from database import get_session
from models import SubscriptionToken
from settings import get_settings
from services.profiles import get_or_create_default_profile
from services.revisions import get_served_config

router = APIRouter(prefix="/sub", tags=["subscription"])


def to_http_datetime(value: datetime) -> str:
    value = normalize_utc_datetime(value)
    return format_datetime(value, usegmt=True)


def normalize_utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.replace(microsecond=0)


def parse_if_modified_since(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def normalize_etag(value: str | None) -> str | None:
    if not value:
        return None
    return value.strip().strip('"')


def build_cache_headers(
    *,
    etag: str,
    last_modified: datetime | None,
    max_age: int,
    profile_slug: str,
) -> dict[str, str]:
    headers = {
        "ETag": f'"{etag}"',
        "Cache-Control": f"private, max-age={max_age}, must-revalidate",
        "Content-Disposition": f'attachment; filename="{profile_slug}.yaml"',
    }
    if last_modified is not None:
        headers["Last-Modified"] = to_http_datetime(last_modified)
    return headers


@router.get("/{uuid}", response_class=Response)
@router.get("/", response_class=Response)
def get_subscription(
    session: Session = Depends(get_session),
    uuid: str = None,
    token: str | None = Query(default=None),
    header_token: str | None = Header(default=None, alias="X-Subscription-Token"),
    if_none_match: str | None = Header(default=None),
    if_modified_since: str | None = Header(default=None),
):
    settings = get_settings()
    provided_token = uuid or token or header_token
    profile_id = None

    if provided_token:
        db_token = session.exec(
            select(SubscriptionToken).where(SubscriptionToken.token == provided_token)
        ).first()
        if db_token and db_token.is_active:
            if db_token.expires_at and db_token.expires_at <= datetime.utcnow():
                raise HTTPException(status_code=401, detail="Subscription token expired")
            db_token.last_used_at = datetime.utcnow()
            if db_token.device:
                db_token.device.last_seen_at = datetime.utcnow()
                session.add(db_token.device)
            session.add(db_token)
            session.commit()
            profile_id = db_token.profile_id

    if profile_id is None:
        if provided_token != settings.subscription_token:
            raise HTTPException(status_code=401, detail="Invalid subscription token")
        profile_id = get_or_create_default_profile(session).id

    profile, yaml_str, revision = get_served_config(session, profile_id)
    last_modified = revision.published_at if revision else None
    etag = hashlib.sha256(yaml_str.encode("utf-8")).hexdigest()
    headers = build_cache_headers(
        etag=etag,
        last_modified=last_modified,
        max_age=settings.subscription_cache_max_age,
        profile_slug=profile.slug,
    )

    request_etag = normalize_etag(if_none_match)
    request_modified_since = parse_if_modified_since(if_modified_since)
    last_modified_utc = normalize_utc_datetime(last_modified) if last_modified else None

    if request_etag == etag:
        return FastAPIResponse(status_code=304, headers=headers)
    if (
        request_modified_since is not None
        and last_modified_utc is not None
        and request_modified_since >= last_modified_utc
    ):
        return FastAPIResponse(status_code=304, headers=headers)

    return Response(content=yaml_str, media_type="application/x-yaml", headers=headers)
