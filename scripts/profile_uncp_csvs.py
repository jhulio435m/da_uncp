#!/usr/bin/env python3
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path("data/datasets")
OUT_JSON = Path("data/uncp_csv_profile.json")
OUT_CSV = Path("data/uncp_csv_profile.csv")


def read_text(path):
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace"), "latin-1-replace"


def sniff_dialect(sample):
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;|\t")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";"
        return dialect


def is_low_cardinality(counter, total):
    if not counter:
        return False
    return len(counter) <= 20 or len(counter) <= max(12, total * 0.08)


def profile_file(path):
    text, encoding = read_text(path)
    dialect = sniff_dialect(text[:4096])
    reader = csv.DictReader(text.splitlines(), dialect=dialect)
    columns = reader.fieldnames or []
    blanks = Counter()
    uniques = defaultdict(set)
    top_values = defaultdict(Counter)
    rows = 0

    for row in reader:
        rows += 1
        for col in columns:
            value = (row.get(col) or "").strip()
            if value == "":
                blanks[col] += 1
            if len(uniques[col]) <= 2000:
                uniques[col].add(value)
            if value:
                top_values[col][value] += 1

    compact_tops = {}
    for col in columns:
        if is_low_cardinality(top_values[col], rows):
            compact_tops[col] = top_values[col].most_common(12)

    return {
        "path": str(path),
        "dataset_dir": str(path.parent),
        "filename": path.name,
        "encoding": encoding,
        "delimiter": dialect.delimiter,
        "rows": rows,
        "columns": columns,
        "blank_counts": dict(blanks),
        "unique_counts": {col: len(uniques[col]) for col in columns},
        "top_values": compact_tops,
    }


def main():
    profiles = [profile_file(path) for path in sorted(ROOT.glob("*/**/*.csv"))]
    OUT_JSON.write_text(json.dumps(profiles, ensure_ascii=False, indent=2))
    fields = [
        "path",
        "rows",
        "delimiter",
        "columns",
        "likely_period",
        "likely_topic",
    ]
    with OUT_CSV.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for item in profiles:
            cols = item["columns"]
            period_cols = [c for c in cols if "PERIODO" in c.upper()]
            topic = "otro"
            name = (item["path"] + " " + " ".join(cols)).upper()
            if "POSTUL" in name:
                topic = "postulantes"
            elif "INGRES" in name:
                topic = "ingresantes"
            elif "COMEN" in name or "COMEDOR" in name:
                topic = "comedor"
            elif "BACHILLER" in name:
                topic = "bachiller"
            elif "EGRES" in name:
                topic = "egresados"
            elif "CEPRE" in name:
                topic = "cepre"
            writer.writerow(
                {
                    "path": item["path"],
                    "rows": item["rows"],
                    "delimiter": item["delimiter"],
                    "columns": "|".join(cols),
                    "likely_period": "|".join(period_cols),
                    "likely_topic": topic,
                }
            )
    print(f"csv_files={len(profiles)}")
    print(f"profile={OUT_JSON}")
    print(f"summary={OUT_CSV}")
    for item in profiles:
        print(f"{item['rows']:6d} {item['path']}")
        print("       " + " | ".join(item["columns"]))


if __name__ == "__main__":
    main()
