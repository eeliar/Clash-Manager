from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from sqlmodel import Session, select
from typing import List, Optional
from database import get_session
from models import Proxy
from services.imports import delete_proxy_and_members, ensure_unique_name
from services.parser import parse_ss, parse_vless, parse_wireguard
from services.generator import save_config
from services.profiles import resolve_profile
from services.tester import run_tests
from services.tagging import apply_tags_to_proxy

from services.tagging import apply_tags_to_proxy
router = APIRouter(prefix="/proxies", tags=["proxies"])


def find_duplicate_proxy(session: Session, profile_id: int, proxy: Proxy) -> Optional[Proxy]:
    query = select(Proxy).where(
        Proxy.profile_id == profile_id,
        Proxy.type == proxy.type,
        Proxy.server == proxy.server,
        Proxy.port == proxy.port,
    )
    if proxy.type == "vless":
        query = query.where(
            Proxy.uuid == proxy.uuid,
            Proxy.public_key == proxy.public_key,
            Proxy.short_id == proxy.short_id,
        )
    elif proxy.type == "wireguard":
        query = query.where(Proxy.public_key == proxy.public_key)
    elif proxy.type == "ss":
        query = query.where(
            Proxy.cipher == proxy.cipher,
            Proxy.password == proxy.password,
        )
    return session.exec(query).first()


def assign_unique_proxy_name(
    session: Session,
    profile_id: int,
    desired_name: str,
    *,
    exclude_proxy_id: Optional[int] = None,
) -> str:
    names = {
        proxy.name
        for proxy in session.exec(
            select(Proxy).where(Proxy.profile_id == profile_id)
        ).all()
        if proxy.id != exclude_proxy_id
    }
    return ensure_unique_name(desired_name, names, "Imported Proxy")


@router.get(
    "/",
    response_model=List[Proxy],
    summary="List proxies for a profile",
    description="Return all managed proxies for the resolved profile.",
)
def get_proxies(profile_id: Optional[int] = None, session: Session = Depends(get_session)):
    profile = resolve_profile(session, profile_id)
    return session.exec(select(Proxy).where(Proxy.profile_id == profile.id)).all()

@router.post(
    "/test",
    summary="Run proxy latency tests",
    description="Execute latency checks for proxies in the resolved profile and return the aggregate result.",
)
def trigger_tests(
    profile_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    profile = resolve_profile(session, profile_id)
    return run_tests(profile.id)

@router.post(
    "/",
    response_model=Proxy,
    summary="Create a proxy",
    description="Create a managed proxy record in the resolved profile.",
)
def create_proxy(proxy: Proxy, allow_duplicates: bool = False, session: Session = Depends(get_session)):
    profile = resolve_profile(session, proxy.profile_id)
    proxy.profile_id = profile.id
    proxy.name = assign_unique_proxy_name(session, profile.id, proxy.name)
    if not allow_duplicates:
        existing = find_duplicate_proxy(session, profile.id, proxy)
        if existing:
            raise HTTPException(status_code=400, detail="Proxy already exists")
    apply_tags_to_proxy(proxy)
    session.add(proxy)
    session.commit()
    session.refresh(proxy)
    save_config(session)
    # trigger background re-generation
    return proxy


@router.put(
    "/{proxy_id}",
    response_model=Proxy,
    summary="Update a proxy",
    description="Edit a managed proxy record while preserving profile-scoped unique naming.",
)
def update_proxy(
    proxy_id: int,
    payload: Proxy,
    session: Session = Depends(get_session),
):
    proxy = session.get(Proxy, proxy_id)
    if not proxy:
        raise HTTPException(status_code=404, detail="Proxy not found")

    profile = resolve_profile(session, payload.profile_id or proxy.profile_id)

    for field in (
        "name",
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
        "status",
        "latency",
    ):
        setattr(proxy, field, getattr(payload, field))
    proxy.profile_id = profile.id
    proxy.name = assign_unique_proxy_name(session, profile.id, proxy.name, exclude_proxy_id=proxy.id)

    apply_tags_to_proxy(proxy)
    session.add(proxy)
    session.commit()
    session.refresh(proxy)
    save_config(session)
    return proxy

@router.post(
    "/parse/vless",
    response_model=Proxy,
    summary="Import a VLESS link",
    description="Parse a `vless://` share link and persist it as a managed Clash proxy.",
)
def parse_vless_endpoint(
    link: str = Form(...),
    profile_id: Optional[int] = Form(default=None),
    allow_duplicates: bool = False,
    session: Session = Depends(get_session),
):
    try:
        parsed_data = parse_vless(link)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    profile = resolve_profile(session, profile_id)
    parsed_data["profile_id"] = profile.id
    parsed_data["name"] = assign_unique_proxy_name(session, profile.id, parsed_data["name"])
    proxy = Proxy(**parsed_data)
    
    if not allow_duplicates:
        existing = find_duplicate_proxy(session, profile.id, proxy)
        if existing:
            raise HTTPException(status_code=400, detail="Proxy already exists")
            
    apply_tags_to_proxy(proxy)
    session.add(proxy)
    session.commit()
    session.refresh(proxy)
    save_config(session)
    return proxy

@router.post(
    "/parse/wireguard",
    response_model=Proxy,
    summary="Import a WireGuard config",
    description="Upload a WireGuard config file and persist it as a managed Clash proxy.",
)
async def parse_wireguard_endpoint(
    file: UploadFile,
    profile_id: Optional[int] = Form(default=None),
    allow_duplicates: bool = False,
    session: Session = Depends(get_session),
):
    content = await file.read()
    try:
        parsed_data = parse_wireguard(content.decode("utf-8"), name=file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
        
    profile = resolve_profile(session, profile_id)
    parsed_data["profile_id"] = profile.id
    parsed_data["name"] = assign_unique_proxy_name(session, profile.id, parsed_data["name"])
    proxy = Proxy(**parsed_data)
    
    if not allow_duplicates:
        existing = find_duplicate_proxy(session, profile.id, proxy)
        if existing:
            raise HTTPException(status_code=400, detail="Proxy already exists")
            
    apply_tags_to_proxy(proxy)
    session.add(proxy)
    session.commit()
    session.refresh(proxy)
    save_config(session)
    return proxy


@router.post(
    "/parse/ss",
    response_model=Proxy,
    summary="Import a Shadowsocks link",
    description="Parse an `ss://` share link and persist it as a managed Clash proxy.",
)
def parse_ss_endpoint(
    link: str = Form(...),
    profile_id: Optional[int] = Form(default=None),
    allow_duplicates: bool = False,
    session: Session = Depends(get_session),
):
    try:
        parsed_data = parse_ss(link)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    profile = resolve_profile(session, profile_id)
    parsed_data["profile_id"] = profile.id
    parsed_data["name"] = assign_unique_proxy_name(session, profile.id, parsed_data["name"])
    proxy = Proxy(**parsed_data)

    if not allow_duplicates:
        existing = find_duplicate_proxy(session, profile.id, proxy)
        if existing:
            raise HTTPException(status_code=400, detail="Proxy already exists")

    apply_tags_to_proxy(proxy)
    session.add(proxy)
    session.commit()
    session.refresh(proxy)
    save_config(session)
    return proxy

@router.delete(
    "/{proxy_id}",
    response_model=dict,
    summary="Delete a proxy",
    description="Delete a proxy and clean up any group memberships that reference it.",
)
def delete_proxy(proxy_id: int, session: Session = Depends(get_session)):
    proxy = session.get(Proxy, proxy_id)
    if not proxy:
        raise HTTPException(status_code=404, detail="Proxy not found")
        
    delete_proxy_and_members(session, proxy)
    session.commit()
    save_config(session)
    return {"message": "Proxy deleted successfully"}
