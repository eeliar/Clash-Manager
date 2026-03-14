import binascii
import hashlib
import urllib.parse
from typing import Dict, Any, Optional
import configparser
import io
import base64
import yaml

DEFAULT_AWG_OPTIONS = {
    "awg_jc": 32,
    "awg_jmin": 64,
    "awg_jmax": 256,
    "awg_s1": 0,
    "awg_s2": 0,
    "awg_h1": 1,
    "awg_h2": 2,
    "awg_h3": 3,
    "awg_h4": 4,
}


def apply_default_awg_options(result: Dict[str, Any]) -> Dict[str, Any]:
    if result.get("type") != "wireguard":
        return result

    for key, value in DEFAULT_AWG_OPTIONS.items():
        result.setdefault(key, value)
    if result.get("mtu") is None:
        result["mtu"] = 1280
    return result


def parse_dns_value(raw_value: Any) -> Optional[str]:
    if raw_value is None:
        return None
    if isinstance(raw_value, list):
        values = [str(item).strip() for item in raw_value if str(item).strip()]
    else:
        values = [part.strip() for part in str(raw_value).split(",") if part.strip()]
    return ",".join(values) if values else None


def is_valid_wireguard_key(raw_value: Any) -> bool:
    if not isinstance(raw_value, str):
        return False

    value = raw_value.strip()
    if not value:
        return False

    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception:
        return False

    return len(decoded) == 32


class UnsupportedProtocolError(ValueError):
    pass


def decode_base64_value(raw_value: str) -> str:
    value = raw_value.strip()
    if not value:
        raise ValueError("Missing Base64 payload")

    padding = "=" * (-len(value) % 4)
    try:
        decoded = base64.urlsafe_b64decode(f"{value}{padding}".encode("utf-8"))
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid Base64 payload") from exc

    try:
        return decoded.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("Decoded Base64 payload is not UTF-8") from exc


def parse_server_port(raw_value: str) -> tuple[str, int]:
    if ":" not in raw_value:
        raise ValueError("Missing server or port")

    server, port_str = raw_value.rsplit(":", 1)
    if not server:
        raise ValueError("Missing server")

    try:
        port = int(port_str)
    except ValueError as exc:
        raise ValueError("Invalid port") from exc

    if port <= 0 or port > 65535:
        raise ValueError("Invalid port")
    return server, port


def split_link_name(link_body: str, default_name: str) -> tuple[str, str]:
    if "#" not in link_body:
        return link_body, default_name
    body, raw_name = link_body.split("#", 1)
    return body, urllib.parse.unquote(raw_name) or default_name

def parse_vless(link: str) -> Dict[str, Any]:
    """Parse a VLESS share link into a structured dictionary for the database."""
    if not link.startswith("vless://"):
        raise ValueError("Not a valid VLESS link")
        
    # vless://uuid@server:port?query#name
    try:
        # Strip scheme
        rest = link[8:]
        
        # UUID and the rest
        if "@" not in rest:
            raise ValueError("Invalid VLESS format: missing @")
            
        uuid, rest = rest.split("@", 1)
        
        # address:port and the rest
        if "?" in rest:
            address_port, rest = rest.split("?", 1)
            # handle potential name fragment
            if "#" in rest:
                query_str, name = rest.split("#", 1)
                name = urllib.parse.unquote(name)
            else:
                query_str = rest
                name = "VLESS Proxy"
        else:
            if "#" in rest:
                address_port, name = rest.split("#", 1)
                name = urllib.parse.unquote(name)
            else:
                address_port = rest
                name = "VLESS Proxy"
            query_str = ""

        if ":" not in address_port:
            raise ValueError("Invalid VLESS format: missing port")
            
        server, port_str = address_port.split(":", 1)
        port = int(port_str)
        
        params = dict(urllib.parse.parse_qsl(query_str))
        
        return {
            "name": name,
            "type": "vless",
            "server": server,
            "port": port,
            "uuid": uuid,
            "network": params.get("type", "tcp"),
            "udp": True,
            "tls": params.get("security") in ["tls", "reality"],
            "flow": params.get("flow"),
            "sni": params.get("sni"),
            "public_key": params.get("pbk"),
            "short_id": params.get("sid"),
            "fingerprint": params.get("fp")
        }
    except Exception as e:
        raise ValueError(f"Failed to parse VLESS link: {str(e)}")


def parse_ss(link: str) -> Dict[str, Any]:
    if not link.startswith("ss://"):
        raise ValueError("Not a valid Shadowsocks link")

    try:
        raw_body, name = split_link_name(link[5:], "SS Proxy")
        body = raw_body.split("?", 1)[0].strip().rstrip("/")
        if not body:
            raise ValueError("Missing Shadowsocks payload")

        if "@" in body:
            userinfo, server_part = body.rsplit("@", 1)
            if ":" in userinfo:
                decoded_userinfo = userinfo
            else:
                decoded_userinfo = decode_base64_value(userinfo)
            server, port = parse_server_port(server_part)
            if ":" not in decoded_userinfo:
                raise ValueError("Missing cipher or password")
            cipher, password = decoded_userinfo.split(":", 1)
        else:
            decoded = decode_base64_value(body)
            if "@" not in decoded:
                raise ValueError("Missing server definition")
            credentials, server_part = decoded.rsplit("@", 1)
            if ":" not in credentials:
                raise ValueError("Missing cipher or password")
            cipher, password = credentials.split(":", 1)
            server, port = parse_server_port(server_part)

        cipher = cipher.strip()
        password = password.strip()
        if not cipher or not password:
            raise ValueError("Missing cipher or password")

        return {
            "name": name,
            "type": "ss",
            "server": server,
            "port": port,
            "cipher": cipher,
            "password": password,
            "udp": True,
        }
    except Exception as exc:
        raise ValueError(f"Failed to parse Shadowsocks link: {exc}")

def parse_wireguard(conf_content: str, name: str = "WireGuard Proxy") -> Dict[str, Any]:
    """Parse a WireGuard .conf content into a structured dictionary for the database, including Amnezia extensions."""
    # configparser needs a section header, add one if missing
    if "[Interface]" not in conf_content:
        raise ValueError("Invalid WireGuard config: missing [Interface] section")
    
    config = configparser.ConfigParser()
    config.read_string(conf_content)
    
    try:
        interface = config["Interface"]
        peer = None
        for section in config.sections():
            if section.startswith("Peer"):
                peer = config[section]
                break
                
        if not peer:
            raise ValueError("Invalid WireGuard config: missing [Peer] section")
            
        endpoint = peer.get("Endpoint", "127.0.0.1:51820")
        if ":" in endpoint:
            server, port_str = endpoint.rsplit(":", 1)
            port = int(port_str)
        else:
            server = endpoint
            port = 51820
            
        result = {
            "name": name,
            "type": "wireguard",
            "server": server,
            "port": port,
            "private_key": interface.get("PrivateKey"),
            "public_key": peer.get("PublicKey"),
            "ip_address": interface.get("Address"),
            "dns_servers": parse_dns_value(interface.get("DNS")),
            "mtu": int(interface.get("MTU")) if interface.get("MTU") else 1280,
            "udp": True
        }

        awg_mapping = {
            "awg_jc": interface.get("Jc"),
            "awg_jmin": interface.get("Jmin"),
            "awg_jmax": interface.get("Jmax"),
            "awg_s1": interface.get("S1"),
            "awg_s2": interface.get("S2"),
            "awg_h1": interface.get("H1"),
            "awg_h2": interface.get("H2"),
            "awg_h3": interface.get("H3"),
            "awg_h4": interface.get("H4"),
        }
        for key, value in awg_mapping.items():
            if value not in ("", None):
                result[key] = int(value)

        return apply_default_awg_options(result)
        
    except Exception as e:
        raise ValueError(f"Failed to parse WireGuard config: {str(e)}")


def parse_proxy_link(link: str) -> Dict[str, Any]:
    normalized = link.strip()
    if normalized.startswith("vless://"):
        return parse_vless(normalized)
    if normalized.startswith("ss://"):
        return parse_ss(normalized)
    if normalized.startswith("vmess://"):
        raise UnsupportedProtocolError("Unsupported protocol: vmess://")
    raise UnsupportedProtocolError("Unsupported protocol")


def decode_subscription_content(content: str) -> str:
    stripped = content.strip()
    if not stripped:
        return ""
    if "://" in stripped:
        return content

    collapsed = "".join(stripped.split())
    try:
        decoded = decode_base64_value(collapsed)
    except ValueError:
        return content

    decoded_lines = [line.strip() for line in decoded.splitlines() if line.strip()]
    if any(
        line.startswith(("vless://", "ss://", "vmess://"))
        for line in decoded_lines
    ):
        return decoded
    return content


def parse_subscription_payload(content: str) -> Dict[str, Any]:
    decoded_content = decode_subscription_content(content)
    entries = []
    warnings: list[str] = []
    errors: list[str] = []

    for index, raw_line in enumerate(decoded_content.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            parsed = parse_proxy_link(line)
        except UnsupportedProtocolError as exc:
            warnings.append(f"Line {index}: {exc}")
            continue
        except ValueError as exc:
            errors.append(f"Line {index}: {exc}")
            continue

        entries.append(
            {
                "line_number": index,
                "raw_line": line,
                "source_key": hashlib.sha256(line.encode("utf-8")).hexdigest(),
                "proxy": parsed,
            }
        )

    return {
        "decoded_content": decoded_content,
        "entries": entries,
        "warnings": warnings,
        "errors": errors,
    }

def parse_clash_yaml(content: str) -> Dict[str, Any]:
    """Parse a full Clash YAML configuration and extract proxies, groups, and rules."""
    try:
        data = yaml.safe_load(content)
        if not data:
            raise ValueError("Empty or invalid YAML")
            
        proxies_data = data.get("proxies", [])
        groups_data = data.get("proxy-groups", [])
        rules_data = data.get("rules", [])
        
        parsed_proxies = []
        for p in proxies_data:
            proxy_type = p.get("type", "unknown")
            proxy_dict = {
                "name": p.get("name", "Unknown"),
                "type": proxy_type,
                "server": p.get("server", ""),
                "port": int(p.get("port", 0)),
                "uuid": p.get("uuid"),
                "network": p.get("network", "tcp"),
                "tls": p.get("tls", False),
                "udp": p.get("udp", True),
                "sni": p.get("sni", p.get("servername")),
                "flow": p.get("flow"),
                "public_key": p.get("public-key", p.get("client-fingerprint")), 
                "short_id": p.get("short-id"),
                "fingerprint": p.get("fingerprint", p.get("client-fingerprint")),
                "cipher": p.get("cipher"),
                "password": p.get("password"),
                "private_key": p.get("private-key"),
                "ip_address": p.get("ip"),
                "dns_servers": parse_dns_value(p.get("dns")),
                "mtu": p.get("mtu"),
            }
            # Reality check
            if p.get("reality-opts"):
                opts = p.get("reality-opts")
                proxy_dict["public_key"] = opts.get("public-key", proxy_dict["public_key"])
                proxy_dict["short_id"] = opts.get("short-id", proxy_dict["short_id"])
            if proxy_type == "wireguard":
                proxy_dict["public_key"] = p.get(
                    "public-key",
                    p.get("peer-public-key", proxy_dict["public_key"]),
                )
                if p.get("amnezia-wg-option"):
                    awg_opts = p.get("amnezia-wg-option") or {}
                    proxy_dict["awg_jc"] = awg_opts.get("jc")
                    proxy_dict["awg_jmin"] = awg_opts.get("jmin")
                    proxy_dict["awg_jmax"] = awg_opts.get("jmax")
                    proxy_dict["awg_s1"] = awg_opts.get("s1")
                    proxy_dict["awg_s2"] = awg_opts.get("s2")
                    proxy_dict["awg_h1"] = awg_opts.get("h1")
                    proxy_dict["awg_h2"] = awg_opts.get("h2")
                    proxy_dict["awg_h3"] = awg_opts.get("h3")
                    proxy_dict["awg_h4"] = awg_opts.get("h4")
                proxy_dict = apply_default_awg_options(proxy_dict)
            
            parsed_proxies.append(proxy_dict)
            
        parsed_groups = []
        for g in groups_data:
            parsed_groups.append({
                "name": g.get("name"),
                "type": g.get("type", "select"),
                "proxies": g.get("proxies", [])
            })
            
        parsed_rules = []
        for r in rules_data:
            parts = str(r).split(",")
            if len(parts) >= 3:
                parsed_rules.append({
                    "type": parts[0].strip(),
                    "payload": parts[1].strip(),
                    "target": parts[2].strip(),
                    "comment": None,
                })
            elif len(parts) == 2 and parts[0].strip() == "MATCH":
                parsed_rules.append({
                    "type": "MATCH",
                    "payload": "ALL",
                    "target": parts[1].strip(),
                    "comment": None,
                })
                
        return {
            "proxies": parsed_proxies,
            "groups": parsed_groups,
            "rules": parsed_rules
        }
    except Exception as e:
        raise ValueError(f"Failed to parse Clash YAML: {str(e)}")

