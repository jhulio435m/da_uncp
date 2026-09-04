#!/usr/bin/env python3
"""Normalizacion compartida para la ingesta y el dashboard UNCP."""

import csv
import re
import unicodedata
from pathlib import Path


TOPIC_LABELS = {
    "postulantes": "Postulantes",
    "ingresantes": "Ingresantes",
    "comedor": "Comedor",
    "egresados": "Egresados",
    "bachiller": "Bachilleres",
    "cepre": "CEPRE",
    "otros": "Otros",
}


def strip_accents(value):
    return "".join(
        ch for ch in unicodedata.normalize("NFKD", str(value or ""))
        if not unicodedata.combining(ch)
    )


def clean(value):
    value = strip_accents(value).upper().replace("\ufeff", "")
    return re.sub(r"\s+", " ", value).strip()


def title_case(value):
    value = clean(value)
    if not value or value.startswith("SIN_"):
        return "Sin dato"
    keep = {"Y", "DE", "DEL", "LA", "LAS", "LOS", "EN"}
    words = [word.lower() if word in keep else word.capitalize() for word in value.split()]
    result = " ".join(words)
    return result[:1].upper() + result[1:]


def normalize_period(value):
    value = clean(value).replace(" ", "").replace("_", "-").replace("–", "-")
    if not value:
        return "SIN_PERIODO"
    value = re.sub(r"-1$", "-I", value)
    value = re.sub(r"-2$", "-II", value)
    return value.replace("2023-1", "2023-I")


def period_sort_key(period):
    if period == "SIN_PERIODO":
        return (9999, 9)
    match = re.search(r"(20\d{2})-?([I]{1,2}|1|2)?", period)
    if not match:
        return (9998, 9)
    year = int(match.group(1))
    term = match.group(2) or "I"
    return (year, 1 if term in {"I", "1"} else 2)


def read_csv(path):
    path = Path(path)
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("latin-1", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;|\t")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ";"
    return list(csv.DictReader(text.splitlines(), dialect=dialect))


def topic_for(path, rows):
    path_text = clean(str(path))
    text = clean(str(path) + " " + " ".join(rows[0].keys() if rows else []))
    if "CEPRE" in path_text:
        return "cepre"
    if "POSTUL" in path_text or "EXAMEN-DE-ADMISI" in path_text:
        return "postulantes"
    if "INGRES" in path_text:
        return "ingresantes"
    if "COMEN" in path_text or "COMEDOR" in path_text:
        return "comedor"
    if "BACHILLER" in path_text:
        return "bachiller"
    if "EGRES" in path_text:
        return "egresados"
    if "POSTUL" in text or ("ADMISI" in text and "INGRES" not in text):
        return "postulantes"
    if "INGRES" in text:
        return "ingresantes"
    if "COMEN" in text or "COMEDOR" in text:
        return "comedor"
    if "BACHILLER" in text:
        return "bachiller"
    if "EGRES" in text:
        return "egresados"
    if "CEPRE" in text:
        return "cepre"
    return "otros"


def period_for(path, row, topic):
    topic_columns = {
        "postulantes": ("PERIODO_APLICANDO",),
        "ingresantes": ("PERIODO_INGRESANTE", "PERIODO_INGRESO"),
        "comedor": ("PERIODO_ACADEMICO",),
        "egresados": ("PERIODO_SALIENTE", "PERIODO_EGRESO"),
        "bachiller": (),
        "cepre": (),
    }
    fallback_columns = (
        "PERIODO_APLICANDO", "PERIODO_ACADEMICO", "PERIODO_SALIENTE",
        "PERIODO_EGRESO", "PERIODO_INGRESANTE", "PERIODO_INGRESO",
    )
    for column in topic_columns.get(topic, fallback_columns) + fallback_columns:
        value = normalize_period(row.get(column))
        if value != "SIN_PERIODO":
            return value
    match = re.search(r"(20\d{2})[-_ ]?([12I]{1,2})", clean(str(path)))
    if match:
        suffix = match.group(2).replace("1", "I").replace("2", "II")
        return f"{match.group(1)}-{suffix}"
    return "SIN_PERIODO"


def school_for(row):
    for column in (
        "ESCUELA", "ESCUELA_PROFESIONAL", "PROGRAMA_ESTUDIO",
        "NOMBRE_CARRERA", "CARRERA_PROFESIONAL", "FACULTAD",
    ):
        value = clean(row.get(column))
        if value:
            return value
    return "SIN_ESCUELA"


def sex_for(row):
    value = clean(row.get("SEXO"))
    if value in {"M", "MASCULINO", "HOMBRE"}:
        return "MASCULINO"
    if value in {"F", "FEMENINO", "MUJER"}:
        return "FEMENINO"
    return value or "SIN_DATO"


def geo_for(row):
    department = clean(
        row.get("DEPARTAMENTO") or row.get("DEPARTAMENTO_RESIDENCIA")
        or row.get("DEPARTAMENTO_NACIMIENTO") or row.get("DEPARTAMENTO_SEDE_ESTUDIO")
    )
    province = clean(
        row.get("PROVINCIA") or row.get("PROVINCIA_RESIDENCIA")
        or row.get("PROVINCIA_NACIMIENTO") or row.get("PROVINCIA_SEDE_ESTUDIO")
    )
    district = clean(
        row.get("DISTRITO") or row.get("DISTRITO_RESIDENCIA")
        or row.get("DISTRITO_NACIMIENTO") or row.get("DISTRITO_SEDE_ESTUDIO")
    )
    return department or "SIN_DEP", province or "SIN_PROV", district or "SIN_DIST"
