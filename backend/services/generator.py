import yaml
from copy import deepcopy
from sqlmodel import Session, select
from models import Proxy, ProxyGroup, Rule
import os
from settings import get_settings
from services.profiles import resolve_profile
from services.parser import DEFAULT_AWG_OPTIONS, is_valid_wireguard_key


def sanitize_config_dict(config: dict) -> tuple[dict, list[str], bool]:
    sanitized = deepcopy(config)
    original = deepcopy(config)
    proxies = sanitized.get("proxies") or []
    groups = sanitized.get("proxy-groups") or []
    removed_proxy_names: list[str] = []
    valid_proxy_names: set[str] = set()

    sanitized_proxies = []
    for proxy in proxies:
        if proxy.get("type") == "wireguard":
            private_key = proxy.get("private-key")
            public_key = proxy.get("public-key") or proxy.get("peer-public-key")
            if not is_valid_wireguard_key(private_key) or not is_valid_wireguard_key(public_key):
                if proxy.get("name"):
                    removed_proxy_names.append(str(proxy["name"]))
                continue

        sanitized_proxies.append(proxy)
        if proxy.get("name"):
            valid_proxy_names.add(str(proxy["name"]))

    group_names = {
        str(group["name"])
        for group in groups
        if isinstance(group, dict) and group.get("name")
    }
    allowed_targets = valid_proxy_names | group_names | {"DIRECT", "REJECT"}

    for group in groups:
        members = [member for member in group.get("proxies", []) if member in allowed_targets]
        group["proxies"] = members or ["DIRECT"]

    sanitized["proxies"] = sanitized_proxies
    sanitized["proxy-groups"] = groups
    return sanitized, removed_proxy_names, sanitized != original


def dump_config_yaml(config: dict, rule_comments: list[str | None] | None = None) -> str:
    sections: list[str] = []
    for key, value in config.items():
        if key != "rules":
            sections.append(
                yaml.dump({key: value}, sort_keys=False, allow_unicode=True).rstrip()
            )
            continue

        if not value:
            sections.append("rules: []")
            continue

        rule_lines = ["rules:"]
        comments = rule_comments or [None] * len(value)
        for rule, comment in zip(value, comments):
            if comment:
                for raw_line in comment.splitlines():
                    line = raw_line.strip()
                    if line:
                        rule_lines.append(f"  # {line}")
            rule_lines.append(f"  - {rule}")
        sections.append("\n".join(rule_lines))

    return "\n".join(section for section in sections if section) + "\n"


def sanitize_yaml_string(yaml_str: str) -> tuple[str, list[str]]:
    config = yaml.safe_load(yaml_str) or {}
    sanitized_config, removed_proxy_names, changed = sanitize_config_dict(config)
    if not changed:
        return yaml_str, removed_proxy_names
    return dump_config_yaml(sanitized_config), removed_proxy_names

def generate_yaml(session: Session, profile_id: int | None = None) -> str:
    """Generate a valid Clash Meta YAML string from the database."""
    settings = get_settings()
    profile = resolve_profile(session, profile_id)
    
    # 1. Fetch data
    proxies = session.exec(select(Proxy).where(Proxy.profile_id == profile.id)).all()
    groups = session.exec(
        select(ProxyGroup)
        .where(ProxyGroup.profile_id == profile.id)
        .order_by(ProxyGroup.order.asc(), ProxyGroup.id.asc())
    ).all()
    rules = session.exec(
        select(Rule).where(Rule.profile_id == profile.id).order_by(Rule.order)
    ).all()
    
    # 2. Build proxies list
    proxy_list = []
    valid_proxy_names: set[str] = set()
    for p in proxies:
        if p.type == "wireguard":
            if not is_valid_wireguard_key(p.private_key) or not is_valid_wireguard_key(p.public_key):
                continue

        proxy_dict = {
            "name": p.name,
            "type": p.type,
            "server": p.server,
            "port": p.port,
        }
        
        if p.type == "vless":
            proxy_dict["uuid"] = p.uuid
            if p.network: proxy_dict["network"] = p.network
            proxy_dict["udp"] = p.udp
            if p.tls: proxy_dict["tls"] = True
            if p.flow: proxy_dict["flow"] = p.flow
            if p.sni: proxy_dict["servername"] = p.sni
            
            # REALITY
            if p.public_key or p.short_id:
                proxy_dict["reality-opts"] = {}
                if p.public_key: proxy_dict["reality-opts"]["public-key"] = p.public_key
                if p.short_id: proxy_dict["reality-opts"]["short-id"] = p.short_id
                
            if p.fingerprint: proxy_dict["client-fingerprint"] = p.fingerprint
                
        elif p.type == "wireguard":
            proxy_dict["private-key"] = p.private_key
            if p.public_key: proxy_dict["public-key"] = p.public_key
            if p.ip_address: proxy_dict["ip"] = p.ip_address
            proxy_dict["udp"] = p.udp
            if p.dns_servers:
                proxy_dict["dns"] = [item.strip() for item in p.dns_servers.split(",") if item.strip()]
                proxy_dict["remote-dns-resolve"] = True
            if p.mtu:
                proxy_dict["mtu"] = p.mtu

            awg_options = {
                "jc": p.awg_jc if p.awg_jc is not None else DEFAULT_AWG_OPTIONS["awg_jc"],
                "jmin": p.awg_jmin if p.awg_jmin is not None else DEFAULT_AWG_OPTIONS["awg_jmin"],
                "jmax": p.awg_jmax if p.awg_jmax is not None else DEFAULT_AWG_OPTIONS["awg_jmax"],
                "s1": p.awg_s1 if p.awg_s1 is not None else DEFAULT_AWG_OPTIONS["awg_s1"],
                "s2": p.awg_s2 if p.awg_s2 is not None else DEFAULT_AWG_OPTIONS["awg_s2"],
                "h1": p.awg_h1 if p.awg_h1 is not None else DEFAULT_AWG_OPTIONS["awg_h1"],
                "h2": p.awg_h2 if p.awg_h2 is not None else DEFAULT_AWG_OPTIONS["awg_h2"],
                "h3": p.awg_h3 if p.awg_h3 is not None else DEFAULT_AWG_OPTIONS["awg_h3"],
                "h4": p.awg_h4 if p.awg_h4 is not None else DEFAULT_AWG_OPTIONS["awg_h4"],
            }
            proxy_dict["amnezia-wg-option"] = awg_options
        elif p.type == "ss":
            proxy_dict["cipher"] = p.cipher
            proxy_dict["password"] = p.password
            proxy_dict["udp"] = p.udp
            
        proxy_list.append(proxy_dict)
        valid_proxy_names.add(p.name)
        
    proxy_names = [proxy["name"] for proxy in proxy_list]

    # 3. Build group list
    group_list = []
    for g in groups:
        # get members sorted by order
        members = sorted(g.members, key=lambda m: m.order)
        member_names = []
        for member in members:
            if member.proxy:
                if member.proxy.name not in valid_proxy_names:
                    continue
                member_names.append(member.proxy.name)
            elif member.target_name:
                member_names.append(member.target_name)
        
        group_dict = {
            "name": g.name,
            "type": g.type,
            "proxies": member_names if member_names else ["DIRECT"]
        }
        
        if g.type in ["url-test", "fallback", "load-balance"]:
            group_dict["url"] = g.test_url
            group_dict["interval"] = g.interval
            group_dict["tolerance"] = g.tolerance
            
        group_list.append(group_dict)

    existing_targets = {proxy["name"] for proxy in proxy_list} | {
        group["name"] for group in group_list
    }
    reserved_targets = {"DIRECT", "REJECT"}
    rule_targets = {rule.target for rule in rules if rule.target not in reserved_targets}
    fallback_members = proxy_names or ["DIRECT"]

    for missing_target in sorted(rule_targets - existing_targets):
        group_list.append(
            {
                "name": missing_target,
                "type": "select",
                "proxies": fallback_members,
            }
        )
        
    # 4. Build rules list
    rule_list = []
    rule_comments: list[str | None] = []
    for r in rules:
        if r.type == "MATCH":
            rule_str = f"MATCH,{r.target}"
        else:
            rule_str = f"{r.type},{r.payload},{r.target}"
        rule_list.append(rule_str)
        rule_comments.append(r.comment)
        
    # 5. Build full config
    config = {
        "proxies": proxy_list,
        "proxy-groups": group_list,
        "rules": rule_list,
        # Default Clash Meta settings
        "dns": {
            "enable": True,
            "ipv6": False,
            "enhanced-mode": "fake-ip",
            "nameserver": ["8.8.8.8", "1.1.1.1"]
        },
        "tun": {
            "enable": True,
            "stack": "system",
            "auto-route": True,
            "auto-detect-interface": True
        }
    }

    if settings.mihomo_external_controller:
        config["external-controller"] = settings.mihomo_external_controller
        config["secret"] = settings.mihomo_secret
    
    config, _removed_proxy_names, _changed = sanitize_config_dict(config)
    yaml_str = dump_config_yaml(config, rule_comments)
    return yaml_str

import datetime
import shutil

def save_config(session: Session, output_path: str = "/app/configs/main.yaml"):
    try:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        yaml_str = generate_yaml(session)
        
        # Backup existing config if it exists
        if os.path.exists(output_path):
            backup_dir = os.path.join(os.path.dirname(output_path), "backups")
            os.makedirs(backup_dir, exist_ok=True)
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = os.path.join(backup_dir, f"main_{timestamp}.yaml")
            shutil.copy2(output_path, backup_path)
            
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(yaml_str)
            
        return yaml_str
    except Exception as e:
        print(f"Failed to save config: {e}")
        return None
