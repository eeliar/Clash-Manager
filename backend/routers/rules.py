from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import SQLModel, Session, select
from typing import List, Optional
from database import get_session
from models import Rule
from services.generator import save_config
from services.profiles import resolve_profile

router = APIRouter(prefix="/rules", tags=["rules"])


class RuleUpdate(SQLModel):
    type: str
    payload: str
    target: str
    order: int = 0
    profile_id: Optional[int] = None
    comment: Optional[str] = None


class RuleOrderUpdate(SQLModel):
    rule_ids: List[int]


class RuleMutationResponse(SQLModel):
    message: str


@router.get(
    "/",
    response_model=List[Rule],
    summary="List rules for a profile",
    description="Return routing rules ordered exactly as they will be emitted into generated Clash YAML.",
)
def get_rules(profile_id: Optional[int] = None, session: Session = Depends(get_session)):
    profile = resolve_profile(session, profile_id)
    return session.exec(
        select(Rule).where(Rule.profile_id == profile.id).order_by(Rule.order)
    ).all()

@router.post(
    "/",
    response_model=Rule,
    summary="Create a routing rule",
    description="Add a single routing rule to the resolved profile.",
)
def create_rule(rule: Rule, session: Session = Depends(get_session)):
    profile = resolve_profile(session, rule.profile_id)
    rule.profile_id = profile.id
    session.add(rule)
    session.commit()
    session.refresh(rule)
    save_config(session)
    return rule


@router.put(
    "/{rule_id}",
    response_model=Rule,
    summary="Update a routing rule",
    description="Edit a routing rule, including its comment, target, and effective order value.",
)
def update_rule(rule_id: int, payload: RuleUpdate, session: Session = Depends(get_session)):
    rule = session.get(Rule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    profile = resolve_profile(session, payload.profile_id or rule.profile_id)
    rule.profile_id = profile.id
    rule.type = payload.type
    rule.payload = payload.payload
    rule.target = payload.target
    rule.order = payload.order
    rule.comment = payload.comment
    session.add(rule)
    session.commit()
    session.refresh(rule)
    save_config(session)
    return rule


@router.post(
    "/reorder",
    response_model=RuleMutationResponse,
    summary="Reorder all rules in a profile",
    description="Persist a full ordered list of rule IDs for one profile.",
)
def reorder_rules(payload: RuleOrderUpdate, session: Session = Depends(get_session)):
    rules = session.exec(select(Rule).where(Rule.id.in_(payload.rule_ids))).all()
    if len(rules) != len(payload.rule_ids):
        raise HTTPException(status_code=400, detail="Invalid rule reorder payload")

    rules_by_id = {rule.id: rule for rule in rules}
    profile_ids = {rule.profile_id for rule in rules}
    if len(profile_ids) != 1:
        raise HTTPException(status_code=400, detail="Rules must belong to the same profile")

    profile_id = next(iter(profile_ids))
    profile_rules = session.exec(
        select(Rule).where(Rule.profile_id == profile_id).order_by(Rule.order)
    ).all()
    if len(profile_rules) != len(payload.rule_ids):
        raise HTTPException(status_code=400, detail="Rule reorder payload does not include all rules")

    for order, rule_id in enumerate(payload.rule_ids):
        rule = rules_by_id[rule_id]
        rule.order = order
        session.add(rule)

    session.commit()
    save_config(session)
    return {"message": "Rules reordered"}

@router.delete(
    "/{rule_id}",
    response_model=RuleMutationResponse,
    summary="Delete a routing rule",
    description="Delete a rule from the resolved profile and regenerate the live config.",
)
def delete_rule(rule_id: int, session: Session = Depends(get_session)):
    rule = session.get(Rule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
        
    session.delete(rule)
    session.commit()
    save_config(session)
    return {"message": "Rule deleted successfully"}
