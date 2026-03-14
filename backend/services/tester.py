import socket
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
from urllib.parse import quote

import httpx
from sqlmodel import Session, select

from database import engine
from models import Proxy
from settings import get_settings


def test_proxy(host: str, port: int, timeout: float = 2.5) -> Optional[int]:
    """Measure TCP connect latency for a single proxy endpoint."""
    start = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return int((time.perf_counter() - start) * 1000)
    except OSError:
        return None


def _test_single_proxy(data: tuple[int, str, int], timeout: float) -> tuple[int, Optional[int]]:
    proxy_id, host, port = data
    ms = test_proxy(host, port, timeout=timeout)
    return proxy_id, ms


def build_mihomo_client() -> Optional[httpx.Client]:
    settings = get_settings()
    if not settings.mihomo_external_controller or not settings.mihomo_secret:
        return None

    return httpx.Client(
        base_url=settings.mihomo_controller_url.rstrip("/"),
        headers={"Authorization": f"Bearer {settings.mihomo_secret}"},
        timeout=max(settings.mihomo_delay_timeout_ms / 1000 + 2, 5),
    )


def run_controller_delay_test(
    client: httpx.Client,
    proxy_name: str,
) -> Optional[int]:
    settings = get_settings()
    response = client.get(
        f"/proxies/{quote(proxy_name, safe='')}/delay",
        params={
            "url": settings.mihomo_delay_test_url,
            "timeout": settings.mihomo_delay_timeout_ms,
        },
    )
    response.raise_for_status()
    payload = response.json()
    delay = payload.get("delay")
    if isinstance(delay, int) and delay >= 0:
        return delay
    return None


def _test_single_proxy_via_mihomo(proxy_id: int, proxy_name: str) -> tuple[int, Optional[int]]:
    settings = get_settings()
    with httpx.Client(
        base_url=settings.mihomo_controller_url.rstrip("/"),
        headers={"Authorization": f"Bearer {settings.mihomo_secret}"},
        timeout=max(settings.mihomo_delay_timeout_ms / 1000 + 2, 5),
    ) as client:
        return proxy_id, run_controller_delay_test(client, proxy_name)


def run_tests(
    profile_id: Optional[int] = None,
    *,
    max_workers: int = 24,
    timeout: float = 2.5,
) -> dict[str, int | str | None]:
    settings = get_settings()
    with Session(engine) as session:
        statement = select(Proxy)
        if profile_id is not None:
            statement = statement.where(Proxy.profile_id == profile_id)
        proxies = session.exec(statement).all()

    proxy_data = [(proxy.id, proxy.server, proxy.port) for proxy in proxies if proxy.id is not None]
    if not proxy_data:
        return {
            "profile_id": profile_id,
            "tested": 0,
            "online": 0,
            "offline": 0,
            "method": "tcp-connect",
            "delay_url": None,
        }

    worker_count = max(1, min(max_workers, len(proxy_data)))
    results: dict[int, Optional[int]] = {}
    method = "tcp-connect"

    controller_client = build_mihomo_client()
    if controller_client is not None:
        try:
            controller_client.get("/version").raise_for_status()
            controller_client.close()
            controller_client = None
            with ThreadPoolExecutor(max_workers=worker_count) as executor:
                futures = {
                    executor.submit(_test_single_proxy_via_mihomo, proxy.id, proxy.name): proxy.id
                    for proxy in proxies
                    if proxy.id is not None
                }
                for future in as_completed(futures):
                    proxy_id = futures[future]
                    try:
                        _, latency = future.result()
                        results[proxy_id] = latency
                    except Exception:
                        results[proxy_id] = None
            method = "mihomo-delay"
        except Exception:
            results.clear()
        finally:
            if controller_client is not None:
                controller_client.close()

    if not results:
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {
                executor.submit(_test_single_proxy, proxy_entry, timeout): proxy_entry[0]
                for proxy_entry in proxy_data
            }
            for future in as_completed(futures):
                proxy_id, latency = future.result()
                results[proxy_id] = latency

    with Session(engine) as session:
        statement = select(Proxy)
        if profile_id is not None:
            statement = statement.where(Proxy.profile_id == profile_id)
        proxies = session.exec(statement).all()

        online = 0
        offline = 0
        for proxy in proxies:
            if proxy.id not in results:
                continue

            latency = results[proxy.id]
            if latency is None:
                proxy.status = "offline"
                proxy.latency = 0
                offline += 1
            else:
                proxy.status = "online"
                proxy.latency = latency
                online += 1
            session.add(proxy)

        session.commit()

    return {
        "profile_id": profile_id,
        "tested": len(proxy_data),
        "online": online,
        "offline": offline,
        "method": method,
        "delay_url": settings.mihomo_delay_test_url if method == "mihomo-delay" else None,
    }
