import threading
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from database import init_db
from routers import auth, configs, devices, groups, profiles, proxies, revisions, rules, sources, sub
from routers.auth import get_current_user
from services.tester import run_tests
from settings import get_settings

settings = get_settings()

scheduler = BackgroundScheduler()
scheduler.add_job(run_tests, "interval", minutes=5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_runtime()
    init_db()
    threading.Thread(target=run_tests, daemon=True).start()
    scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(
    title=settings.app_name,
    description=(
        "ClashManager is a profile-aware Clash config builder with revision history, "
        "device-scoped subscription delivery, and managed proxy imports."
    ),
    lifespan=lifespan,
    docs_url="/docs" if settings.enable_api_docs else None,
    openapi_url="/openapi.json" if settings.enable_api_docs else None,
    redoc_url=None,
    openapi_tags=[
        {"name": "auth", "description": "Administrative authentication routes."},
        {"name": "profiles", "description": "Profile lifecycle, activation, and selective composition."},
        {"name": "proxies", "description": "Managed proxy CRUD, direct imports, and latency checks."},
        {"name": "sources", "description": "Saved subscription sources and sync controls."},
        {"name": "groups", "description": "Proxy group composition and ordering."},
        {"name": "rules", "description": "Routing rule management and ordering."},
        {"name": "devices", "description": "Device registration and tokenized subscription delivery."},
        {"name": "revisions", "description": "Drafts, publishes, validation, and rollback."},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class StatusResponse(BaseModel):
    status: str
    message: str | None = None


@app.get(
    "/",
    response_model=StatusResponse,
    summary="Root status",
    description="Simple root endpoint for confirming the API is running.",
)
def read_root():
    return {"status": "ok", "message": "ClashManager API is running"}


@app.get(
    "/health",
    response_model=StatusResponse,
    summary="Health check",
    description="Lightweight health endpoint for load balancers and smoke tests.",
)
def health():
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(profiles.router, dependencies=[Depends(get_current_user)])
app.include_router(devices.router, dependencies=[Depends(get_current_user)])
app.include_router(revisions.router, dependencies=[Depends(get_current_user)])
app.include_router(proxies.router, dependencies=[Depends(get_current_user)])
app.include_router(sources.router, dependencies=[Depends(get_current_user)])
app.include_router(groups.router, dependencies=[Depends(get_current_user)])
app.include_router(rules.router, dependencies=[Depends(get_current_user)])
app.include_router(configs.router)
app.include_router(sub.router)
