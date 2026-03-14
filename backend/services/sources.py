import logging
from datetime import datetime, timedelta

import httpx
from sqlalchemy import or_
from sqlmodel import Session, select

from models import Proxy, SubscriptionSource
from services.generator import save_config
from services.imports import apply_proxy_data, delete_proxy_and_members, ensure_unique_name
from services.parser import parse_subscription_payload

logger = logging.getLogger(__name__)

SOURCE_CACHE_TTL = timedelta(minutes=10)


def serialize_source(source: SubscriptionSource) -> dict:
    return {
        "id": source.id,
        "profile_id": source.profile_id,
        "name": source.name,
        "url": source.url,
        "is_active": source.is_active,
        "created_at": source.created_at,
        "last_synced_at": source.last_synced_at,
        "last_error": source.last_error,
        "cached_fetched_at": source.cached_fetched_at,
    }


def fetch_source_content(source: SubscriptionSource, force: bool = False) -> tuple[str, bool]:
    now = datetime.utcnow()
    if (
        not force
        and source.cached_content
        and source.cached_fetched_at
        and now - source.cached_fetched_at < SOURCE_CACHE_TTL
    ):
        return source.cached_content, True

    with httpx.Client(follow_redirects=True, timeout=15.0) as client:
        response = client.get(source.url)
        response.raise_for_status()
        content = response.text

    source.cached_content = content
    source.cached_fetched_at = now
    return content, False


def sync_subscription_source(
    session: Session,
    source: SubscriptionSource,
    *,
    force: bool = False,
) -> dict:
    if not source.is_active:
        return {
            "source": serialize_source(source),
            "used_cache": False,
            "created": 0,
            "updated": 0,
            "removed": 0,
            "warnings": ["Source is disabled; sync skipped."],
            "errors": [],
        }

    try:
        raw_content, used_cache = fetch_source_content(source, force=force)
        parsed = parse_subscription_payload(raw_content)
        existing_source_proxies = session.exec(
            select(Proxy).where(Proxy.import_source_id == source.id)
        ).all()
        existing_by_key = {
            proxy.import_source_key: proxy
            for proxy in existing_source_proxies
            if proxy.import_source_key
        }

        reserved_names = {
            proxy.name
            for proxy in session.exec(
                select(Proxy).where(
                    Proxy.profile_id == source.profile_id,
                    or_(
                        Proxy.import_source_id != source.id,
                        Proxy.import_source_id == None,
                    ),
                )
            ).all()
        }

        seen_keys: set[str] = set()
        created = 0
        updated = 0
        removed = 0

        for entry in parsed["entries"]:
            source_key = entry["source_key"]
            if source_key in seen_keys:
                parsed["warnings"].append(
                    f"Line {entry['line_number']}: duplicate entry skipped"
                )
                continue
            seen_keys.add(source_key)

            payload = dict(entry["proxy"])
            existing_proxy = existing_by_key.get(source_key)
            desired_name = payload.get("name")

            if existing_proxy and existing_proxy.name == desired_name and desired_name not in reserved_names:
                final_name = desired_name
                reserved_names.add(final_name)
            else:
                final_name = ensure_unique_name(
                    desired_name,
                    reserved_names,
                    "Imported Proxy",
                )

            payload["name"] = final_name
            payload["import_source_id"] = source.id
            payload["import_source_key"] = source_key

            if existing_proxy:
                apply_proxy_data(existing_proxy, payload)
                session.add(existing_proxy)
                updated += 1
            else:
                proxy = Proxy(profile_id=source.profile_id, **payload)
                session.add(proxy)
                created += 1

        stale_proxies = [
            proxy
            for proxy in existing_source_proxies
            if proxy.import_source_key not in seen_keys
        ]
        for proxy in stale_proxies:
            delete_proxy_and_members(session, proxy)
            removed += 1

        source.last_synced_at = datetime.utcnow()
        source.last_error = None
        session.add(source)
        session.commit()
        save_config(session)

        return {
            "source": serialize_source(source),
            "used_cache": used_cache,
            "created": created,
            "updated": updated,
            "removed": removed,
            "warnings": parsed["warnings"],
            "errors": parsed["errors"],
        }
    except Exception as exc:
        source.last_error = str(exc)
        session.add(source)
        session.commit()
        logger.exception("Failed to sync subscription source %s", source.id)
        raise
