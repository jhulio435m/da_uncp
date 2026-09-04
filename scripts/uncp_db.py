#!/usr/bin/env python3
"""Base SQLite e importacion idempotente de los datos abiertos UNCP."""

import hashlib
import hmac
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from uncp_common import clean, geo_for, period_for, read_csv, school_for, sex_for, title_case, topic_for


DATABASE = Path("data/uncp.sqlite3")
DATASETS_ROOT = Path("data/datasets")
MANIFEST = Path("data/uncp_manifest.json")
SCHEMA_VERSION = 1


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE schema_version (
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL
);

CREATE TABLE imports (
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL,
    csv_files INTEGER NOT NULL DEFAULT 0,
    raw_rows INTEGER NOT NULL DEFAULT 0,
    inserted_records INTEGER NOT NULL DEFAULT 0,
    duplicate_rows INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE datasets (
    id INTEGER PRIMARY KEY,
    source_url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE resources (
    id INTEGER PRIMARY KEY,
    dataset_id INTEGER NOT NULL REFERENCES datasets(id),
    source_url TEXT NOT NULL UNIQUE,
    final_url TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT '',
    local_path TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT '',
    byte_size INTEGER NOT NULL DEFAULT 0,
    content_sha256 TEXT,
    status TEXT NOT NULL DEFAULT ''
);

CREATE TABLE periods (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE
);

CREATE TABLE schools (
    id INTEGER PRIMARY KEY,
    school_key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL
);

CREATE TABLE territories (
    id INTEGER PRIMARY KEY,
    department_key TEXT NOT NULL,
    province_key TEXT NOT NULL,
    district_key TEXT NOT NULL,
    department_label TEXT NOT NULL,
    province_label TEXT NOT NULL,
    district_label TEXT NOT NULL,
    UNIQUE (department_key, province_key, district_key)
);

CREATE TABLE academic_records (
    id INTEGER PRIMARY KEY,
    topic TEXT NOT NULL,
    period_id INTEGER NOT NULL REFERENCES periods(id),
    school_id INTEGER NOT NULL REFERENCES schools(id),
    territory_id INTEGER NOT NULL REFERENCES territories(id),
    sex TEXT NOT NULL,
    subject_token TEXT,
    resource_id INTEGER NOT NULL REFERENCES resources(id),
    source_row INTEGER NOT NULL,
    row_fingerprint TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_records_topic ON academic_records(topic);
CREATE INDEX idx_records_period_topic ON academic_records(period_id, topic);
CREATE INDEX idx_records_school_topic ON academic_records(school_id, topic);
CREATE INDEX idx_records_territory_topic ON academic_records(territory_id, topic);
CREATE INDEX idx_records_sex_topic ON academic_records(sex, topic);

CREATE VIEW record_facts AS
SELECT
    ar.id,
    ar.topic,
    p.code AS period,
    s.school_key,
    s.label AS school,
    ar.sex,
    t.department_key,
    t.province_key,
    t.district_key,
    t.department_label AS department,
    t.province_label AS province,
    t.district_label AS district,
    ar.resource_id,
    r.local_path AS source_path
FROM academic_records ar
JOIN periods p ON p.id = ar.period_id
JOIN schools s ON s.id = ar.school_id
JOIN territories t ON t.id = ar.territory_id
JOIN resources r ON r.id = ar.resource_id;

CREATE VIEW topic_totals AS
SELECT topic, COUNT(*) AS records
FROM academic_records
GROUP BY topic;

CREATE VIEW period_topic_totals AS
SELECT p.code AS period, ar.topic, COUNT(*) AS records
FROM academic_records ar
JOIN periods p ON p.id = ar.period_id
GROUP BY p.code, ar.topic;
"""


def utc_now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def row_fingerprint(topic, row):
    canonical = {
        clean(key): str(value or "").strip()
        for key, value in row.items()
        if key is not None
    }
    payload = json.dumps(
        {"topic": topic, "row": canonical},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def subject_token(row, secret):
    identifier = clean(row.get("UUID"))
    if not secret or not identifier:
        return None
    return hmac.new(secret.encode("utf-8"), identifier.encode("utf-8"), hashlib.sha256).hexdigest()


def initialize_schema(connection):
    connection.executescript(SCHEMA)
    connection.execute(
        "INSERT INTO schema_version(version, applied_at) VALUES (?, ?)",
        (SCHEMA_VERSION, utc_now()),
    )


def load_manifest(path):
    path = Path(path)
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def upsert_dataset(connection, source_url, title, description=""):
    connection.execute(
        """
        INSERT INTO datasets(source_url, title, description) VALUES (?, ?, ?)
        ON CONFLICT(source_url) DO UPDATE SET
            title = excluded.title,
            description = excluded.description
        """,
        (source_url, title, description or ""),
    )
    return connection.execute(
        "SELECT id FROM datasets WHERE source_url = ?", (source_url,)
    ).fetchone()[0]


def register_resources(connection, manifest):
    resource_ids = {}
    for index, item in enumerate(manifest, start=1):
        dataset_url = item.get("dataset_url") or f"local://dataset/{index}"
        dataset_id = upsert_dataset(
            connection,
            dataset_url,
            item.get("dataset_title") or dataset_url.rsplit("/", 1)[-1],
            item.get("description") or "",
        )
        local_path = item.get("local_path") or ""
        source_url = item.get("resource_url") or f"local://resource/{index}/{local_path}"
        path = Path(local_path) if local_path else None
        digest = sha256_file(path) if path and path.is_file() else None
        connection.execute(
            """
            INSERT INTO resources(
                dataset_id, source_url, final_url, label, source_type, local_path,
                content_type, byte_size, content_sha256, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_url) DO UPDATE SET
                dataset_id = excluded.dataset_id,
                final_url = excluded.final_url,
                label = excluded.label,
                source_type = excluded.source_type,
                local_path = excluded.local_path,
                content_type = excluded.content_type,
                byte_size = excluded.byte_size,
                content_sha256 = excluded.content_sha256,
                status = excluded.status
            """,
            (
                dataset_id, source_url, item.get("final_url") or "",
                item.get("resource_label") or "", item.get("resource_source") or "",
                local_path, item.get("content_type") or "", int(item.get("bytes") or 0),
                digest, item.get("status") or "",
            ),
        )
        resource_id = connection.execute(
            "SELECT id FROM resources WHERE source_url = ?", (source_url,)
        ).fetchone()[0]
        if local_path:
            resource_ids[str(Path(local_path))] = resource_id
    return resource_ids


def register_local_csv(connection, path):
    dataset_url = f"local://{path.parent.as_posix()}"
    dataset_id = upsert_dataset(connection, dataset_url, path.parent.name)
    source_url = f"local://{path.as_posix()}"
    connection.execute(
        """
        INSERT INTO resources(
            dataset_id, source_url, final_url, label, source_type, local_path,
            content_type, byte_size, content_sha256, status
        ) VALUES (?, ?, '', ?, 'local_file', ?, 'text/csv', ?, ?, 'available')
        """,
        (dataset_id, source_url, path.name, str(path), path.stat().st_size, sha256_file(path)),
    )
    return connection.execute(
        "SELECT id FROM resources WHERE source_url = ?", (source_url,)
    ).fetchone()[0]


def dimension_id(connection, table, key_column, key, insert_columns, insert_values):
    row = connection.execute(
        f"SELECT id FROM {table} WHERE {key_column} = ?", (key,)
    ).fetchone()
    if row:
        return row[0]
    placeholders = ", ".join("?" for _ in insert_columns)
    connection.execute(
        f"INSERT INTO {table}({', '.join(insert_columns)}) VALUES ({placeholders})",
        insert_values,
    )
    return connection.execute("SELECT last_insert_rowid()").fetchone()[0]


def import_csv_files(connection, dataset_root, resource_ids, token_secret=None):
    counters = {"csv_files": 0, "raw_rows": 0, "inserted_records": 0, "duplicate_rows": 0}
    period_cache = {}
    school_cache = {}
    territory_cache = {}

    for path in sorted(Path(dataset_root).glob("*/**/*.csv")):
        rows = read_csv(path)
        topic = topic_for(path, rows)
        counters["csv_files"] += 1
        resource_id = resource_ids.get(str(path))
        if resource_id is None:
            resource_id = register_local_csv(connection, path)

        for source_row, row in enumerate(rows, start=2):
            counters["raw_rows"] += 1
            period = period_for(path, row, topic)
            school = school_for(row)
            department, province, district = geo_for(row)

            if period not in period_cache:
                period_cache[period] = dimension_id(
                    connection, "periods", "code", period, ("code",), (period,)
                )
            if school not in school_cache:
                school_cache[school] = dimension_id(
                    connection, "schools", "school_key", school,
                    ("school_key", "label"), (school, title_case(school)),
                )
            territory_key = (department, province, district)
            if territory_key not in territory_cache:
                connection.execute(
                    """
                    INSERT OR IGNORE INTO territories(
                        department_key, province_key, district_key,
                        department_label, province_label, district_label
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (*territory_key, *(title_case(value) for value in territory_key)),
                )
                territory_cache[territory_key] = connection.execute(
                    """
                    SELECT id FROM territories
                    WHERE department_key = ? AND province_key = ? AND district_key = ?
                    """,
                    territory_key,
                ).fetchone()[0]

            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO academic_records(
                    topic, period_id, school_id, territory_id, sex, subject_token,
                    resource_id, source_row, row_fingerprint
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    topic, period_cache[period], school_cache[school],
                    territory_cache[territory_key], sex_for(row), subject_token(row, token_secret),
                    resource_id, source_row, row_fingerprint(topic, row),
                ),
            )
            if cursor.rowcount:
                counters["inserted_records"] += 1
            else:
                counters["duplicate_rows"] += 1
    return counters


def build_database(database=DATABASE, dataset_root=DATASETS_ROOT, manifest_path=MANIFEST):
    database = Path(database)
    database.parent.mkdir(parents=True, exist_ok=True)
    temporary = database.with_name(f".{database.name}.tmp")
    if temporary.exists():
        temporary.unlink()

    previous_imports = []
    if database.exists():
        previous = sqlite3.connect(database)
        try:
            has_imports = previous.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'imports'"
            ).fetchone()
            if has_imports:
                previous_imports = previous.execute(
                    """
                    SELECT started_at, completed_at, status, csv_files, raw_rows,
                           inserted_records, duplicate_rows
                    FROM imports ORDER BY id
                    """
                ).fetchall()
        finally:
            previous.close()

    connection = sqlite3.connect(temporary)
    started_at = utc_now()
    try:
        initialize_schema(connection)
        connection.executemany(
            """
            INSERT INTO imports(
                started_at, completed_at, status, csv_files, raw_rows,
                inserted_records, duplicate_rows
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            previous_imports,
        )
        cursor = connection.execute(
            "INSERT INTO imports(started_at, status) VALUES (?, 'running')", (started_at,)
        )
        import_id = cursor.lastrowid
        manifest = load_manifest(manifest_path)
        resource_ids = register_resources(connection, manifest)
        counters = import_csv_files(
            connection,
            dataset_root,
            resource_ids,
            token_secret=os.environ.get("UNCP_RECORD_KEY"),
        )
        connection.execute(
            """
            UPDATE imports SET completed_at = ?, status = 'completed', csv_files = ?,
                raw_rows = ?, inserted_records = ?, duplicate_rows = ?
            WHERE id = ?
            """,
            (
                utc_now(), counters["csv_files"], counters["raw_rows"],
                counters["inserted_records"], counters["duplicate_rows"], import_id,
            ),
        )
        connection.commit()
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity_check: {integrity}")
    except Exception:
        connection.close()
        if temporary.exists():
            temporary.unlink()
        raise
    else:
        connection.close()
        os.replace(temporary, database)
    return counters


def connect(database=DATABASE):
    database = Path(database)
    if not database.exists():
        raise FileNotFoundError(
            f"No existe {database}. Ejecuta: python scripts/import_uncp_sqlite.py"
        )
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection
