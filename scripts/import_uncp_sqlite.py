#!/usr/bin/env python3
"""Reconstruye atomicamente la base SQLite a partir de los recursos descargados."""

import argparse
from pathlib import Path

from uncp_db import DATABASE, DATASETS_ROOT, MANIFEST, build_database


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DATABASE)
    parser.add_argument("--datasets", type=Path, default=DATASETS_ROOT)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    return parser.parse_args()


def main():
    args = parse_args()
    counters = build_database(args.database, args.datasets, args.manifest)
    print(f"database={args.database}")
    print(
        "csv_files={csv_files} raw_rows={raw_rows} records={inserted_records} "
        "duplicates={duplicate_rows}".format(**counters)
    )


if __name__ == "__main__":
    main()
