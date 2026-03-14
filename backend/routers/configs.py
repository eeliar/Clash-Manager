from fastapi import APIRouter, Depends, Response, UploadFile, File, HTTPException, BackgroundTasks
from sqlmodel import Session
from routers.auth import get_current_user
from database import get_session
from services.generator import generate_yaml, save_config
from services.parser import parse_clash_yaml
import os
from services.profiles import resolve_profile
from services.revisions import create_revision_snapshot, import_parsed_profile_data

router = APIRouter(prefix="/config", tags=["config"])

@router.get("/main.yaml", response_class=Response)
def get_main_config(
    profile_id: int | None = None,
    session: Session = Depends(get_session),
    _user: str = Depends(get_current_user),
):
    yaml_str = generate_yaml(session, profile_id=profile_id)
    return Response(content=yaml_str, media_type="application/x-yaml")

@router.get("/versions")
def list_versions(_user: str = Depends(get_current_user)):
    """List available static configuration files."""
    backup_dir = "/app/configs/backups"
    configs_dir = "/app/configs"
    versions = []
    
    if os.path.exists(configs_dir):
        versions.extend([f for f in os.listdir(configs_dir) if f.endswith(".yaml")])
    if os.path.exists(backup_dir):
        versions.extend([f"backups/{f}" for f in os.listdir(backup_dir) if f.endswith(".yaml")])
        
    return {"versions": versions}

@router.get("/download/{path:path}")
def download_version(path: str, _user: str = Depends(get_current_user)):
    """Download a static yaml configuration directly, allowing self-hosting multiple versions."""
    if ".." in path or str(path).startswith("/"):
        raise HTTPException(400, "Invalid path")
        
    full_path = os.path.join("/app/configs", path)
    if not os.path.exists(full_path):
        raise HTTPException(404, "Config not found")
        
    with open(full_path, "r", encoding="utf-8") as f:
        content = f.read()
    return Response(content=content, media_type="application/x-yaml")

@router.delete("/versions")
def delete_version(path: str, _user: str = Depends(get_current_user)):
    if ".." in path or str(path).startswith("/"):
        raise HTTPException(400, "Invalid path")
    full_path = os.path.join("/app/configs", path)
    if not os.path.exists(full_path) or full_path == "/app/configs/main.yaml":
        raise HTTPException(404, "Cannot delete config")
    try:
        os.remove(full_path)
        return {"message": "Deleted"}
    except:
        raise HTTPException(500, "Deletion failed")

@router.post("/upload")
async def upload_config(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    profile_id: int | None = None,
    session: Session = Depends(get_session),
    _user: str = Depends(get_current_user),
):
    """Uploads a YAML, saves it safely, and imports its state into the Live Database Editor."""
    content = await file.read()
    yaml_str = content.decode("utf-8")
    
    try:
        parsed_data = parse_clash_yaml(yaml_str)
    except ValueError as e:
        raise HTTPException(400, str(e))

    profile = resolve_profile(session, profile_id)
    import_parsed_profile_data(session, profile, parsed_data)
    
    # Backup the uploaded file exactly as it was into configs/
    safe_name = "".join([c for c in file.filename if c.isalpha() or c.isdigit() or c in " ._-"]).rstrip()
    if not safe_name.endswith(".yaml"): safe_name += ".yaml"
    os.makedirs("/app/configs", exist_ok=True)
    out_path = os.path.join("/app/configs", safe_name)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(yaml_str)
        
    save_config(session)
    create_revision_snapshot(
        session,
        profile.id,
        status="draft",
        source="upload",
        change_summary=f"Imported {safe_name}",
    )
    
    # Trigger background connectivity test
    # Trigger background connectivity test
    from services.tester import run_tests
    background_tasks.add_task(run_tests)
    
    return {"message": "Config uploaded successfully, database synced.", "version": safe_name}

@router.post("/activate/{path:path}")
def activate_version(
    path: str,
    background_tasks: BackgroundTasks,
    profile_id: int | None = None,
    session: Session = Depends(get_session),
    _user: str = Depends(get_current_user),
):
    """Loads an existing version from disk into the live Database."""
    if ".." in path or path.startswith("/"): raise HTTPException(400, "Invalid path")
    full_path = os.path.join("/app/configs", path)
    if not os.path.exists(full_path): raise HTTPException(404, "Not found")
    
    with open(full_path, "r", encoding="utf-8") as f: yaml_str = f.read()
    try: parsed_data = parse_clash_yaml(yaml_str)
    except ValueError as e: raise HTTPException(400, str(e))
        
    profile = resolve_profile(session, profile_id)
    import_parsed_profile_data(session, profile, parsed_data)
    save_config(session)
    create_revision_snapshot(
        session,
        profile.id,
        status="draft",
        source="activate-version",
        change_summary=f"Activated {path} into draft",
    )
    from services.tester import run_tests
    background_tasks.add_task(run_tests)
    return {"message": "Activated version"}

