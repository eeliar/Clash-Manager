from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from database import get_session
from models import ConfigRevision
from services.profiles import resolve_profile
from services.revisions import (
    create_revision_snapshot,
    publish_profile_revision,
    rollback_to_revision,
    validate_profile_config,
)

router = APIRouter(prefix="/revisions", tags=["revisions"])


class RevisionAction(SQLModel):
    change_summary: Optional[str] = None
    source: str = "manual"


@router.get("/profiles/{profile_id}")
def list_profile_revisions(profile_id: int, session: Session = Depends(get_session)):
    profile = resolve_profile(session, profile_id)
    return session.exec(
        select(ConfigRevision)
        .where(ConfigRevision.profile_id == profile.id)
        .order_by(ConfigRevision.version.desc())
    ).all()


@router.get("/profiles/{profile_id}/validate")
def validate_profile(profile_id: int, session: Session = Depends(get_session)):
    return validate_profile_config(session, profile_id)


@router.post("/profiles/{profile_id}/draft", response_model=ConfigRevision)
def snapshot_draft(
    profile_id: int,
    payload: RevisionAction,
    session: Session = Depends(get_session),
):
    try:
        return create_revision_snapshot(
            session,
            profile_id,
            status="draft",
            source=payload.source,
            change_summary=payload.change_summary,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/profiles/{profile_id}/publish", response_model=ConfigRevision)
def publish_profile(
    profile_id: int,
    payload: RevisionAction,
    session: Session = Depends(get_session),
):
    try:
        return publish_profile_revision(
            session,
            profile_id,
            source=payload.source,
            change_summary=payload.change_summary,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{revision_id}/rollback", response_model=ConfigRevision)
def rollback_revision(revision_id: int, session: Session = Depends(get_session)):
    try:
        return rollback_to_revision(session, revision_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
