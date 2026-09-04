#!/usr/bin/env python3
import html
import json
import math
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from uncp_common import TOPIC_LABELS, clean, period_sort_key, title_case
from uncp_db import DATABASE, connect

DISTRICT_GEOJSON = Path("data/gis/peru_distrital_simple.geojson")
PROCESSED = Path("data/processed")
DIST = Path("dist")
DATA_JSON = PROCESSED / "uncp_dashboard_data.json"
INDEX_HTML = DIST / "index.html"
FRONTEND_DATA_JSON = Path("observatorio-uncp/src/data/uncp_dashboard_data.json")


def pct(num, den):
    return 0 if den == 0 else round(num * 100 / den, 1)


def ratio(num, den):
    return 0 if den == 0 else num / den


def build_data(database=DATABASE):
    topic_totals = Counter()
    period_topic = defaultdict(Counter)
    school_topic = defaultdict(Counter)
    period_school_topic = defaultdict(Counter)
    geo_topic = defaultdict(Counter)
    period_geo_topic = defaultdict(Counter)
    sex_topic = defaultdict(Counter)
    connection = connect(database)
    try:
        files = [
            {"path": row["source_path"], "topic": row["topic"], "rows": row["rows"]}
            for row in connection.execute(
                """
                SELECT source_path, topic, COUNT(*) AS rows
                FROM record_facts
                GROUP BY source_path, topic
                ORDER BY source_path, topic
                """
            )
        ]
        for row in connection.execute("SELECT topic, records FROM topic_totals"):
            topic_totals[row["topic"]] = row["records"]
        for row in connection.execute(
            "SELECT period, topic, COUNT(*) AS records FROM record_facts GROUP BY period, topic"
        ):
            period_topic[row["period"]][row["topic"]] = row["records"]
        for row in connection.execute(
            "SELECT school_key, topic, COUNT(*) AS records FROM record_facts GROUP BY school_key, topic"
        ):
            school_topic[row["school_key"]][row["topic"]] = row["records"]
        for row in connection.execute(
            """
            SELECT period, school_key, topic, COUNT(*) AS records
            FROM record_facts GROUP BY period, school_key, topic
            """
        ):
            period_school_topic[(row["period"], row["school_key"])][row["topic"]] = row["records"]
        for row in connection.execute(
            """
            SELECT department_key, province_key, district_key, topic, COUNT(*) AS records
            FROM record_facts GROUP BY department_key, province_key, district_key, topic
            """
        ):
            key = (row["department_key"], row["province_key"], row["district_key"])
            geo_topic[key][row["topic"]] = row["records"]
        for row in connection.execute(
            """
            SELECT period, department_key, province_key, district_key, topic, COUNT(*) AS records
            FROM record_facts
            GROUP BY period, department_key, province_key, district_key, topic
            """
        ):
            key = (
                row["period"], row["department_key"],
                row["province_key"], row["district_key"],
            )
            period_geo_topic[key][row["topic"]] = row["records"]
        for row in connection.execute(
            "SELECT sex, topic, COUNT(*) AS records FROM record_facts GROUP BY sex, topic"
        ):
            sex_topic[row["sex"]][row["topic"]] = row["records"]
        record_count = connection.execute("SELECT COUNT(*) FROM academic_records").fetchone()[0]
        dataset_count = connection.execute("SELECT COUNT(*) FROM datasets").fetchone()[0]
        resource_count = connection.execute("SELECT COUNT(*) FROM resources").fetchone()[0]
    finally:
        connection.close()

    periods = sorted(period_topic, key=period_sort_key)
    schools = sorted({school for _, school in period_school_topic if school != "SIN_ESCUELA"})
    topics = [topic for topic in TOPIC_LABELS if topic_totals[topic]]

    funnel = []
    for period in periods:
        counts = period_topic[period]
        if period == "SIN_PERIODO":
            continue
        funnel.append(
            {
                "period": period,
                "postulantes": counts["postulantes"],
                "ingresantes": counts["ingresantes"],
                "egresados": counts["egresados"],
                "bachiller": counts["bachiller"],
                "comedor": counts["comedor"],
                "conversion": pct(counts["ingresantes"], counts["postulantes"]),
            }
        )

    school_rows = []
    for school, counts in school_topic.items():
        if school == "SIN_ESCUELA":
            continue
        demand = counts["postulantes"]
        admitted = counts["ingresantes"]
        graduates = counts["egresados"]
        bachelor = counts["bachiller"]
        comedor = counts["comedor"]
        conversion = pct(admitted, demand)
        support_rate = pct(comedor, admitted) if admitted else pct(comedor, demand)
        completion_signal = pct(bachelor, graduates) if graduates else 0
        demand_score = math.log1p(demand)
        low_conversion = 1 - min(ratio(admitted, demand), 1) if demand else 0
        low_support = 1 - min(ratio(comedor, admitted), 1) if admitted else 0.35
        gap_score = round((demand_score * 13) + (low_conversion * 38) + (low_support * 20), 1)
        school_rows.append(
            {
                "school": title_case(school),
                "school_key": school,
                "postulantes": demand,
                "ingresantes": admitted,
                "egresados": graduates,
                "bachiller": bachelor,
                "comedor": comedor,
                "conversion": conversion,
                "support_rate": support_rate,
                "completion_signal": completion_signal,
                "gap_score": gap_score,
            }
        )
    school_rows.sort(key=lambda x: (x["gap_score"], x["postulantes"]), reverse=True)

    period_school_rows = []
    for (period, school), counts in period_school_topic.items():
        if school == "SIN_ESCUELA" or period == "SIN_PERIODO":
            continue
        demand = counts["postulantes"]
        admitted = counts["ingresantes"]
        comedor = counts["comedor"]
        if demand + admitted + comedor == 0:
            continue
        conversion = pct(admitted, demand)
        support_rate = pct(comedor, admitted) if admitted else pct(comedor, demand)
        demand_score = math.log1p(demand)
        low_conversion = 1 - min(ratio(admitted, demand), 1) if demand else 0
        low_support = 1 - min(ratio(comedor, admitted), 1) if admitted else 0.35
        period_school_rows.append(
            {
                "period": period,
                "school": title_case(school),
                "school_key": school,
                "postulantes": demand,
                "ingresantes": admitted,
                "egresados": counts["egresados"],
                "bachiller": counts["bachiller"],
                "comedor": comedor,
                "conversion": conversion,
                "support_rate": support_rate,
                "completion_signal": pct(counts["bachiller"], counts["egresados"])
                if counts["egresados"] else 0,
                "gap_score": round(
                    (demand_score * 13) + (low_conversion * 38) + (low_support * 20), 1
                ),
            }
        )

    geo_rows = []
    for (dep, prov, dist), counts in geo_topic.items():
        if dep == "SIN_DEP" and prov == "SIN_PROV" and dist == "SIN_DIST":
            continue
        demand = counts["postulantes"]
        admitted = counts["ingresantes"]
        comedor = counts["comedor"]
        geo_rows.append(
            {
                "department": title_case(dep),
                "province": title_case(prov),
                "district": title_case(dist),
                "key": "|".join((dep, prov, dist)),
                "postulantes": demand,
                "ingresantes": admitted,
                "comedor": comedor,
                "egresados": counts["egresados"],
                "cepre": counts["cepre"],
                "conversion": pct(admitted, demand),
                "support_rate": pct(comedor, admitted) if admitted else pct(comedor, demand),
            }
        )
    geo_rows.sort(key=lambda x: (x["postulantes"], x["comedor"]), reverse=True)
    geo_metrics_by_key = {row["key"]: row for row in geo_rows}

    period_geo_rows = []
    for (period, dep, prov, dist), counts in period_geo_topic.items():
        if period == "SIN_PERIODO":
            continue
        period_geo_rows.append(
            {
                "period": period,
                "department": title_case(dep),
                "province": title_case(prov),
                "district": title_case(dist),
                "key": "|".join((dep, prov, dist)),
                "postulantes": counts["postulantes"],
                "ingresantes": counts["ingresantes"],
                "comedor": counts["comedor"],
                "egresados": counts["egresados"],
                "cepre": counts["cepre"],
            }
        )

    sex_rows = []
    for sex, counts in sex_topic.items():
        sex_rows.append(
            {
                "sex": title_case(sex),
                "key": sex,
                "postulantes": counts["postulantes"],
                "ingresantes": counts["ingresantes"],
                "comedor": counts["comedor"],
                "egresados": counts["egresados"],
                "bachiller": counts["bachiller"],
                "cepre": counts["cepre"],
            }
        )

    alerts = []
    for item in period_school_rows:
        if item["postulantes"] >= 250 and item["conversion"] and item["conversion"] < 10:
            alerts.append(
                {
                    "type": "Acceso",
                    "severity": "Alta",
                    "title": f"{item['school']} en {item['period']}",
                    "metric": f"{item['conversion']}% de conversion",
                    "detail": (
                        f"{item['postulantes']:,} postulantes frente a "
                        f"{item['ingresantes']:,} ingresantes."
                    ),
                    "score": round(item["postulantes"] * (10 - item["conversion"]), 1),
                }
            )
    for item in geo_rows[:25]:
        if item["postulantes"] >= 400 and item["support_rate"] < 20:
            alerts.append(
                {
                    "type": "Territorio",
                    "severity": "Media",
                    "title": f"{item['district']}, {item['province']}",
                    "metric": f"{item['postulantes']:,} postulantes",
                    "detail": f"Cobertura comedor estimada: {item['support_rate']}%.",
                    "score": item["postulantes"] * (20 - item["support_rate"]),
                }
            )
    alerts.sort(key=lambda x: x["score"], reverse=True)

    latest_period = max([p for p in periods if p != "SIN_PERIODO"], key=period_sort_key)
    totals = {topic: topic_totals[topic] for topic in topics}
    totals["csv_files"] = len(files)
    totals["records"] = record_count
    totals["datasets"] = dataset_count
    totals["resources"] = resource_count

    return {
        "meta": {
            "title": "Observatorio de Acceso, Permanencia y Bienestar UNCP",
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "source": "Plataforma Nacional de Datos Abiertos - busqueda UNCP",
            "source_url": "https://www.datosabiertos.gob.pe/?query=uncp&sort_by=changed&sort_order=DESC",
            "storage": "SQLite (datos agregados exportados a JSON)",
            "latest_period": latest_period,
        },
        "totals": totals,
        "topics": [{"key": key, "label": TOPIC_LABELS[key]} for key in topics],
        "periods": [p for p in periods if p != "SIN_PERIODO"],
        "schools": [{"key": clean(s), "label": title_case(s)} for s in schools],
        "funnel": funnel,
        "schools_summary": school_rows,
        "period_schools": period_school_rows,
        "geo_summary": geo_rows,
        "gis_features": build_gis_features(geo_metrics_by_key),
        "period_geo": period_geo_rows,
        "sex_summary": sex_rows,
        "alerts": alerts[:60],
        "files": files,
    }


def simplify_ring(ring, max_points=90):
    if len(ring) <= max_points:
        return ring
    step = max(1, math.ceil(len(ring) / max_points))
    simplified = ring[::step]
    if simplified and simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    return simplified


def simplify_geometry(geometry):
    if not geometry:
        return None
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if geom_type == "Polygon":
        return {
            "type": "Polygon",
            "coordinates": [simplify_ring(ring) for ring in coords[:2]],
        }
    if geom_type == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [
                [simplify_ring(ring) for ring in polygon[:2]]
                for polygon in coords[:4]
            ],
        }
    return None


def geometry_bounds(geometry):
    xs = []
    ys = []

    def visit(coords):
        if not coords:
            return
        if isinstance(coords[0], (int, float)):
            xs.append(coords[0])
            ys.append(coords[1])
            return
        for item in coords:
            visit(item)

    visit(geometry.get("coordinates", []))
    if not xs:
        return None
    return [min(xs), min(ys), max(xs), max(ys)]


def merge_bounds(current, bounds):
    if not bounds:
        return current
    if not current:
        return bounds
    return [
        min(current[0], bounds[0]),
        min(current[1], bounds[1]),
        max(current[2], bounds[2]),
        max(current[3], bounds[3]),
    ]


def build_gis_features(geo_metrics_by_key):
    if not DISTRICT_GEOJSON.exists():
        return {"source": "", "bounds": None, "features": []}
    source = json.loads(DISTRICT_GEOJSON.read_text(encoding="utf-8"))
    features = []
    bounds = None
    for feature in source.get("features", []):
        props = feature.get("properties", {})
        key = "|".join(
            (
                clean(props.get("NOMBDEP")),
                clean(props.get("NOMBPROV")),
                clean(props.get("NOMBDIST")),
            )
        )
        metrics = geo_metrics_by_key.get(key)
        if not metrics:
            continue
        geometry = simplify_geometry(feature.get("geometry"))
        if not geometry:
            continue
        feature_bounds = geometry_bounds(geometry)
        bounds = merge_bounds(bounds, feature_bounds)
        features.append(
            {
                "id": props.get("IDDIST") or key,
                "key": key,
                "name": metrics["district"],
                "province": metrics["province"],
                "department": metrics["department"],
                "geometry": geometry,
                "bounds": feature_bounds,
                "metrics": {
                    "postulantes": metrics["postulantes"],
                    "ingresantes": metrics["ingresantes"],
                    "comedor": metrics["comedor"],
                    "egresados": metrics["egresados"],
                    "cepre": metrics["cepre"],
                    "conversion": metrics["conversion"],
                    "support_rate": metrics["support_rate"],
                },
            }
        )
    features.sort(key=lambda item: item["metrics"]["postulantes"], reverse=True)
    return {
        "source": "juaneladio/peru-geojson - peru_distrital_simple.geojson",
        "bounds": bounds,
        "features": features,
    }


def render_html(data):
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    escaped_payload = payload.replace("</", "<\\/")
    return f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(data['meta']['title'])}</title>
  <style>
    :root {{
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #18202b;
      --muted: #667085;
      --line: #d9dee7;
      --blue: #2563eb;
      --teal: #0f766e;
      --green: #2f855a;
      --amber: #b7791f;
      --red: #c2410c;
      --violet: #6d28d9;
      --shadow: 0 1px 2px rgba(16, 24, 40, .08);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--bg);
      letter-spacing: 0;
    }}
    header {{
      background: #ffffff;
      border-bottom: 1px solid var(--line);
    }}
    .wrap {{ width: min(1440px, calc(100vw - 32px)); margin: 0 auto; }}
    .topbar {{
      display: grid;
      grid-template-columns: minmax(280px, 1fr) auto;
      gap: 24px;
      align-items: center;
      padding: 22px 0 16px;
    }}
    h1 {{ font-size: clamp(22px, 3vw, 34px); line-height: 1.1; margin: 0 0 7px; letter-spacing: 0; }}
    .subtitle {{ color: var(--muted); font-size: 14px; max-width: 820px; }}
    .source {{ color: var(--muted); font-size: 12px; text-align: right; }}
    .source a {{ color: var(--blue); text-decoration: none; }}
    .filters {{
      display: grid;
      grid-template-columns: repeat(4, minmax(180px, 1fr));
      gap: 12px;
      padding: 0 0 18px;
    }}
    label {{ display: grid; gap: 5px; color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }}
    select, input {{
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--ink);
      padding: 8px 10px;
      font-size: 14px;
    }}
    main {{ padding: 18px 0 28px; }}
    .kpis {{
      display: grid;
      grid-template-columns: repeat(6, minmax(130px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }}
    .kpi, .panel {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }}
    .kpi {{ padding: 14px; min-height: 94px; }}
    .kpi .label {{ color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }}
    .kpi .value {{ font-size: 28px; font-weight: 800; margin-top: 8px; line-height: 1; }}
    .kpi .note {{ color: var(--muted); font-size: 12px; margin-top: 8px; }}
    .grid {{
      display: grid;
      grid-template-columns: 1.15fr .85fr;
      gap: 16px;
      align-items: start;
    }}
    .grid-3 {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin-top: 16px;
      align-items: start;
    }}
    .panel {{ padding: 16px; min-width: 0; }}
    .panel h2 {{ margin: 0 0 3px; font-size: 17px; line-height: 1.2; }}
    .panel .hint {{ color: var(--muted); font-size: 12px; margin-bottom: 12px; }}
    .chart {{ width: 100%; min-height: 260px; }}
    .bars {{ display: grid; gap: 9px; }}
    .bar-row {{ display: grid; grid-template-columns: minmax(150px, 260px) 1fr 84px; gap: 10px; align-items: center; font-size: 13px; }}
    .bar-label {{ overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #263241; }}
    .bar-track {{ height: 12px; border-radius: 999px; background: #eef1f5; overflow: hidden; }}
    .bar-fill {{ height: 100%; border-radius: 999px; background: var(--blue); }}
    .bar-value {{ text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }}
    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th, td {{ padding: 9px 8px; border-bottom: 1px solid #edf0f4; text-align: left; vertical-align: top; }}
    th {{ color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0; }}
    td.num, th.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
    .table-wrap {{ overflow-x: auto; }}
    .badge {{ display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 8px; font-size: 12px; font-weight: 700; }}
    .high {{ color: #8a2c0d; background: #ffedd5; }}
    .mid {{ color: #7c5c08; background: #fef3c7; }}
    .ok {{ color: #166534; background: #dcfce7; }}
    .tabs {{ display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }}
    .tab {{ border: 1px solid var(--line); background: #fff; border-radius: 6px; min-height: 34px; padding: 7px 11px; cursor: pointer; font-weight: 700; color: var(--muted); }}
    .tab.active {{ color: #fff; background: var(--ink); border-color: var(--ink); }}
    .alert-list {{ display: grid; gap: 10px; max-height: 465px; overflow: auto; padding-right: 4px; }}
    .alert {{ border: 1px solid #eceff4; border-radius: 8px; padding: 10px 11px; background: #fff; }}
    .alert-head {{ display: flex; justify-content: space-between; gap: 10px; align-items: start; }}
    .alert-title {{ font-weight: 800; line-height: 1.25; }}
    .alert-detail {{ color: var(--muted); font-size: 12px; margin-top: 5px; }}
    .empty {{ color: var(--muted); font-size: 13px; padding: 14px 0; }}
    footer {{ color: var(--muted); font-size: 12px; padding: 8px 0 24px; }}
    @media (max-width: 1120px) {{
      .kpis {{ grid-template-columns: repeat(3, 1fr); }}
      .grid, .grid-3 {{ grid-template-columns: 1fr; }}
      .filters {{ grid-template-columns: repeat(2, 1fr); }}
    }}
    @media (max-width: 680px) {{
      .wrap {{ width: min(100vw - 20px, 1440px); }}
      .topbar {{ grid-template-columns: 1fr; }}
      .source {{ text-align: left; }}
      .filters, .kpis {{ grid-template-columns: 1fr; }}
      .bar-row {{ grid-template-columns: 1fr; gap: 5px; }}
      .bar-value {{ text-align: left; }}
      .panel {{ padding: 12px; }}
    }}
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <div class="topbar">
        <div>
          <h1>Observatorio de Acceso, Permanencia y Bienestar UNCP</h1>
          <div class="subtitle">Dashboard de datatón construido con datasets abiertos de postulantes, ingresantes, comedor, egresados, bachilleres y CEPRE.</div>
        </div>
        <div class="source">
          Fuente: <a href="{html.escape(data['meta']['source_url'])}" target="_blank" rel="noreferrer">datosabiertos.gob.pe</a><br>
          Actualizado: <span id="generatedAt"></span>
        </div>
      </div>
      <section class="filters" aria-label="Filtros">
        <label>Periodo
          <select id="periodFilter"></select>
        </label>
        <label>Escuela
          <select id="schoolFilter"></select>
        </label>
        <label>Sexo
          <select id="sexFilter"></select>
        </label>
        <label>Buscar distrito o carrera
          <input id="searchFilter" type="search" placeholder="Ej. El Tambo, Medicina, Sistemas">
        </label>
      </section>
    </div>
  </header>
  <main class="wrap">
    <section class="kpis" id="kpis"></section>
    <section class="grid">
      <div class="panel">
        <h2>Embudo por periodo</h2>
        <div class="hint">Postulantes, ingresantes, egresados y bachilleres comparados por semestre.</div>
        <div id="funnelChart" class="chart"></div>
      </div>
      <div class="panel">
        <h2>Alertas priorizadas</h2>
        <div class="hint">Alta demanda, baja conversión o baja cobertura relativa.</div>
        <div id="alerts" class="alert-list"></div>
      </div>
    </section>
    <section class="grid-3">
      <div class="panel">
        <h2>Ranking de carreras</h2>
        <div class="hint">Ordenado por índice de brecha calculado.</div>
        <div id="schoolBars" class="bars"></div>
      </div>
      <div class="panel">
        <h2>Territorio</h2>
        <div class="hint">Distritos con mayor concentración de registros.</div>
        <div class="tabs" id="geoTabs"></div>
        <div id="geoBars" class="bars"></div>
      </div>
      <div class="panel">
        <h2>Sexo</h2>
        <div class="hint">Distribución por tema en los registros con sexo disponible.</div>
        <div id="sexChart" class="bars"></div>
      </div>
    </section>
    <section class="panel" style="margin-top:16px">
      <h2>Matriz de decisión</h2>
      <div class="hint">Carreras con señales combinadas de presión de acceso y bienestar.</div>
      <div class="table-wrap"><table id="decisionTable"></table></div>
    </section>
  </main>
  <footer class="wrap">Producto local autocontenido. Datos procesados en data/processed/uncp_dashboard_data.json.</footer>
  <script id="dashboard-data" type="application/json">{escaped_payload}</script>
  <script>
    const DATA = JSON.parse(document.getElementById('dashboard-data').textContent);
    const nf = new Intl.NumberFormat('es-PE');
    const pct = value => `${{Number(value || 0).toFixed(1).replace('.0','')}}%`;
    const colors = {{
      postulantes: '#2563eb',
      ingresantes: '#0f766e',
      egresados: '#b7791f',
      bachiller: '#6d28d9',
      comedor: '#2f855a',
      cepre: '#c2410c'
    }};
    let geoMode = 'postulantes';

    function $(id) {{ return document.getElementById(id); }}
    function option(value, label) {{ return `<option value="${{escapeAttr(value)}}">${{escapeHtml(label)}}</option>`; }}
    function escapeHtml(value) {{
      return String(value ?? '').replace(/[&<>"']/g, ch => ({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}}[ch]));
    }}
    function escapeAttr(value) {{ return escapeHtml(value); }}
    function selectedFilters() {{
      return {{
        period: $('periodFilter').value,
        school: $('schoolFilter').value,
        sex: $('sexFilter').value,
        q: $('searchFilter').value.trim().toLowerCase()
      }};
    }}
    function includesQuery(...values) {{
      const q = selectedFilters().q;
      if (!q) return true;
      return values.join(' ').toLowerCase().includes(q);
    }}
    function initFilters() {{
      $('generatedAt').textContent = new Date(DATA.meta.generated_at).toLocaleString('es-PE');
      $('periodFilter').innerHTML = option('ALL', 'Todos') + DATA.periods.map(p => option(p, p)).join('');
      $('periodFilter').value = DATA.meta.latest_period;
      $('schoolFilter').innerHTML = option('ALL', 'Todas') + DATA.schools.map(s => option(s.key, s.label)).join('');
      const sexes = [...new Set(DATA.sex_summary.map(s => s.key))].sort();
      $('sexFilter').innerHTML = option('ALL', 'Todos') + sexes.map(s => option(s, titleCase(s))).join('');
      ['periodFilter','schoolFilter','sexFilter','searchFilter'].forEach(id => $(id).addEventListener('input', render));
      renderGeoTabs();
    }}
    function titleCase(value) {{
      return String(value || 'Sin dato').toLowerCase().replace(/(^|\\s)\\S/g, ch => ch.toUpperCase());
    }}
    function filterPeriodRows(rows) {{
      const f = selectedFilters();
      return rows.filter(row => (f.period === 'ALL' || row.period === f.period));
    }}
    function currentRows() {{
      const f = selectedFilters();
      return DATA.period_schools.filter(row =>
        (f.period === 'ALL' || row.period === f.period) &&
        (f.school === 'ALL' || row.school_key === f.school) &&
        includesQuery(row.school)
      );
    }}
    function metricFromRows(rows, key) {{ return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0); }}
    function renderKpis() {{
      const f = selectedFilters();
      const rows = currentRows();
      const geoRows = DATA.period_geo.filter(row => f.period === 'ALL' || row.period === f.period);
      const postulantes = metricFromRows(rows, 'postulantes');
      const ingresantes = metricFromRows(rows, 'ingresantes');
      const egresados = metricFromRows(rows, 'egresados');
      const comedor = metricFromRows(rows, 'comedor');
      const conversion = postulantes ? ingresantes * 100 / postulantes : 0;
      const topGeo = [...geoRows].sort((a,b) => (b.postulantes + b.comedor) - (a.postulantes + a.comedor))[0];
      const kpis = [
        ['Datasets', DATA.totals.datasets, `${{DATA.totals.resources}} recursos`],
        ['Postulantes', postulantes, f.period === 'ALL' ? 'todos los periodos' : f.period],
        ['Ingresantes', ingresantes, `${{pct(conversion)}} conversion`],
        ['Comedor', comedor, 'beneficiarios registrados'],
        ['Egresados', egresados, 'periodos publicados'],
        ['Distrito lider', topGeo ? topGeo.district : 'Sin dato', topGeo ? topGeo.province : '']
      ];
      $('kpis').innerHTML = kpis.map(([label, value, note]) => `
        <article class="kpi"><div class="label">${{escapeHtml(label)}}</div><div class="value">${{typeof value === 'number' ? nf.format(value) : escapeHtml(value)}}</div><div class="note">${{escapeHtml(note)}}</div></article>
      `).join('');
    }}
    function renderFunnel() {{
      const f = selectedFilters();
      const rows = DATA.funnel.filter(row => f.period === 'ALL' || row.period === f.period);
      const max = Math.max(1, ...rows.flatMap(row => [row.postulantes, row.ingresantes, row.egresados, row.bachiller]));
      if (!rows.length) {{ $('funnelChart').innerHTML = '<div class="empty">Sin datos para el filtro.</div>'; return; }}
      $('funnelChart').innerHTML = `
        <div class="bars">
          ${{rows.map(row => `
            <div style="font-weight:800;margin-top:4px">${{escapeHtml(row.period)}} <span style="color:var(--muted);font-weight:600">conversion ${{pct(row.conversion)}}</span></div>
            ${{['postulantes','ingresantes','egresados','bachiller'].map(key => `
              <div class="bar-row">
                <div class="bar-label">${{labelFor(key)}}</div>
                <div class="bar-track"><div class="bar-fill" style="width:${{Math.max(1, row[key] / max * 100)}}%;background:${{colors[key]}}"></div></div>
                <div class="bar-value">${{nf.format(row[key])}}</div>
              </div>
            `).join('')}}
          `).join('')}}
        </div>`;
    }}
    function labelFor(key) {{
      const item = DATA.topics.find(t => t.key === key);
      return item ? item.label : titleCase(key);
    }}
    function filteredSchoolSummary() {{
      const f = selectedFilters();
      let rows = DATA.schools_summary.filter(row => (f.school === 'ALL' || row.school_key === f.school) && includesQuery(row.school));
      if (f.period !== 'ALL') {{
        const bySchool = new Map(DATA.period_schools.filter(row => row.period === f.period).map(row => [row.school_key, row]));
        rows = rows.map(row => Object.assign({{}}, row, bySchool.get(row.school_key) || {{postulantes:0,ingresantes:0,egresados:0,bachiller:0,comedor:0,conversion:0}}));
      }}
      return rows;
    }}
    function renderSchoolBars() {{
      const rows = filteredSchoolSummary().filter(row => row.postulantes + row.ingresantes + row.comedor > 0).sort((a,b) => (b.gap_score || 0) - (a.gap_score || 0)).slice(0, 12);
      const max = Math.max(1, ...rows.map(row => row.gap_score || row.postulantes));
      $('schoolBars').innerHTML = rows.length ? rows.map(row => `
        <div class="bar-row">
          <div class="bar-label" title="${{escapeAttr(row.school)}}">${{escapeHtml(row.school)}}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${{Math.max(2, (row.gap_score || row.postulantes) / max * 100)}}%;background:var(--red)"></div></div>
          <div class="bar-value">${{nf.format(row.postulantes)}} / ${{pct(row.conversion)}}</div>
        </div>
      `).join('') : '<div class="empty">Sin carreras para el filtro.</div>';
    }}
    function renderGeoTabs() {{
      const modes = [['postulantes','Postulantes'],['comedor','Comedor'],['ingresantes','Ingresantes'],['cepre','CEPRE']];
      $('geoTabs').innerHTML = modes.map(([key,label]) => `<button class="tab ${{key === geoMode ? 'active' : ''}}" data-mode="${{key}}">${{label}}</button>`).join('');
      $('geoTabs').querySelectorAll('button').forEach(button => button.addEventListener('click', () => {{
        geoMode = button.dataset.mode;
        renderGeoTabs();
        renderGeoBars();
      }}));
    }}
    function renderGeoBars() {{
      const f = selectedFilters();
      let rows = f.period === 'ALL' ? DATA.geo_summary : DATA.period_geo.filter(row => row.period === f.period);
      rows = rows.filter(row => includesQuery(row.department, row.province, row.district));
      const grouped = new Map();
      for (const row of rows) {{
        const key = row.key;
        const current = grouped.get(key) || {{district: row.district, province: row.province, department: row.department, value: 0}};
        current.value += Number(row[geoMode] || 0);
        grouped.set(key, current);
      }}
      rows = [...grouped.values()].filter(row => row.value > 0).sort((a,b) => b.value - a.value).slice(0, 12);
      const max = Math.max(1, ...rows.map(row => row.value));
      $('geoBars').innerHTML = rows.length ? rows.map(row => `
        <div class="bar-row">
          <div class="bar-label" title="${{escapeAttr(row.district + ', ' + row.province)}}">${{escapeHtml(row.district)}} <span style="color:var(--muted)">/ ${{escapeHtml(row.province)}}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${{Math.max(2, row.value / max * 100)}}%;background:var(--teal)"></div></div>
          <div class="bar-value">${{nf.format(row.value)}}</div>
        </div>
      `).join('') : '<div class="empty">Sin territorios para el filtro.</div>';
    }}
    function renderSexChart() {{
      const f = selectedFilters();
      let rows = DATA.sex_summary;
      if (f.sex !== 'ALL') rows = rows.filter(row => row.key === f.sex);
      const keys = ['postulantes','ingresantes','comedor','egresados','bachiller'];
      const flattened = [];
      rows.forEach(row => keys.forEach(key => {{ if (row[key]) flattened.push({{label: `${{row.sex}} - ${{labelFor(key)}}`, value: row[key], key}}); }}));
      flattened.sort((a,b) => b.value - a.value);
      const max = Math.max(1, ...flattened.map(row => row.value));
      $('sexChart').innerHTML = flattened.slice(0, 12).map(row => `
        <div class="bar-row">
          <div class="bar-label">${{escapeHtml(row.label)}}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${{Math.max(2, row.value / max * 100)}}%;background:${{colors[row.key]}}"></div></div>
          <div class="bar-value">${{nf.format(row.value)}}</div>
        </div>
      `).join('') || '<div class="empty">Sin datos de sexo para el filtro.</div>';
    }}
    function severityBadge(alert) {{
      const cls = alert.severity === 'Alta' ? 'high' : alert.severity === 'Media' ? 'mid' : 'ok';
      return `<span class="badge ${{cls}}">${{escapeHtml(alert.severity)}}</span>`;
    }}
    function renderAlerts() {{
      const f = selectedFilters();
      const rows = DATA.alerts.filter(alert =>
        (f.period === 'ALL' || alert.title.includes(f.period)) &&
        includesQuery(alert.title, alert.detail, alert.metric)
      ).slice(0, 18);
      $('alerts').innerHTML = rows.length ? rows.map(alert => `
        <article class="alert">
          <div class="alert-head"><div><div class="alert-title">${{escapeHtml(alert.title)}}</div><div class="alert-detail">${{escapeHtml(alert.type)}} · ${{escapeHtml(alert.metric)}}</div></div>${{severityBadge(alert)}}</div>
          <div class="alert-detail">${{escapeHtml(alert.detail)}}</div>
        </article>
      `).join('') : '<div class="empty">No hay alertas para el filtro actual.</div>';
    }}
    function renderDecisionTable() {{
      const rows = filteredSchoolSummary().filter(row => row.postulantes + row.ingresantes + row.comedor + row.egresados + row.bachiller > 0)
        .sort((a,b) => (b.gap_score || 0) - (a.gap_score || 0)).slice(0, 25);
      const head = '<thead><tr><th>Carrera</th><th class="num">Post.</th><th class="num">Ing.</th><th class="num">Conv.</th><th class="num">Comedor</th><th class="num">Egres.</th><th class="num">Bach.</th><th>Prioridad</th></tr></thead>';
      const body = rows.map(row => {{
        const cls = row.gap_score >= 120 ? 'high' : row.gap_score >= 90 ? 'mid' : 'ok';
        const label = row.gap_score >= 120 ? 'Alta' : row.gap_score >= 90 ? 'Media' : 'Baja';
        return `<tr>
          <td>${{escapeHtml(row.school)}}</td>
          <td class="num">${{nf.format(row.postulantes)}}</td>
          <td class="num">${{nf.format(row.ingresantes)}}</td>
          <td class="num">${{pct(row.conversion)}}</td>
          <td class="num">${{nf.format(row.comedor)}}</td>
          <td class="num">${{nf.format(row.egresados)}}</td>
          <td class="num">${{nf.format(row.bachiller)}}</td>
          <td><span class="badge ${{cls}}">${{label}}</span></td>
        </tr>`;
      }}).join('');
      $('decisionTable').innerHTML = head + `<tbody>${{body || '<tr><td colspan="8">Sin datos para el filtro.</td></tr>'}}</tbody>`;
    }}
    function render() {{
      renderKpis();
      renderFunnel();
      renderSchoolBars();
      renderGeoBars();
      renderSexChart();
      renderAlerts();
      renderDecisionTable();
    }}
    initFilters();
    render();
  </script>
</body>
</html>
"""


def main():
    PROCESSED.mkdir(parents=True, exist_ok=True)
    DIST.mkdir(parents=True, exist_ok=True)
    FRONTEND_DATA_JSON.parent.mkdir(parents=True, exist_ok=True)
    data = build_data()
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    DATA_JSON.write_text(payload, encoding="utf-8")
    FRONTEND_DATA_JSON.write_text(payload, encoding="utf-8")
    INDEX_HTML.write_text(render_html(data), encoding="utf-8")
    print(f"processed={DATA_JSON}")
    print(f"frontend_data={FRONTEND_DATA_JSON}")
    print(f"dashboard={INDEX_HTML}")
    print(f"records={data['totals']['records']} datasets={data['totals']['datasets']} resources={data['totals']['resources']}")


if __name__ == "__main__":
    main()
