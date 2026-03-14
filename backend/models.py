from datetime import datetime
from typing import Optional, List
from sqlmodel import Field, SQLModel, Relationship

class Settings(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    key: str = Field(unique=True, index=True)
    value: str

class ConfigProfile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    slug: str = Field(unique=True, index=True)
    description: Optional[str] = None
    is_default: bool = Field(default=False)
    is_active: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)

    proxies: List["Proxy"] = Relationship(back_populates="profile")
    groups: List["ProxyGroup"] = Relationship(back_populates="profile")
    rules: List["Rule"] = Relationship(back_populates="profile")
    revisions: List["ConfigRevision"] = Relationship(back_populates="profile")
    devices: List["Device"] = Relationship(back_populates="profile")
    subscription_tokens: List["SubscriptionToken"] = Relationship(back_populates="profile")
    subscription_sources: List["SubscriptionSource"] = Relationship(back_populates="profile")

class ConfigRevision(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    profile_id: int = Field(foreign_key="configprofile.id", index=True)
    version: int = Field(default=1, index=True)
    status: str = Field(default="draft", index=True)
    source: str = Field(default="manual")
    change_summary: Optional[str] = None
    generated_yaml: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    published_at: Optional[datetime] = None

    profile: ConfigProfile = Relationship(back_populates="revisions")

class Device(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    profile_id: int = Field(foreign_key="configprofile.id", index=True)
    name: str = Field(index=True)
    platform: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    last_seen_at: Optional[datetime] = None

    profile: ConfigProfile = Relationship(back_populates="devices")
    subscription_tokens: List["SubscriptionToken"] = Relationship(back_populates="device")

class SubscriptionToken(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    profile_id: int = Field(foreign_key="configprofile.id", index=True)
    device_id: Optional[int] = Field(default=None, foreign_key="device.id", index=True)
    name: str = Field(default="default")
    token: str = Field(unique=True, index=True)
    is_active: bool = Field(default=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None

    profile: ConfigProfile = Relationship(back_populates="subscription_tokens")
    device: Optional[Device] = Relationship(back_populates="subscription_tokens")

class SubscriptionSource(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    profile_id: int = Field(foreign_key="configprofile.id", index=True)
    name: str = Field(index=True)
    url: str
    is_active: bool = Field(default=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    last_synced_at: Optional[datetime] = None
    last_error: Optional[str] = None
    cached_content: Optional[str] = None
    cached_fetched_at: Optional[datetime] = None

    profile: ConfigProfile = Relationship(back_populates="subscription_sources")
    proxies: List["Proxy"] = Relationship(back_populates="import_source")

class Proxy(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    profile_id: Optional[int] = Field(default=None, foreign_key="configprofile.id", index=True)
    name: str = Field(index=True)
    type: str # vless, wireguard
    server: str
    port: int
    
    # Common fields (stored as JSON string or individual columns, but individual columns are better for querying)
    uuid: Optional[str] = None
    network: Optional[str] = None
    tls: bool = False
    udp: bool = True
    flow: Optional[str] = None
    sni: Optional[str] = None # servername
    
    # REALITY options
    public_key: Optional[str] = None
    short_id: Optional[str] = None
    fingerprint: Optional[str] = None
    cipher: Optional[str] = None
    password: Optional[str] = None

    # WireGuard options
    private_key: Optional[str] = None
    ip_address: Optional[str] = None # Address
    dns_servers: Optional[str] = None
    mtu: Optional[int] = None
    
    # AmneziaWG
    awg_jc: Optional[int] = None
    awg_jmin: Optional[int] = None
    awg_jmax: Optional[int] = None
    awg_s1: Optional[int] = None
    awg_s2: Optional[int] = None
    awg_h1: Optional[int] = None
    awg_h2: Optional[int] = None
    awg_h3: Optional[int] = None
    awg_h4: Optional[int] = None

    # Status & metadata
    status: str = Field(default="unknown") # online, offline, unknown
    latency: Optional[int] = None
    import_source_id: Optional[int] = Field(
        default=None,
        foreign_key="subscriptionsource.id",
        index=True,
    )
    import_source_key: Optional[str] = Field(default=None, index=True)

    # Relationships
    profile: Optional[ConfigProfile] = Relationship(back_populates="proxies")
    group_members: List["GroupMember"] = Relationship(back_populates="proxy")
    import_source: Optional["SubscriptionSource"] = Relationship(back_populates="proxies")

class ProxyGroup(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    profile_id: Optional[int] = Field(default=None, foreign_key="configprofile.id", index=True)
    name: str = Field(index=True)
    type: str # select, url-test, fallback, load-balance
    order: int = Field(default=0, index=True)
    
    test_url: str = Field(default="http://www.gstatic.com/generate_204")
    interval: int = Field(default=300)
    tolerance: int = Field(default=50)
    
    # Relationships
    profile: Optional[ConfigProfile] = Relationship(back_populates="groups")
    members: List["GroupMember"] = Relationship(back_populates="group")

class GroupMember(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    group_id: int = Field(foreign_key="proxygroup.id", index=True)
    proxy_id: Optional[int] = Field(default=None, foreign_key="proxy.id", index=True)
    target_name: Optional[str] = Field(default=None)
    order: int = Field(default=0)
    
    group: ProxyGroup = Relationship(back_populates="members")
    proxy: Optional[Proxy] = Relationship(back_populates="group_members")

class Rule(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    profile_id: Optional[int] = Field(default=None, foreign_key="configprofile.id", index=True)
    type: str # DOMAIN, DOMAIN-SUFFIX, IP-CIDR, GEOIP, MATCH
    payload: str # e.g., vk.com or CN
    target: str # group name or DIRECT/REJECT/PROXY
    order: int = Field(default=0)
    comment: Optional[str] = None

    profile: Optional[ConfigProfile] = Relationship(back_populates="rules")
