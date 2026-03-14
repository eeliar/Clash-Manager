import os
from sqlmodel import SQLModel, Session, create_engine, select, text
from models import ConfigProfile, ProxyGroup

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./clashmanager.db")

engine = create_engine(
    DATABASE_URL, 
    echo=False, 
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)

def init_db():
    SQLModel.metadata.create_all(engine)
    with engine.begin() as conn:
        _migrate_proxy_table(conn)
        _migrate_proxygroup_indexes(conn)
        _migrate_groupmember_table(conn)
        _ensure_column(conn, "groupmember", "target_name", "VARCHAR")
        _ensure_column(conn, "proxy", "profile_id", "INTEGER")
        _ensure_column(conn, "proxygroup", "profile_id", "INTEGER")
        _ensure_column(conn, "proxygroup", "\"order\"", "INTEGER DEFAULT 0")
        _ensure_column(conn, "rule", "profile_id", "INTEGER")
        _ensure_column(conn, "proxy", "dns_servers", "VARCHAR")
        _ensure_column(conn, "proxy", "mtu", "INTEGER")
        _ensure_column(conn, "proxy", "awg_jc", "INTEGER")
        _ensure_column(conn, "proxy", "awg_jmin", "INTEGER")
        _ensure_column(conn, "proxy", "awg_jmax", "INTEGER")
        _ensure_column(conn, "proxy", "awg_s1", "INTEGER")
        _ensure_column(conn, "proxy", "awg_s2", "INTEGER")
        _ensure_column(conn, "proxy", "awg_h1", "INTEGER")
        _ensure_column(conn, "proxy", "awg_h2", "INTEGER")
        _ensure_column(conn, "proxy", "awg_h3", "INTEGER")
        _ensure_column(conn, "proxy", "awg_h4", "INTEGER")
        _ensure_column(conn, "proxy", "cipher", "VARCHAR")
        _ensure_column(conn, "proxy", "password", "VARCHAR")
        _ensure_column(conn, "proxy", "import_source_id", "INTEGER")
        _ensure_column(conn, "proxy", "import_source_key", "VARCHAR")
        _ensure_column(conn, "rule", "comment", "VARCHAR")

    with Session(engine) as session:
        profile = session.exec(
            select(ConfigProfile).where(
                (ConfigProfile.is_active == True) | (ConfigProfile.is_default == True)
            )
        ).first()
        if not profile:
            profile = ConfigProfile(
                name="Default",
                slug="default",
                description="Default configuration profile",
                is_default=True,
                is_active=True,
            )
            session.add(profile)
            session.commit()
            session.refresh(profile)

        session.execute(
            text(
                "UPDATE proxy SET profile_id = :profile_id "
                "WHERE profile_id IS NULL"
            ),
            {"profile_id": profile.id},
        )
        session.execute(
            text(
                "UPDATE proxygroup SET profile_id = :profile_id "
                "WHERE profile_id IS NULL"
            ),
            {"profile_id": profile.id},
        )
        session.execute(
            text(
                "UPDATE rule SET profile_id = :profile_id "
                "WHERE profile_id IS NULL"
            ),
            {"profile_id": profile.id},
        )
        _normalize_group_order(session)
        session.commit()


def _ensure_column(conn, table_name: str, column_name: str, column_sql: str) -> None:
    try:
        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"))
    except Exception:
        pass


def _migrate_groupmember_table(conn) -> None:
    if "sqlite" not in DATABASE_URL:
        return
    if not _column_exists(conn, "groupmember", "proxy_id"):
        return
    if not _column_is_not_null(conn, "groupmember", "proxy_id"):
        return
    has_target_name = _column_exists(conn, "groupmember", "target_name")

    conn.execute(text("PRAGMA foreign_keys=OFF"))
    conn.execute(
        text(
            """
            CREATE TABLE groupmember_new (
                id INTEGER PRIMARY KEY,
                group_id INTEGER NOT NULL,
                proxy_id INTEGER,
                target_name VARCHAR,
                "order" INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(group_id) REFERENCES proxygroup (id),
                FOREIGN KEY(proxy_id) REFERENCES proxy (id)
            )
            """
        )
    )
    select_target_name = "target_name" if has_target_name else "NULL"
    conn.execute(
        text(
            f"""
            INSERT INTO groupmember_new (id, group_id, proxy_id, target_name, "order")
            SELECT id, group_id, proxy_id, {select_target_name}, "order"
            FROM groupmember
            """
        )
    )
    conn.execute(text("DROP TABLE groupmember"))
    conn.execute(text("ALTER TABLE groupmember_new RENAME TO groupmember"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_groupmember_group_id ON groupmember (group_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_groupmember_proxy_id ON groupmember (proxy_id)"))
    conn.execute(text("PRAGMA foreign_keys=ON"))


def _migrate_proxy_table(conn) -> None:
    if "sqlite" not in DATABASE_URL:
        return
    if not _column_exists(conn, "proxy", "id"):
        return
    if not _column_exists(conn, "proxy", "obfs"):
        return

    proxy_columns = {
        row[1]
        for row in conn.execute(text("PRAGMA table_info(proxy)")).fetchall()
    }

    def source(name: str) -> str:
        return name if name in proxy_columns else "NULL"

    conn.execute(text("PRAGMA foreign_keys=OFF"))
    conn.execute(
        text(
            """
            CREATE TABLE proxy_new (
                id INTEGER PRIMARY KEY,
                profile_id INTEGER,
                name VARCHAR NOT NULL,
                type VARCHAR NOT NULL,
                server VARCHAR NOT NULL,
                port INTEGER NOT NULL,
                uuid VARCHAR,
                network VARCHAR,
                tls BOOLEAN NOT NULL DEFAULT 0,
                udp BOOLEAN NOT NULL DEFAULT 1,
                flow VARCHAR,
                sni VARCHAR,
                public_key VARCHAR,
                short_id VARCHAR,
                fingerprint VARCHAR,
                cipher VARCHAR,
                password VARCHAR,
                private_key VARCHAR,
                ip_address VARCHAR,
                dns_servers VARCHAR,
                mtu INTEGER,
                awg_jc INTEGER,
                awg_jmin INTEGER,
                awg_jmax INTEGER,
                awg_s1 INTEGER,
                awg_s2 INTEGER,
                awg_h1 INTEGER,
                awg_h2 INTEGER,
                awg_h3 INTEGER,
                awg_h4 INTEGER,
                status VARCHAR NOT NULL DEFAULT 'unknown',
                latency INTEGER,
                import_source_id INTEGER,
                import_source_key VARCHAR,
                FOREIGN KEY(profile_id) REFERENCES configprofile (id)
            )
            """
        )
    )
    conn.execute(
        text(
            f"""
            INSERT INTO proxy_new (
                id, profile_id, name, type, server, port, uuid, network, tls, udp,
                flow, sni, public_key, short_id, fingerprint, cipher, password,
                private_key, ip_address,
                dns_servers, mtu, awg_jc, awg_jmin, awg_jmax, awg_s1, awg_s2,
                awg_h1, awg_h2, awg_h3, awg_h4, status, latency,
                import_source_id, import_source_key
            )
            SELECT
                {source("id")}, {source("profile_id")}, {source("name")}, {source("type")},
                {source("server")}, {source("port")}, {source("uuid")}, {source("network")},
                {source("tls")}, {source("udp")}, {source("flow")}, {source("sni")},
                {source("public_key")}, {source("short_id")}, {source("fingerprint")},
                {source("cipher")}, {source("password")},
                {source("private_key")}, {source("ip_address")}, {source("dns_servers")},
                {source("mtu")}, {source("awg_jc")}, {source("awg_jmin")}, {source("awg_jmax")},
                {source("awg_s1")}, {source("awg_s2")}, {source("awg_h1")}, {source("awg_h2")},
                {source("awg_h3")}, {source("awg_h4")}, {source("status")}, {source("latency")},
                {source("import_source_id")}, {source("import_source_key")}
            FROM proxy
            """
        )
    )
    conn.execute(text("DROP TABLE proxy"))
    conn.execute(text("ALTER TABLE proxy_new RENAME TO proxy"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_proxy_name ON proxy (name)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_proxy_profile_id ON proxy (profile_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_proxy_import_source_id ON proxy (import_source_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_proxy_import_source_key ON proxy (import_source_key)"))
    conn.execute(text("PRAGMA foreign_keys=ON"))


def _migrate_proxygroup_indexes(conn) -> None:
    if "sqlite" not in DATABASE_URL:
        return
    if not _column_exists(conn, "proxygroup", "name"):
        return

    index_rows = conn.execute(text("PRAGMA index_list(proxygroup)")).fetchall()
    for row in index_rows:
        index_name = row[1]
        is_unique = bool(row[2])
        if index_name == "ix_proxygroup_name" and is_unique:
            conn.execute(text("DROP INDEX IF EXISTS ix_proxygroup_name"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_proxygroup_name ON proxygroup (name)"))
            break


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return any(row[1] == column_name for row in rows)


def _column_is_not_null(conn, table_name: str, column_name: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    for row in rows:
        if row[1] == column_name:
            return bool(row[3])
    return False


def _normalize_group_order(session: Session) -> None:
    profiles = session.exec(select(ConfigProfile)).all()
    for profile in profiles:
        groups = session.exec(
            select(ProxyGroup)
            .where(ProxyGroup.profile_id == profile.id)
            .order_by(ProxyGroup.order.asc(), ProxyGroup.id.asc())
        ).all()
        for order, group in enumerate(groups):
            if group.order != order:
                group.order = order
                session.add(group)

def get_session():
    with Session(engine) as session:
        yield session
