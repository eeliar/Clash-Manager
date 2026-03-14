from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import SQLModel, Session, select
from typing import List, Optional
from database import get_session
from models import ProxyGroup, GroupMember, Proxy, Rule
from services.generator import save_config
from services.profiles import resolve_profile

router = APIRouter(prefix="/groups", tags=["groups"])


class GroupUpdate(SQLModel):
    name: str
    type: str
    test_url: str = "http://www.gstatic.com/generate_204"
    interval: int = 300
    tolerance: int = 50
    profile_id: Optional[int] = None


class GroupMemberRef(SQLModel):
    proxy_id: Optional[int] = None
    target_name: Optional[str] = None


class GroupMemberOrderUpdate(SQLModel):
    members: List[GroupMemberRef]


class GroupOrderUpdate(SQLModel):
    group_ids: List[int]

@router.get("/")
def get_groups(profile_id: Optional[int] = None, session: Session = Depends(get_session)):
    profile = resolve_profile(session, profile_id)
    groups = session.exec(
        select(ProxyGroup)
        .where(ProxyGroup.profile_id == profile.id)
        .order_by(ProxyGroup.order.asc(), ProxyGroup.id.asc())
    ).all()
    result = []
    for g in groups:
        g_data = g.model_dump()
        members = []
        for gm in sorted(g.members, key=lambda member: member.order):
            if gm.proxy:
                members.append(gm.proxy.model_dump())
            elif gm.target_name:
                members.append(
                    {
                        "id": f"target_{gm.target_name}",
                        "name": gm.target_name,
                        "type": "target",
                        "status": "unknown",
                        "is_target": True,
                        "target_kind": (
                            "builtin" if gm.target_name in {"DIRECT", "REJECT"} else "group"
                        ),
                    }
                )
        g_data["members"] = members
        result.append(g_data)
    return result

@router.post("/", response_model=ProxyGroup)
def create_group(payload: GroupUpdate, session: Session = Depends(get_session)):
    try:
        profile = resolve_profile(session, payload.profile_id)
        last_group = session.exec(
            select(ProxyGroup)
            .where(ProxyGroup.profile_id == profile.id)
            .order_by(ProxyGroup.order.desc(), ProxyGroup.id.desc())
        ).first()
        group = ProxyGroup(
            profile_id=profile.id,
            name=payload.name,
            type=payload.type,
            order=(last_group.order + 1) if last_group else 0,
            test_url=payload.test_url,
            interval=payload.interval,
            tolerance=payload.tolerance,
        )
        session.add(group)
        session.commit()
        session.refresh(group)
        save_config(session)
        return group
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{group_id}", response_model=ProxyGroup)
def update_group(group_id: int, payload: GroupUpdate, session: Session = Depends(get_session)):
    group = session.get(ProxyGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    profile = resolve_profile(session, payload.profile_id or group.profile_id)
    group.profile_id = profile.id
    group.name = payload.name
    group.type = payload.type
    group.test_url = payload.test_url
    group.interval = payload.interval
    group.tolerance = payload.tolerance
    session.add(group)
    session.commit()
    session.refresh(group)
    save_config(session)
    return group

@router.delete("/{group_id}")
def delete_group(group_id: int, session: Session = Depends(get_session)):
    group = session.get(ProxyGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if group.name == "PROXY":
        raise HTTPException(status_code=400, detail="Primary PROXY selector cannot be deleted")

    fallback_target = "DIRECT"
    primary_selector = session.exec(
        select(ProxyGroup).where(
            ProxyGroup.profile_id == group.profile_id,
            ProxyGroup.name == "PROXY",
            ProxyGroup.id != group.id,
        )
    ).first()
    if primary_selector:
        fallback_target = "PROXY"

    proxy_with_same_name = session.exec(
        select(Proxy).where(
            Proxy.profile_id == group.profile_id,
            Proxy.name == group.name,
        )
    ).first()

    owned_members = session.exec(
        select(GroupMember).where(GroupMember.group_id == group.id)
    ).all()
    for member in owned_members:
        session.delete(member)

    selector_references = session.exec(
        select(GroupMember)
        .join(ProxyGroup, ProxyGroup.id == GroupMember.group_id)
        .where(
            ProxyGroup.profile_id == group.profile_id,
            GroupMember.target_name == group.name,
        )
    ).all()
    for member in selector_references:
        session.delete(member)

    if not proxy_with_same_name:
        affected_rules = session.exec(
            select(Rule).where(
                Rule.profile_id == group.profile_id,
                Rule.target == group.name,
            )
        ).all()
        for rule in affected_rules:
            rule.target = fallback_target
            session.add(rule)

    session.delete(group)
    session.commit()
    save_config(session)
    return {"message": "Group deleted successfully"}


@router.post("/reorder")
def reorder_groups(
    payload: GroupOrderUpdate,
    profile_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    profile = resolve_profile(session, profile_id)
    groups = session.exec(
        select(ProxyGroup)
        .where(ProxyGroup.profile_id == profile.id)
        .order_by(ProxyGroup.order.asc(), ProxyGroup.id.asc())
    ).all()
    existing_ids = [group.id for group in groups]
    if sorted(payload.group_ids) != sorted(existing_ids):
        raise HTTPException(status_code=400, detail="Group order payload does not match profile state")

    groups_by_id = {group.id: group for group in groups}
    for order, group_id in enumerate(payload.group_ids):
        group = groups_by_id[group_id]
        group.order = order
        session.add(group)

    session.commit()
    save_config(session)
    return {"message": "Groups reordered"}


@router.post("/{group_id}/members/reorder")
def reorder_group_members(
    group_id: int,
    payload: GroupMemberOrderUpdate,
    session: Session = Depends(get_session),
):
    group = session.get(ProxyGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")

    members_by_proxy_id = {
        member.proxy_id: member for member in group.members if member.proxy_id is not None
    }
    members_by_target = {
        member.target_name: member for member in group.members if member.target_name
    }

    if len(payload.members) != len(group.members):
        raise HTTPException(status_code=400, detail="Member list does not match group state")

    ordered_members: List[GroupMember] = []
    for ref in payload.members:
        matched_member = None
        if ref.proxy_id is not None:
            matched_member = members_by_proxy_id.get(ref.proxy_id)
        elif ref.target_name:
            matched_member = members_by_target.get(ref.target_name)

        if not matched_member or matched_member in ordered_members:
            raise HTTPException(status_code=400, detail="Invalid group member order payload")
        ordered_members.append(matched_member)

    for order, member in enumerate(ordered_members):
        member.order = order
        session.add(member)

    session.commit()
    save_config(session)
    return {"message": "Group members reordered"}

@router.post("/{group_id}/members/{proxy_id}")
def attach_proxy_to_group(group_id: int, proxy_id: int, session: Session = Depends(get_session)):
    group = session.get(ProxyGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
        
    proxy = session.get(Proxy, proxy_id)
    if not proxy:
        raise HTTPException(status_code=404, detail="Proxy not found")
    if proxy.profile_id != group.profile_id:
        raise HTTPException(status_code=400, detail="Proxy belongs to a different profile")
        
    # check if already exists
    for m in group.members:
        if m.proxy_id == proxy_id:
            return {"message": "Already added."}
            
    gm = GroupMember(group_id=group_id, proxy_id=proxy_id, order=len(group.members))
    session.add(gm)
    session.commit()
    save_config(session)
    return {"message": "Proxy attached to group."}

@router.delete("/{group_id}/members/{proxy_id}")
def detach_proxy_from_group(group_id: int, proxy_id: int, session: Session = Depends(get_session)):
    group = session.get(ProxyGroup, group_id)
    if not group: return {"error": "Group not found"}
    for m in group.members:
        if m.proxy_id == proxy_id:
            session.delete(m)
            session.commit()
            save_config(session)
            return {"message": "Detached"}
    return {"message": "Not found"}

@router.post("/{group_id}/target/{target_name}")
def attach_target_to_group(group_id: int, target_name: str, session: Session = Depends(get_session)):
    group = session.get(ProxyGroup, group_id)
    if not group: raise HTTPException(status_code=404, detail="Group not found")
    if target_name == group.name:
        raise HTTPException(status_code=400, detail="A group cannot target itself")

    if target_name not in {"DIRECT", "REJECT"}:
        target_group = session.exec(
            select(ProxyGroup).where(
                ProxyGroup.profile_id == group.profile_id,
                ProxyGroup.name == target_name,
            )
        ).first()
        if not target_group:
            raise HTTPException(status_code=404, detail="Selector target group not found")

    for m in group.members:
        if m.target_name == target_name:
            return {"message": "Already added."}
    gm = GroupMember(group_id=group_id, target_name=target_name, order=len(group.members))
    session.add(gm)
    session.commit()
    save_config(session)
    return {"message": "Target attached"}


@router.delete("/{group_id}/target/{target_name}")
def detach_target_from_group(group_id: int, target_name: str, session: Session = Depends(get_session)):
    group = session.get(ProxyGroup, group_id)
    if not group: return {"error": "Group not found"}
    for m in group.members:
        if m.target_name == target_name:
            session.delete(m)
            session.commit()
            save_config(session)
            return {"message": "Detached"}
    return {"message": "Not found"}
