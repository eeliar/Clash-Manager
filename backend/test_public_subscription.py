import os
import sys
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, create_engine
from sqlmodel.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import get_session
from routers import auth, devices, groups, profiles, proxies, revisions, rules, sub
from routers.auth import get_current_user
from settings import reset_settings_cache


os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["ADMIN_USERNAME"] = "admin"
os.environ["ADMIN_PASSWORD"] = "password123"
os.environ["SUBSCRIPTION_TOKEN"] = "sub-token-123"
os.environ["PUBLIC_BASE_URL"] = "https://manager.example"
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

app = FastAPI()
app.include_router(auth.router)
app.include_router(profiles.router, dependencies=[Depends(get_current_user)])
app.include_router(devices.router, dependencies=[Depends(get_current_user)])
app.include_router(revisions.router, dependencies=[Depends(get_current_user)])
app.include_router(proxies.router, dependencies=[Depends(get_current_user)])
app.include_router(groups.router, dependencies=[Depends(get_current_user)])
app.include_router(rules.router, dependencies=[Depends(get_current_user)])
app.include_router(sub.router)
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


def test_tokenized_subscription_delivery():
    headers = admin_headers()
    profile_id = client.get("/profiles/current", headers=headers).json()["id"]

    proxy = client.post(
        "/proxies",
        json={
            "profile_id": profile_id,
            "name": "Subscription Node",
            "type": "vless",
            "server": "subscription.example.com",
            "port": 443,
            "uuid": "subscription-node-uuid",
            "tls": True,
        },
        headers=headers,
    )
    assert proxy.status_code == 200

    device = client.post(
        "/devices",
        json={"profile_id": profile_id, "name": "Personal Phone", "platform": "ios"},
        headers=headers,
    )
    assert device.status_code == 200
    device_id = device.json()["id"]

    token = client.post(
        f"/devices/{device_id}/tokens",
        json={"name": "default"},
        headers=headers,
    )
    assert token.status_code == 200
    token_payload = token.json()
    assert token_payload["subscription_url"].startswith("https://manager.example/sub/")

    subscription = client.get(f"/sub/{token_payload['token']}")
    assert subscription.status_code == 200
    assert "Subscription Node" in subscription.text

    invalid = client.get("/sub/not-a-real-token")
    assert invalid.status_code == 401
