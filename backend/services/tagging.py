import re
from typing import List
from models import Proxy

COUNTRY_CODES = {
    "us": "US", "uk": "UK", "gb": "UK",
    "jp": "Japan", "sg": "Singapore", "hk": "Hong Kong",
    "tw": "Taiwan", "kr": "Korea", "de": "Germany",
    "fr": "France", "nl": "Netherlands", "ca": "Canada",
    "au": "Australia", "in": "India", "ru": "Russia"
}

def derive_proxy_tags(proxy: Proxy) -> List[str]:
    tags = set()

    if proxy.type:
        tags.add(proxy.type.upper())

    name_lower = proxy.name.lower()

    words = re.findall(r'\b[a-zA-Z]{2}\b', name_lower)
    for word in words:
        if word in COUNTRY_CODES:
            tags.add(COUNTRY_CODES[word])

    if proxy.network:
        tags.add(proxy.network.upper())

    return sorted(list(tags))

def apply_tags_to_proxy(proxy: Proxy) -> None:
    tags = derive_proxy_tags(proxy)
    if tags:
        proxy.tags = ",".join(tags)
