#!/usr/bin/env python3
"""Genera el informe exploratorio desde los agregados de SQLite."""

from pathlib import Path

from build_uncp_dashboard import build_data


OUT = Path("data/uncp_dataton_findings.md")


def main():
    data = build_data()
    totals = data["totals"]
    funnel = [row for row in data["funnel"] if row["postulantes"] and row["ingresantes"]]
    current_demand = sorted(
        (
            row for row in data["period_schools"]
            if row["period"] == "2026-I" and row["postulantes"]
        ),
        key=lambda row: row["postulantes"],
        reverse=True,
    )[:12]
    low_conversion = sorted(
        (
            row for row in data["period_schools"]
            if row["period"] in {"2025-I", "2025-II"} and row["postulantes"] >= 80
        ),
        key=lambda row: row["conversion"],
    )[:15]
    top_geo = sorted(
        (
            row for row in data["period_geo"]
            if row["period"] == "2026-I" and row["postulantes"]
        ),
        key=lambda row: row["postulantes"],
        reverse=True,
    )[:12]
    top_comedor = sorted(
        (row for row in data["period_geo"] if row["comedor"]),
        key=lambda row: row["comedor"],
        reverse=True,
    )[:12]

    lines = ["# Hallazgos preliminares UNCP", "", "## Inventario", ""]
    for topic in data["topics"]:
        lines.append(f"- {topic['key']}: {totals[topic['key']]:,} filas")

    lines.extend([
        "", "## Embudo postulante a ingresante", "",
        "| Periodo | Postulantes | Ingresantes | Conversión |",
        "|---|---:|---:|---:|",
    ])
    for row in funnel:
        lines.append(
            f"| {row['period']} | {row['postulantes']:,} | {row['ingresantes']:,} | "
            f"{row['conversion']}% |"
        )

    lines.extend([
        "", "## Mayor demanda 2026-I por escuela", "",
        "| Escuela | Postulantes |", "|---|---:|",
    ])
    for row in current_demand:
        lines.append(f"| {row['school'].upper()} | {row['postulantes']:,} |")

    lines.extend([
        "", "## Escuelas con menor conversión 2025-I/2025-II", "",
        "| Periodo | Escuela | Ingresantes | Postulantes | Conversión |",
        "|---|---|---:|---:|---:|",
    ])
    for row in low_conversion:
        lines.append(
            f"| {row['period']} | {row['school'].upper()} | {row['ingresantes']:,} | "
            f"{row['postulantes']:,} | {row['conversion']}% |"
        )

    lines.extend([
        "", "## Zonas con más postulantes 2026-I", "",
        "| Departamento | Provincia | Distrito | Postulantes |",
        "|---|---|---|---:|",
    ])
    for row in top_geo:
        lines.append(
            f"| {row['department'].upper()} | {row['province'].upper()} | "
            f"{row['district'].upper()} | {row['postulantes']:,} |"
        )

    lines.extend([
        "", "## Zonas con más beneficiarios de comedor", "",
        "| Periodo | Departamento | Provincia | Distrito | Beneficiarios |",
        "|---|---|---|---|---:|",
    ])
    for row in top_comedor:
        lines.append(
            f"| {row['period']} | {row['department'].upper()} | {row['province'].upper()} | "
            f"{row['district'].upper()} | {row['comedor']:,} |"
        )

    lines.extend(["", "## Archivos perfilados", ""])
    for item in data["files"]:
        lines.append(f"- {item['topic']}: {item['rows']:,} filas - {item['path']}")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(OUT)


if __name__ == "__main__":
    main()
