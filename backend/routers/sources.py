from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, SQLModel, select

from database import get_session
from models import Proxy, SubscriptionSource
from services.generator import save_config
from services.profiles import resolve_profile
from services.imports import delete_proxy_and_members
from services.sources import serialize_source, sync_subscription_source

router = APIRouter(prefix="/sources", tags=["sources"])


class SourceCreate(SQLModel):
    name: str
    url: str
    profile_id: Optional[int] = None
    is_active: bool = True

    model_config = {
        "json_schema_extra": {
            "example": {
                "profile_id": 1,
                "name": "Primary Feed",
                "url": "https://provider.example/subscription.txt",
                "is_active": True,
            }
        }
    }


class SourceUpdate(SQLModel):
    name: str
    url: str
    is_active: bool = True

    model_config = {
        "json_schema_extra": {
            "example": {
                "name": "Primary Feed",
                "url": "https://provider.example/subscription.txt",
                "is_active": False,
            }
        }
    }


class SourceRead(SQLModel):
    id: int
    profile_id: int
    name: str
    url: str
    is_active: bool
    created_at: datetime
    last_synced_at: Optional[datetime] = None
    last_error: Optional[str] = None
    cached_fetched_at: Optional[datetime] = None


class SourceSyncResponse(SQLModel):
    source: SourceRead
    used_cache: bool
    created: int
    updated: int
    removed: int
    warnings: list[str]
    errors: list[str]


class SourceDeleteResponse(SQLModel):
    message: str


@router.get(
    "/",
    response_model=list[SourceRead],
    summary="List saved subscription sources",
    description="Return all saved subscription feeds for the resolved profile.",
)
def list_sources(
    profile_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    profile = resolve_profile(session, profile_id)
    sources = session.exec(
        select(SubscriptionSource).where(SubscriptionSource.profile_id == profile.id)
    ).all()
    return [SourceRead(**serialize_source(source)) for source in sources]


@router.post(
    "/",
    response_model=SourceSyncResponse,
    summary="Create and sync a subscription source",
    description=(
        "Create a saved subscription URL for a profile, then immediately sync it. "
        "Imported proxies remain source-owned so later refreshes can replace them safely."
    ),
)
def create_source(payload: SourceCreate, session: Session = Depends(get_session)):
    profile = resolve_profile(session, payload.profile_id)
    source = SubscriptionSource(
        profile_id=profile.id,
        name=payload.name,
        url=payload.url,
        is_active=payload.is_active,
    )
    session.add(source)
    session.commit()
    session.refresh(source)

    try:
        return sync_subscription_source(session, source, force=False)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post(
    "/{source_id}/sync",
    response_model=SourceSyncResponse,
    summary="Sync a saved subscription source",
    description=(
        "Refresh a saved source. Cached content is reused for up to 10 minutes unless `force=true`."
    ),
)
def sync_source(
    source_id: int,
    force: bool = Query(default=False),
    session: Session = Depends(get_session),
):
    source = session.get(SubscriptionSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    try:
        return sync_subscription_source(session, source, force=force)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.put(
    "/{source_id}",
    response_model=SourceRead,
    summary="Update a saved subscription source",
    description="Rename a source, change its URL, or enable/disable it without deleting imported proxies.",
)
def update_source(
    source_id: int,
    payload: SourceUpdate,
    session: Session = Depends(get_session),
):
    source = session.get(SubscriptionSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    source.name = payload.name
    source.url = payload.url
    source.is_active = payload.is_active
    session.add(source)
    session.commit()
    session.refresh(source)
    return SourceRead(**serialize_source(source))


@router.delete(
    "/{source_id}",
    response_model=SourceDeleteResponse,
    summary="Delete a subscription source",
    description="Delete a saved source and remove the proxies that were imported from it.",
)
def delete_source(source_id: int, session: Session = Depends(get_session)):
    source = session.get(SubscriptionSource, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    proxies = session.exec(
        select(Proxy).where(Proxy.import_source_id == source.id)
    ).all()
    for proxy in proxies:
        delete_proxy_and_members(session, proxy)
    session.delete(source)
    session.commit()
    save_config(session)
    return {"message": "Source deleted"}
