import os
import sys
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine
from sqlmodel.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import get_session
from routers import auth, configs, devices, groups, profiles, proxies, revisions, rules, sources
from routers.auth import get_current_user
from settings import reset_settings_cache


os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["ADMIN_USERNAME"] = "admin"
os.environ["ADMIN_PASSWORD"] = "password123"
os.environ["SUBSCRIPTION_TOKEN"] = "sub-token-123"
reset_settings_cache()

engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)


def get_session_override():
    with Session(engine) as session:
        yield session


proxies.save_config = lambda session: None
groups.save_config = lambda session: None
rules.save_config = lambda session: None
sources.save_config = lambda session: None
configs.save_config = lambda session: None

app = FastAPI()
app.include_router(auth.router)
app.include_router(profiles.router, dependencies=[Depends(get_current_user)])
app.include_router(devices.router, dependencies=[Depends(get_current_user)])
app.include_router(revisions.router, dependencies=[Depends(get_current_user)])
app.include_router(proxies.router, dependencies=[Depends(get_current_user)])
app.include_router(sources.router, dependencies=[Depends(get_current_user)])
app.include_router(groups.router, dependencies=[Depends(get_current_user)])
app.include_router(rules.router, dependencies=[Depends(get_current_user)])
app.include_router(configs.router)
app.dependency_overrides[get_session] = get_session_override

client = TestClient(app)


def admin_headers():
    response = client.post(
        "/auth/token",
        data={"username": "admin", "password": "password123"},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_admin_auth_and_profile_crud():
    unauthorized = client.get("/profiles")
    assert unauthorized.status_code == 401

    headers = admin_headers()
    current_profile = client.get("/profiles/current", headers=headers)
    assert current_profile.status_code == 200
    assert current_profile.json()["slug"] == "default"

    created = client.post(
        "/profiles",
        json={"name": "Public Release", "description": "Test profile"},
        headers=headers,
    )
    assert created.status_code == 200
    payload = created.json()
    assert payload["name"] == "Public Release"
    assert payload["slug"] == "public-release"


def test_config_generation_happy_path():
    headers = admin_headers()
    profile_id = client.get("/profiles/current", headers=headers).json()["id"]

    proxy = client.post(
        "/proxies",
        json={
            "profile_id": profile_id,
            "name": "Example Node",
            "type": "vless",
            "server": "edge.example.com",
            "port": 443,
            "uuid": "example-node-uuid",
            "tls": True,
        },
        headers=headers,
    )
    assert proxy.status_code == 200
    proxy_id = proxy.json()["id"]

    group = client.post(
        "/groups",
        json={
            "profile_id": profile_id,
            "name": "PROXY",
            "type": "select",
            "test_url": "http://www.gstatic.com/generate_204",
            "interval": 300,
            "tolerance": 50,
        },
        headers=headers,
    )
    assert group.status_code == 200
    group_id = group.json()["id"]

    attach = client.post(f"/groups/{group_id}/members/{proxy_id}", headers=headers)
    assert attach.status_code == 200

    rule = client.post(
        "/rules",
        json={
            "profile_id": profile_id,
            "type": "DOMAIN-SUFFIX",
            "payload": "example.com",
            "target": "PROXY",
            "order": 0,
            "comment": "Route example traffic",
        },
        headers=headers,
    )
    assert rule.status_code == 200

    config_response = client.get("/config/main.yaml", params={"profile_id": profile_id}, headers=headers)
    assert config_response.status_code == 200
    assert "Example Node" in config_response.text
    assert "# Route example traffic" in config_response.text
