#!/usr/bin/env python3
"""Actualiza SQLite, exporta los agregados y opcionalmente compila React."""

import argparse
import subprocess

from build_uncp_dashboard import main as build_dashboard
from download_uncp_datasets import main as download_datasets
from uncp_db import build_database


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--download",
        action="store_true",
        help="actualiza primero los recursos desde datosabiertos.gob.pe",
    )
    parser.add_argument(
        "--build-frontend",
        action="store_true",
        help="ejecuta npm run build despues de exportar el JSON",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    if args.download:
        download_datasets()
    counters = build_database()
    print(
        "sqlite: csv_files={csv_files} raw_rows={raw_rows} records={inserted_records} "
        "duplicates={duplicate_rows}".format(**counters)
    )
    build_dashboard()
    if args.build_frontend:
        subprocess.run(
            ["npm", "run", "build"],
            cwd="observatorio-uncp",
            check=True,
        )


if __name__ == "__main__":
    main()
