import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Compass,
  Database,
  Download,
  ExternalLink,
  Filter,
  GraduationCap,
  LayoutDashboard,
  Map as MapIcon,
  MapPinned,
  RotateCcw,
  School,
  Search,
  Target,
  Users,
  Utensils,
} from 'lucide-react'
import dashboardData from './data/uncp_dashboard_data.json'
import './App.css'

const COLORS = {
  postulantes: '#2563eb',
  ingresantes: '#0f766e',
  comedor: '#16a34a',
  egresados: '#d97706',
  bachiller: '#7c3aed',
  cepre: '#ea580c',
}

const TABS = [
  { id: 'overview', label: 'Visión Global', icon: LayoutDashboard },
  { id: 'admission', label: 'Admisión y Selectividad', icon: Target },
  { id: 'welfare', label: 'Permanencia y Bienestar', icon: Utensils },
  { id: 'gis', label: 'Territorio y Rutas GIS', icon: MapPinned },
  { id: 'explorer', label: 'Explorador de Carreras', icon: BarChart3 },
]

const GEO_MODES = [
  { key: 'postulantes', label: 'Postulantes', color: '#2563eb' },
  { key: 'ingresantes', label: 'Ingresantes', color: '#0f766e' },
  { key: 'comedor', label: 'Comedor', color: '#16a34a' },
  { key: 'cepre', label: 'CEPRE UNCP', color: '#ea580c' },
]

const nf = new Intl.NumberFormat('es-PE')

function formatNumber(value) {
  return nf.format(Number(value || 0))
}

function formatPct(value) {
  return `${Number(value || 0).toFixed(1).replace('.0', '')}%`
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function shorten(value, limit = 32) {
  if (!value) return 'Sin dato'
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0)
}

function matchesQuery(query, ...values) {
  if (!query) return true
  const haystack = normalize(values.join(' '))
  return haystack.includes(normalize(query))
}

function mergeSchoolPeriodRows(period, summaryRows, periodRows) {
  if (period === 'ALL') return summaryRows
  const gapBySchool = new Map(summaryRows.map((row) => [row.school_key, row.gap_score]))
  return periodRows
    .filter((row) => row.period === period)
    .map((row) => ({
      ...row,
      gap_score: row.gap_score ?? gapBySchool.get(row.school_key) ?? row.postulantes,
      support_rate:
        row.support_rate ?? (row.ingresantes ? (row.comedor * 100) / row.ingresantes : 0),
    }))
}

// Proyección de coordenadas geográficas a coordenadas SVG
function projectPoint(point, bounds, width, height) {
  const [minX, minY, maxX, maxY] = bounds
  const [lon, lat] = point
  const spanX = maxX - minX || 0.001
  const spanY = maxY - minY || 0.001
  const x = ((lon - minX) / spanX) * width
  const y = ((maxY - lat) / spanY) * height
  return [x, y]
}

function ringToPath(ring, bounds, width, height) {
  return ring
    .map((point, index) => {
      const [x, y] = projectPoint(point, bounds, width, height)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
    .concat(' Z')
}

function geometryToPath(geometry, bounds, width, height) {
  if (!geometry) return ''
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring) => ringToPath(ring, bounds, width, height)).join(' ')
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates
      .flatMap((polygon) => polygon.map((ring) => ringToPath(ring, bounds, width, height)))
      .join(' ')
  }
  return ''
}

function colorForValue(value, max, baseColor = '#0f766e') {
  if (!value || !max) return '#f1f5f9'
  const ratio = Math.max(0.12, Math.min(1, value / max))
  if (baseColor === '#2563eb') {
    if (ratio > 0.7) return '#1d4ed8'
    if (ratio > 0.4) return '#3b82f6'
    if (ratio > 0.18) return '#93c5fd'
    return '#dbeafe'
  }
  if (baseColor === '#16a34a') {
    if (ratio > 0.7) return '#15803d'
    if (ratio > 0.4) return '#22c55e'
    if (ratio > 0.18) return '#86efac'
    return '#dcfce7'
  }
  if (baseColor === '#ea580c') {
    if (ratio > 0.7) return '#c2410c'
    if (ratio > 0.4) return '#f97316'
    if (ratio > 0.18) return '#fdba74'
    return '#ffedd5'
  }
  if (ratio > 0.72) return '#0f766e'
  if (ratio > 0.42) return '#14b8a6'
  if (ratio > 0.2) return '#5eead4'
  return '#ccfbf1'
}

function computeBoundsForFeatures(features) {
  if (!features || features.length === 0) {
    return [-81.3, -18.3, -69.8, -3.3]
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const f of features) {
    if (!f.bounds) continue
    if (f.bounds[0] < minX) minX = f.bounds[0]
    if (f.bounds[1] < minY) minY = f.bounds[1]
    if (f.bounds[2] > maxX) maxX = f.bounds[2]
    if (f.bounds[3] > maxY) maxY = f.bounds[3]
  }

  if (!isFinite(minX) || !isFinite(maxX)) {
    return [-81.3, -18.3, -69.8, -3.3]
  }

  const padX = (maxX - minX) * 0.05 || 0.05
  const padY = (maxY - minY) * 0.05 || 0.05
  return [minX - padX, minY - padY, maxX + padX, maxY + padY]
}

function getFeatureCentroid(feature) {
  if (feature.bounds) {
    return [(feature.bounds[0] + feature.bounds[2]) / 2, (feature.bounds[1] + feature.bounds[3]) / 2]
  }
  return null
}

function KpiCard({ icon: Icon, label, value, note, color = 'blue' }) {
  return (
    <article className={`kpi-card accent-${color}`}>
      <div className="kpi-icon" aria-hidden="true">
        <Icon size={20} />
      </div>
      <div className="kpi-body">
        <div className="kpi-label">{label}</div>
        <div className="kpi-value">{value}</div>
        <div className="kpi-note">{note}</div>
      </div>
    </article>
  )
}

function Panel({ title, hint, children, action, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {hint ? <p>{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Empty({ children = 'Sin datos para los filtros seleccionados.' }) {
  return <div className="empty-state">{children}</div>
}

function PriorityBadge({ score }) {
  const label = score >= 120 ? 'Alta Prioridad' : score >= 80 ? 'Media Prioridad' : 'Baja'
  const cls = score >= 120 ? 'high' : score >= 80 ? 'mid' : 'low'
  return <span className={`badge ${cls}`}>{label}</span>
}

function AlertBadge({ severity }) {
  const cls = severity === 'Alta' ? 'high' : severity === 'Media' ? 'mid' : 'low'
  return <span className={`badge ${cls}`}>{severity}</span>
}

function HorizontalBars({ rows, valueKey, color, valueLabel = formatNumber }) {
  const max = Math.max(1, ...rows.map((row) => Number(row[valueKey] || 0)))
  if (!rows.length) return <Empty />

  return (
    <div className="bar-list">
      {rows.map((row) => {
        const value = Number(row[valueKey] || 0)
        return (
          <div className="bar-line" key={`${row.label}-${valueKey}`}>
            <div className="bar-name" title={row.fullLabel || row.label}>
              {row.label}
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${Math.max(2, (value / max) * 100)}%`, background: color }}
              />
            </div>
            <div className="bar-number">{valueLabel(value, row)}</div>
          </div>
        )
      })}
    </div>
  )
}

function FunnelChart({ rows }) {
  const keys = [
    ['postulantes', 'Postulantes', COLORS.postulantes],
    ['ingresantes', 'Ingresantes', COLORS.ingresantes],
    ['egresados', 'Egresados', COLORS.egresados],
    ['bachiller', 'Bachilleres', COLORS.bachiller],
  ]
  const max = Math.max(1, ...rows.flatMap((row) => keys.map(([key]) => Number(row[key] || 0))))
  if (!rows.length) return <Empty />

  return (
    <div className="funnel-list">
      {rows.map((row) => (
        <div className="funnel-period" key={row.period}>
          <div className="funnel-title">
            <span className="period-pill">{row.period}</span>
            <span className="conversion-pill">
              {row.postulantes
                ? `${formatPct(row.conversion)} de conversión`
                : 'Sin postulantes registrados'}
            </span>
          </div>
          <div className="funnel-bars">
            {keys.map(([key, label, color]) => (
              <div className="bar-line compact" key={`${row.period}-${key}`}>
                <div className="bar-name">{label}</div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${row[key] ? Math.max(2, (row[key] / max) * 100) : 0}%`,
                      background: color,
                    }}
                  />
                </div>
                <div className="bar-number">{formatNumber(row[key])}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SexDistribution({ rows }) {
  const keys = [
    ['postulantes', 'Postulantes', COLORS.postulantes],
    ['ingresantes', 'Ingresantes', COLORS.ingresantes],
    ['comedor', 'Comedor', COLORS.comedor],
    ['egresados', 'Egresados', COLORS.egresados],
    ['bachiller', 'Bachilleres', COLORS.bachiller],
  ]
  const flattened = rows.flatMap((row) =>
    keys
      .filter(([key]) => row[key] > 0)
      .map(([key, label, color]) => ({
        label: `${row.name} · ${label}`,
        value: row[key],
        color,
      })),
  )
  return (
    <HorizontalBars
      rows={flattened.slice(0, 14)}
      valueKey="value"
      color={COLORS.postulantes}
      valueLabel={(value) => formatNumber(value)}
    />
  )
}

export default function App() {
  const data = dashboardData
  const [activeTab, setActiveTab] = useState('overview')
  const [period, setPeriod] = useState('ALL')
  const [school, setSchool] = useState('ALL')
  const [sex, setSex] = useState('ALL')
  const [query, setQuery] = useState('')

  // Estados específicos de GIS
  const [geoMode, setGeoMode] = useState('postulantes')
  const [geoDepartment, setGeoDepartment] = useState('Junin')
  const [geoProvince, setGeoProvince] = useState('ALL')
  const [selectedFeature, setSelectedFeature] = useState(null)
  const [showRoutes, setShowRoutes] = useState(true)

  // Tabla interactiva
  const [tableSortKey, setTableSortKey] = useState('postulantes')
  const [tableSortAsc, setTableSortAsc] = useState(false)

  const activeMetricObj = GEO_MODES.find((m) => m.key === geoMode) || GEO_MODES[0]

  const filteredSchoolRows = useMemo(() => {
    return mergeSchoolPeriodRows(period, data.schools_summary, data.period_schools)
      .filter((row) => school === 'ALL' || row.school_key === school)
      .filter((row) => matchesQuery(query, row.school))
      .filter(
        (row) =>
          row.postulantes + row.ingresantes + row.comedor + row.egresados + row.bachiller > 0,
      )
      .sort((a, b) => (b.gap_score || 0) - (a.gap_score || 0))
  }, [data.period_schools, data.schools_summary, period, query, school])

  const funnelRows = useMemo(() => {
    return data.funnel.filter((row) => period === 'ALL' || row.period === period)
  }, [data.funnel, period])

  const geoRows = useMemo(() => {
    const rows =
      period === 'ALL'
        ? data.geo_summary
        : data.period_geo.filter((row) => row.period === period)
    const grouped = new Map()
    rows
      .filter((row) => matchesQuery(query, row.department, row.province, row.district))
      .forEach((row) => {
        const key = row.key
        const current = grouped.get(key) || {
          district: row.district,
          province: row.province,
          department: row.department,
          value: 0,
        }
        current.value += Number(row[geoMode] || 0)
        grouped.set(key, current)
      })
    return [...grouped.values()].filter((row) => row.value > 0).sort((a, b) => b.value - a.value)
  }, [data.geo_summary, data.period_geo, geoMode, period, query])

  // GIS: Departamentos y Provincias disponibles
  const availableDepartments = useMemo(() => {
    const depts = new Set()
    data.gis_features.features.forEach((f) => {
      if (f.department) depts.add(f.department)
    })
    return Array.from(depts).sort()
  }, [data.gis_features.features])

  const availableProvinces = useMemo(() => {
    const provs = new Set()
    data.gis_features.features
      .filter((f) => geoDepartment === 'ALL' || f.department === geoDepartment)
      .forEach((f) => {
        if (f.province) provs.add(f.province)
      })
    return Array.from(provs).sort()
  }, [data.gis_features.features, geoDepartment])

  // Features filtradas según departamento, provincia y búsqueda
  const gisFilteredFeatures = useMemo(() => {
    const periodMetrics = new Map()
    if (period !== 'ALL') {
      data.period_geo
        .filter((row) => row.period === period)
        .forEach((row) => periodMetrics.set(row.key, row))
    }

    return data.gis_features.features
      .map((feature) => {
        const metrics = period === 'ALL' ? feature.metrics : periodMetrics.get(feature.key)
        const value = Number(metrics?.[geoMode] || 0)
        return {
          ...feature,
          value,
          computedMetrics: metrics || feature.metrics || {},
        }
      })
      .filter((f) => geoDepartment === 'ALL' || f.department === geoDepartment)
      .filter((f) => geoProvince === 'ALL' || f.province === geoProvince)
      .filter((f) => matchesQuery(query, f.name, f.province, f.department))
      .sort((a, b) => b.value - a.value)
  }, [
    data.gis_features.features,
    data.period_geo,
    geoDepartment,
    geoMode,
    geoProvince,
    period,
    query,
  ])

  // Encuadre dinámico según las features visibles
  const activeBounds = useMemo(() => {
    if (geoDepartment === 'ALL') {
      return data.gis_features.bounds || [-81.3, -18.3, -69.8, -3.3]
    }
    return computeBoundsForFeatures(gisFilteredFeatures)
  }, [data.gis_features.bounds, geoDepartment, gisFilteredFeatures])

  // Coordenadas fijas del Campus UNCP en El Tambo / Huancayo
  const uncpCampusPoint = useMemo(() => {
    const tambo = data.gis_features.features.find((f) => f.name === 'El Tambo')
    if (tambo) return getFeatureCentroid(tambo)
    return [-75.22, -12.04]
  }, [data.gis_features.features])

  // Rutas / Corredores de procedencia hacia la UNCP
  const corridorRoutes = useMemo(() => {
    if (!showRoutes || !uncpCampusPoint) return []
    return gisFilteredFeatures
      .filter((f) => f.name !== 'El Tambo' && f.value > 0)
      .slice(0, 16)
      .map((f) => {
        const origin = getFeatureCentroid(f)
        return {
          id: f.id,
          name: f.name,
          province: f.province,
          value: f.value,
          origin,
          destination: uncpCampusPoint,
        }
      })
      .filter((r) => r.origin !== null)
  }, [gisFilteredFeatures, showRoutes, uncpCampusPoint])

  const sexRows = useMemo(() => {
    return data.sex_summary
      .filter((row) => sex === 'ALL' || row.key === sex)
      .map((row) => ({
        name: row.sex,
        postulantes: row.postulantes,
        ingresantes: row.ingresantes,
        comedor: row.comedor,
        egresados: row.egresados,
        bachiller: row.bachiller,
      }))
  }, [data.sex_summary, sex])

  const alertRows = useMemo(() => {
    return data.alerts
      .filter((alert) => period === 'ALL' || alert.title.includes(period))
      .filter((alert) => matchesQuery(query, alert.title, alert.detail, alert.metric))
  }, [data.alerts, period, query])

  const kpis = useMemo(() => {
    const postulantes = sum(filteredSchoolRows, 'postulantes')
    const ingresantes = sum(filteredSchoolRows, 'ingresantes')
    const comedor = sum(filteredSchoolRows, 'comedor')
    const egresados = sum(filteredSchoolRows, 'egresados')
    const bachiller = sum(filteredSchoolRows, 'bachiller')
    const conversion = postulantes ? (ingresantes * 100) / postulantes : 0
    const topGeo = geoRows[0]

    return [
      {
        icon: Database,
        label: 'Base SQLite Activa',
        value: formatNumber(data.totals.records),
        note: `${data.totals.datasets} datasets · ${data.totals.resources} archivos`,
        color: 'emerald',
      },
      {
        icon: Users,
        label: 'Postulantes',
        value: formatNumber(postulantes),
        note: period === 'ALL' ? 'Todos los semestres' : `Periodo ${period}`,
        color: 'blue',
      },
      {
        icon: Target,
        label: 'Conversión de Ingreso',
        value: formatPct(conversion),
        note: `${formatNumber(ingresantes)} ingresantes admitidos`,
        color: 'teal',
      },
      {
        icon: Utensils,
        label: 'Comedor Universitario',
        value: formatNumber(comedor),
        note: 'Beneficiarios asistidos',
        color: 'green',
      },
      {
        icon: GraduationCap,
        label: 'Egresados / Bachilleres',
        value: `${formatNumber(egresados)} / ${formatNumber(bachiller)}`,
        note: 'Registros consolidados',
        color: 'purple',
      },
      {
        icon: MapPinned,
        label: 'Territorio Principal',
        value: topGeo ? shorten(topGeo.district, 18) : 'Sin dato',
        note: topGeo ? `${topGeo.province} (${formatNumber(topGeo.value)})` : 'Sin registros',
        color: 'amber',
      },
    ]
  }, [
    data.totals.datasets,
    data.totals.records,
    data.totals.resources,
    filteredSchoolRows,
    geoRows,
    period,
  ])

  // Datos ordenados para la tabla completa
  const sortedTableRows = useMemo(() => {
    return [...filteredSchoolRows].sort((a, b) => {
      const valA = a[tableSortKey] ?? 0
      const valB = b[tableSortKey] ?? 0
      if (typeof valA === 'string') {
        return tableSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA)
      }
      return tableSortAsc ? valA - valB : valB - valA
    })
  }, [filteredSchoolRows, tableSortAsc, tableSortKey])

  // Exportar vista actual a CSV
  const handleExportCSV = () => {
    const headers = [
      'Escuela Profesional',
      'Periodo',
      'Postulantes',
      'Ingresantes',
      'Tasa Conversion (%)',
      'Comedor',
      'Egresados',
      'Bachilleres',
      'Indice Brecha',
    ]
    const rows = sortedTableRows.map((r) => [
      `"${r.school}"`,
      r.period || 'TODOS',
      r.postulantes,
      r.ingresantes,
      r.conversion.toFixed(1),
      r.comedor,
      r.egresados,
      r.bachiller,
      (r.gap_score || 0).toFixed(1),
    ])
    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `observatorio_uncp_${period}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleResetFilters = () => {
    setPeriod('ALL')
    setSchool('ALL')
    setSex('ALL')
    setQuery('')
    setGeoDepartment('Junin')
    setGeoProvince('ALL')
    setSelectedFeature(null)
  }

  const isFiltered =
    period !== 'ALL' ||
    school !== 'ALL' ||
    sex !== 'ALL' ||
    query !== '' ||
    geoDepartment !== 'Junin' ||
    geoProvince !== 'ALL'

  // Dimensiones del canvas SVG para GIS
  const mapSvgWidth = 940
  const mapSvgHeight = 580
  const maxGeoValue = Math.max(1, ...gisFilteredFeatures.map((f) => f.value))

  return (
    <div className="app-shell">
      {/* Top Banner Institucional */}
      <header className="app-header">
        <div className="header-top">
          <div className="brand-group">
            <div className="brand-badge">
              <School size={16} /> UNCP · Datos Abiertos
            </div>
            <div className="db-status-badge">
              <span className="live-dot" />
              <span>SQLite v3 Activa · {formatNumber(data.totals.records)} registros</span>
            </div>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="action-btn secondary"
              onClick={handleExportCSV}
              title="Descargar matriz en CSV"
            >
              <Download size={14} /> Exportar CSV
            </button>
            <a
              href={data.meta.source_url}
              target="_blank"
              rel="noreferrer"
              className="action-btn primary"
            >
              Portal Oficial <ExternalLink size={13} />
            </a>
          </div>
        </div>

        <div className="header-headline">
          <div>
            <h1>Observatorio Institucional de Acceso, Permanencia y Bienestar</h1>
            <p>
              Sistema de inteligencia de datos universitarios basado en SQLite para monitorear
              postulantes, ingresantes, comedor universitario, egreso, bachillerato y corredores
              territoriales de la Universidad Nacional del Centro del Perú.
            </p>
          </div>
        </div>

        {/* Barra de Filtros Globales */}
        <section className="global-filters" aria-label="Filtros del observatorio">
          <div className="filter-item">
            <label htmlFor="period-select">
              <Filter size={14} /> Semestre / Periodo
            </label>
            <select
              id="period-select"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="ALL">Todos los semestres</option>
              {data.periods.map((item) => (
                <option value={item} key={item}>
                  Periodo {item}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-item">
            <label htmlFor="school-select">
              <School size={14} /> Escuela Profesional
            </label>
            <select
              id="school-select"
              value={school}
              onChange={(e) => setSchool(e.target.value)}
            >
              <option value="ALL">Todas las carreras ({data.schools.length})</option>
              {data.schools.map((item) => (
                <option value={item.key} key={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-item">
            <label htmlFor="sex-select">
              <Users size={14} /> Sexo Publicado
            </label>
            <select
              id="sex-select"
              value={sex}
              onChange={(e) => setSex(e.target.value)}
            >
              <option value="ALL">Todos</option>
              {data.sex_summary.map((item) => (
                <option value={item.key} key={item.key}>
                  {item.sex}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-item search-item">
            <label htmlFor="search-input">
              <Search size={14} /> Búsqueda libre
            </label>
            <div className="search-box">
              <input
                id="search-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ej. Medicina, Sistemas, Tarma, El Tambo..."
              />
              {query && (
                <button
                  type="button"
                  className="clear-search"
                  onClick={() => setQuery('')}
                  title="Limpiar búsqueda"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {isFiltered && (
            <div className="filter-reset-wrap">
              <button
                type="button"
                className="reset-filters-btn"
                onClick={handleResetFilters}
                title="Restablecer todos los filtros"
              >
                <RotateCcw size={13} /> Limpiar
              </button>
            </div>
          )}
        </section>

        {/* Barra de Rutas / Pestañas del Panel */}
        <nav className="tab-nav" aria-label="Navegación del panel">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                className={`tab-btn ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
                {tab.id === 'gis' && (
                  <span className="tab-pill-badge">{gisFilteredFeatures.length} distritos</span>
                )}
                {tab.id === 'admission' && (
                  <span className="tab-pill-badge">{filteredSchoolRows.length} carreras</span>
                )}
              </button>
            )
          })}
        </nav>
      </header>

      {/* Cuerpo Principal del Panel */}
      <main className="app-content">
        {/* Siempre visibles: KPIs ejecutivos */}
        <section className="kpi-grid">
          {kpis.map((item) => (
            <KpiCard key={item.label} {...item} />
          ))}
        </section>

        {/* RUTA 1: VISIÓN GLOBAL */}
        {activeTab === 'overview' && (
          <div className="tab-view fade-in">
            <div className="grid-2-cols">
              <Panel
                title="Embudo Histórico de Estudiantes"
                hint="Secuencia longitudinal por periodo: Postulantes admitidos, ingresantes, egreso y bachilleres."
              >
                <FunnelChart rows={funnelRows} />
              </Panel>

              <Panel
                title="Alertas Críticas y Señales Tempranas"
                hint="Detección algorítmica de carreras con alta demanda insatisfecha, brecha de admisión o baja cobertura de comedor."
              >
                <div className="alert-list">
                  {alertRows.length ? (
                    alertRows.map((alert) => (
                      <article
                        className="alert-item"
                        key={`${alert.type}-${alert.title}-${alert.metric}`}
                      >
                        <div className="alert-title">
                          <AlertTriangle size={18} />
                          <strong>{alert.title}</strong>
                          <AlertBadge severity={alert.severity} />
                        </div>
                        <p>
                          {alert.type} · {alert.metric}
                        </p>
                        <span>{alert.detail}</span>
                      </article>
                    ))
                  ) : (
                    <Empty>No hay alertas detectadas para los filtros actuales.</Empty>
                  )}
                </div>
              </Panel>
            </div>

            <div className="grid-3-cols mt-4">
              <Panel
                title="Top Carreras con Mayor Brecha"
                hint="Índice de presión: demanda alta vs vacantes limitadas y necesidad de soporte."
              >
                <HorizontalBars
                  rows={filteredSchoolRows.slice(0, 10).map((row) => ({
                    ...row,
                    label: shorten(row.school, 30),
                    fullLabel: row.school,
                  }))}
                  valueKey="gap_score"
                  color={COLORS.cepre}
                  valueLabel={(value, row) =>
                    `${Number(value).toFixed(1)} score · ${formatPct(row.conversion)} ing.`
                  }
                />
              </Panel>

              <Panel
                title="Procedencia Geográfica Destacada"
                hint="Distritos con mayor volumen de estudiantes registrados."
                action={
                  <button
                    type="button"
                    className="link-action-btn"
                    onClick={() => setActiveTab('gis')}
                  >
                    Ver mapa completo →
                  </button>
                }
              >
                <HorizontalBars
                  rows={geoRows.slice(0, 10).map((row) => ({
                    ...row,
                    label: `${row.district} (${row.province})`,
                    fullLabel: `${row.district} · ${row.province} · ${row.department}`,
                  }))}
                  valueKey="value"
                  color={COLORS.postulantes}
                />
              </Panel>

              <Panel
                title="Distribución Demográfica por Sexo"
                hint="Cálculo sobre registros con campo de sexo oficial."
              >
                <SexDistribution rows={sexRows} />
              </Panel>
            </div>
          </div>
        )}

        {/* RUTA 2: ADMISIÓN Y SELECTIVIDAD */}
        {activeTab === 'admission' && (
          <div className="tab-view fade-in">
            <div className="grid-2-cols">
              <Panel
                title="Carreras con Mayor Demanda Absoluta (Postulantes)"
                hint="Volumen total de personas que postulan a cada programa de estudios."
              >
                <HorizontalBars
                  rows={[...filteredSchoolRows]
                    .sort((a, b) => b.postulantes - a.postulantes)
                    .slice(0, 14)
                    .map((row) => ({
                      ...row,
                      label: shorten(row.school, 32),
                      fullLabel: row.school,
                    }))}
                  valueKey="postulantes"
                  color={COLORS.postulantes}
                />
              </Panel>

              <Panel
                title="Índice de Selectividad (% de Ingreso)"
                hint="Carreras con menor tasa de admisión (mayor competencia por vacante)."
              >
                <HorizontalBars
                  rows={[...filteredSchoolRows]
                    .filter((r) => r.postulantes >= 100)
                    .sort((a, b) => a.conversion - b.conversion)
                    .slice(0, 14)
                    .map((row) => ({
                      ...row,
                      label: shorten(row.school, 32),
                      fullLabel: row.school,
                    }))}
                  valueKey="conversion"
                  color={COLORS.ingresantes}
                  valueLabel={(val, row) =>
                    `${formatPct(val)} (${formatNumber(row.ingresantes)} / ${formatNumber(row.postulantes)})`
                  }
                />
              </Panel>
            </div>

            <div className="mt-4">
              <Panel
                title="Comparativo de Admisión por Escuela"
                hint="Relación directa entre postulantes e ingresantes efectivos."
              >
                <div className="school-cards-grid">
                  {filteredSchoolRows.slice(0, 12).map((item) => (
                    <article className="mini-stat-card" key={item.school_key}>
                      <h4>{item.school}</h4>
                      <div className="stat-ratios">
                        <div className="ratio-item">
                          <span className="ratio-lbl">Postulantes</span>
                          <strong className="ratio-val text-blue">
                            {formatNumber(item.postulantes)}
                          </strong>
                        </div>
                        <div className="ratio-item">
                          <span className="ratio-lbl">Ingresantes</span>
                          <strong className="ratio-val text-teal">
                            {formatNumber(item.ingresantes)}
                          </strong>
                        </div>
                        <div className="ratio-item">
                          <span className="ratio-lbl">Conversión</span>
                          <strong className="ratio-val text-purple">
                            {formatPct(item.conversion)}
                          </strong>
                        </div>
                      </div>
                      <div className="progress-bar-wrap">
                        <div
                          className="progress-bar-fill"
                          style={{
                            width: `${Math.min(100, Math.max(2, item.conversion))}%`,
                          }}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        )}

        {/* RUTA 3: PERMANENCIA Y BIENESTAR */}
        {activeTab === 'welfare' && (
          <div className="tab-view fade-in">
            <div className="grid-2-cols">
              <Panel
                title="Beneficiarios del Comedor Universitario por Carrera"
                hint="Programas con mayor cantidad absoluta de raciones asignadas."
              >
                <HorizontalBars
                  rows={[...filteredSchoolRows]
                    .sort((a, b) => b.comedor - a.comedor)
                    .slice(0, 14)
                    .map((row) => ({
                      ...row,
                      label: shorten(row.school, 32),
                      fullLabel: row.school,
                    }))}
                  valueKey="comedor"
                  color={COLORS.comedor}
                />
              </Panel>

              <Panel
                title="Tasa de Cobertura Social (Comedor vs Ingreso)"
                hint="Proporción de becarios de comedor en relación con el volumen de ingresantes."
              >
                <HorizontalBars
                  rows={[...filteredSchoolRows]
                    .filter((r) => r.ingresantes > 20)
                    .sort((a, b) => b.support_rate - a.support_rate)
                    .slice(0, 14)
                    .map((row) => ({
                      ...row,
                      label: shorten(row.school, 32),
                      fullLabel: row.school,
                    }))}
                  valueKey="support_rate"
                  color="#16a34a"
                  valueLabel={(val, row) =>
                    `${formatPct(val)} (${formatNumber(row.comedor)} becarios)`
                  }
                />
              </Panel>
            </div>

            <div className="grid-2-cols mt-4">
              <Panel
                title="Egresados Consolidados por Carrera"
                hint="Programas con mayor número de egresados registrados en datos abiertos."
              >
                <HorizontalBars
                  rows={[...filteredSchoolRows]
                    .sort((a, b) => b.egresados - a.egresados)
                    .slice(0, 12)
                    .map((row) => ({
                      ...row,
                      label: shorten(row.school, 32),
                      fullLabel: row.school,
                    }))}
                  valueKey="egresados"
                  color={COLORS.egresados}
                />
              </Panel>

              <Panel
                title="Obtención del Grado de Bachiller"
                hint="Bachilleres oficiales emitidos según la escuela académica."
              >
                <HorizontalBars
                  rows={[...filteredSchoolRows]
                    .sort((a, b) => b.bachiller - a.bachiller)
                    .slice(0, 12)
                    .map((row) => ({
                      ...row,
                      label: shorten(row.school, 32),
                      fullLabel: row.school,
                    }))}
                  valueKey="bachiller"
                  color={COLORS.bachiller}
                />
              </Panel>
            </div>
          </div>
        )}

        {/* RUTA 4: TERRITORIO Y RUTAS GIS (AMPLIADO Y ESPACIOSO) */}
        {activeTab === 'gis' && (
          <div className="tab-view fade-in gis-tab-view">
            {/* Controles de Navegación GIS */}
            <div className="gis-controls-card">
              <div className="gis-controls-left">
                <div className="control-group">
                  <span className="control-label">
                    <MapIcon size={14} /> Departamento / Ámbito
                  </span>
                  <div className="pills-container">
                    <button
                      type="button"
                      className={`pill-btn ${geoDepartment === 'Junin' ? 'active' : ''}`}
                      onClick={() => {
                        setGeoDepartment('Junin')
                        setGeoProvince('ALL')
                      }}
                    >
                      Junín (Región Central)
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${geoDepartment === 'ALL' ? 'active' : ''}`}
                      onClick={() => {
                        setGeoDepartment('ALL')
                        setGeoProvince('ALL')
                      }}
                    >
                      Todo el Perú
                    </button>
                    {['Huancavelica', 'Pasco', 'Lima'].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`pill-btn ${geoDepartment === d ? 'active' : ''}`}
                        onClick={() => {
                          setGeoDepartment(d)
                          setGeoProvince('ALL')
                        }}
                      >
                        {d}
                      </button>
                    ))}
                    <select
                      className="gis-select"
                      value={geoDepartment}
                      onChange={(e) => {
                        setGeoDepartment(e.target.value)
                        setGeoProvince('ALL')
                      }}
                      title="Seleccionar departamento del Perú"
                    >
                      <option value="ALL">Otros dptos...</option>
                      {availableDepartments
                        .filter((d) => !['Junin', 'Huancavelica', 'Pasco', 'Lima'].includes(d))
                        .map((d) => (
                          <option value={d} key={d}>
                            {d}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="control-group">
                  <span className="control-label">Provincia</span>
                  <select
                    className="gis-select"
                    value={geoProvince}
                    onChange={(e) => setGeoProvince(e.target.value)}
                  >
                    <option value="ALL">Todas las provincias ({availableProvinces.length})</option>
                    {availableProvinces.map((p) => (
                      <option value={p} key={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="gis-controls-right">
                <div className="control-group">
                  <span className="control-label">Métrica Visualizada</span>
                  <div className="segmented">
                    {GEO_MODES.map((mode) => (
                      <button
                        key={mode.key}
                        type="button"
                        className={geoMode === mode.key ? 'active' : ''}
                        onClick={() => setGeoMode(mode.key)}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="control-group">
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={showRoutes}
                      onChange={(e) => setShowRoutes(e.target.checked)}
                    />
                    <span>
                      <Compass size={14} /> Corredores de origen hacia UNCP
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Layout Principal GIS: Mapa Extendido + Panel de Información */}
            <div className="gis-workspace-grid">
              {/* Contenedor del Mapa SVG Ampliado */}
              <div className="gis-map-container">
                <div className="map-toolbar">
                  <div className="map-status">
                    <strong>
                      {geoDepartment === 'ALL' ? 'Mapa Nacional del Perú' : `Región ${geoDepartment}`}
                    </strong>
                    {geoProvince !== 'ALL' && <span> · Provincia de {geoProvince}</span>}
                    <span> · {gisFilteredFeatures.length} distritos georreferenciados</span>
                  </div>

                  <div className="map-legend">
                    <span className="legend-label">Menor flujo</span>
                    <div
                      className="legend-gradient"
                      style={{
                        background: `linear-gradient(to right, #dbeafe, ${activeMetricObj.color})`,
                      }}
                    />
                    <span className="legend-label">Mayor flujo ({formatNumber(maxGeoValue)})</span>
                  </div>
                </div>

                <div className="svg-map-wrapper">
                  <svg
                    className="expanded-gis-svg"
                    viewBox={`0 0 ${mapSvgWidth} ${mapSvgHeight}`}
                    role="img"
                    aria-label="Mapa Geográfico y Corredores de Origen UNCP"
                  >
                    <defs>
                      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                      </filter>
                      <marker
                        id="arrow"
                        viewBox="0 0 10 10"
                        refX="5"
                        refY="5"
                        markerWidth="4"
                        markerHeight="4"
                        orient="auto-start-reverse"
                      >
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#ea580c" />
                      </marker>
                    </defs>

                    {/* Fondo del mapa */}
                    <rect
                      width={mapSvgWidth}
                      height={mapSvgHeight}
                      rx="12"
                      fill="#f8fafc"
                      stroke="#e2e8f0"
                    />

                    {/* Grilla sutil de referencia */}
                    <g opacity="0.4">
                      {[1, 2, 3, 4].map((i) => (
                        <line
                          key={`gx-${i}`}
                          x1={(mapSvgWidth / 5) * i}
                          y1="0"
                          x2={(mapSvgWidth / 5) * i}
                          y2={mapSvgHeight}
                          stroke="#cbd5e1"
                          strokeDasharray="4 4"
                          strokeWidth="0.5"
                        />
                      ))}
                      {[1, 2, 3].map((i) => (
                        <line
                          key={`gy-${i}`}
                          x1="0"
                          y1={(mapSvgHeight / 4) * i}
                          x2={mapSvgWidth}
                          y2={(mapSvgHeight / 4) * i}
                          stroke="#cbd5e1"
                          strokeDasharray="4 4"
                          strokeWidth="0.5"
                        />
                      ))}
                    </g>

                    {/* Polígonos distritales */}
                    <g className="districts-layer">
                      {gisFilteredFeatures.map((feature) => {
                        const isSelected = selectedFeature?.id === feature.id
                        const pathD = geometryToPath(
                          feature.geometry,
                          activeBounds,
                          mapSvgWidth,
                          mapSvgHeight,
                        )
                        if (!pathD) return null

                        return (
                          <path
                            key={feature.id}
                            d={pathD}
                            fill={colorForValue(feature.value, maxGeoValue, activeMetricObj.color)}
                            stroke={isSelected ? '#0f172a' : '#ffffff'}
                            strokeWidth={isSelected ? '2' : '0.75'}
                            className={`district-path ${isSelected ? 'selected' : ''}`}
                            onClick={() => setSelectedFeature(feature)}
                            onMouseEnter={() => {
                              if (!selectedFeature) setSelectedFeature(feature)
                            }}
                          >
                            <title>
                              {feature.name}, {feature.province} ({feature.department}):{' '}
                              {formatNumber(feature.value)} {activeMetricObj.label}
                            </title>
                          </path>
                        )
                      })}
                    </g>

                    {/* Corredores de Afluencia / Rutas hacia UNCP */}
                    {showRoutes && uncpCampusPoint && (
                      <g className="corridors-layer">
                        {corridorRoutes.map((route) => {
                          const [x1, y1] = projectPoint(
                            route.origin,
                            activeBounds,
                            mapSvgWidth,
                            mapSvgHeight,
                          )
                          const [x2, y2] = projectPoint(
                            route.destination,
                            activeBounds,
                            mapSvgWidth,
                            mapSvgHeight,
                          )

                          // Curva cuadrática elegante
                          const cx = (x1 + x2) / 2
                          const cy = (y1 + y2) / 2
                          const dx = x2 - x1
                          const dy = y2 - y1
                          const qx = cx - dy * 0.18
                          const qy = cy + dx * 0.18

                          const strokeW = Math.max(1, Math.min(3.5, (route.value / maxGeoValue) * 4))

                          return (
                            <g key={`corridor-${route.id}`}>
                              <path
                                d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
                                fill="none"
                                stroke="#ea580c"
                                strokeWidth={strokeW}
                                strokeDasharray="5 3"
                                opacity="0.8"
                                className="flow-path"
                              />
                              <circle
                                cx={x1}
                                cy={y1}
                                r="3.5"
                                fill="#ea580c"
                                stroke="#ffffff"
                                strokeWidth="1"
                              />
                            </g>
                          )
                        })}

                        {/* Pin distintivo del Campus Central UNCP en El Tambo */}
                        {(() => {
                          const [cx, cy] = projectPoint(
                            uncpCampusPoint,
                            activeBounds,
                            mapSvgWidth,
                            mapSvgHeight,
                          )
                          return (
                            <g className="campus-pin" transform={`translate(${cx}, ${cy})`}>
                              <circle r="12" fill="#0f766e" opacity="0.2" className="pulse-ring" />
                              <circle r="6" fill="#0f766e" stroke="#ffffff" strokeWidth="2" />
                              <text
                                x="10"
                                y="4"
                                fontSize="12"
                                fontWeight="800"
                                fill="#0f172a"
                                className="campus-label"
                              >
                                Sede Central UNCP
                              </text>
                            </g>
                          )
                        })()}
                      </g>
                    )}
                  </svg>
                </div>
              </div>

              {/* Panel Lateral de Detalle Distrital y Ranking */}
              <div className="gis-sidebar">
                {/* Tarjeta de Ficha Técnica del Distrito Seleccionado */}
                <div className="district-detail-card">
                  <div className="detail-header">
                    <span className="detail-tag">Ficha de Información Territorial</span>
                    <h3>{selectedFeature ? selectedFeature.name : 'Distrito de El Tambo'}</h3>
                    <p className="detail-sub">
                      {selectedFeature
                        ? `${selectedFeature.province} · ${selectedFeature.department}`
                        : 'Huancayo · Junín (Sede UNCP)'}
                    </p>
                  </div>

                  {(() => {
                    const feat =
                      selectedFeature ||
                      gisFilteredFeatures.find((f) => f.name === 'El Tambo') ||
                      gisFilteredFeatures[0]
                    if (!feat) return <Empty>Selecciona un distrito en el mapa.</Empty>
                    const m = feat.computedMetrics || feat.metrics || {}

                    return (
                      <div className="detail-stats-grid">
                        <div className="stat-pill-item">
                          <span className="stat-pill-label">Postulantes</span>
                          <strong className="stat-pill-val text-blue">
                            {formatNumber(m.postulantes)}
                          </strong>
                        </div>
                        <div className="stat-pill-item">
                          <span className="stat-pill-label">Ingresantes</span>
                          <strong className="stat-pill-val text-teal">
                            {formatNumber(m.ingresantes)}
                          </strong>
                        </div>
                        <div className="stat-pill-item">
                          <span className="stat-pill-label">Tasa Conversión</span>
                          <strong className="stat-pill-val text-purple">
                            {formatPct(m.conversion)}
                          </strong>
                        </div>
                        <div className="stat-pill-item">
                          <span className="stat-pill-label">Comedor Univ.</span>
                          <strong className="stat-pill-val text-green">
                            {formatNumber(m.comedor)}
                          </strong>
                        </div>
                        <div className="stat-pill-item">
                          <span className="stat-pill-label">CEPRE UNCP</span>
                          <strong className="stat-pill-val text-amber">
                            {formatNumber(m.cepre)}
                          </strong>
                        </div>
                        <div className="stat-pill-item">
                          <span className="stat-pill-label">Egresados</span>
                          <strong className="stat-pill-val">
                            {formatNumber(m.egresados)}
                          </strong>
                        </div>
                      </div>
                    )
                  })()}
                </div>

                {/* Ranking de Distritos con mayor flujo */}
                <div className="gis-ranking-box">
                  <div className="ranking-header">
                    <h4>Top Distritos por {activeMetricObj.label}</h4>
                    <span>{gisFilteredFeatures.length} activos</span>
                  </div>

                  <div className="ranking-scroll-list">
                    {gisFilteredFeatures.slice(0, 18).map((f, idx) => {
                      const isSelected = selectedFeature?.id === f.id
                      const pctOfMax = (f.value / maxGeoValue) * 100

                      return (
                        <div
                          key={f.id}
                          className={`ranking-row-item ${isSelected ? 'active' : ''}`}
                          onClick={() => setSelectedFeature(f)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              setSelectedFeature(f)
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="row-rank-num">#{idx + 1}</div>
                          <div className="row-content">
                            <div className="row-text">
                              <span className="district-name">{f.name}</span>
                              <span className="province-name">{f.province}</span>
                            </div>
                            <div className="mini-track">
                              <div
                                className="mini-fill"
                                style={{
                                  width: `${Math.max(3, pctOfMax)}%`,
                                  background: activeMetricObj.color,
                                }}
                              />
                            </div>
                          </div>
                          <div className="row-value">{formatNumber(f.value)}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RUTA 5: EXPLORADOR DE CARRERAS Y MATRIZ ACCIONABLE */}
        {activeTab === 'explorer' && (
          <div className="tab-view fade-in">
            <Panel
              title="Matriz de Carreras Profesionales"
              hint="Datos consolidados y métricas integradas para toma de decisiones y priorización institucional."
              action={
                <button
                  type="button"
                  className="action-btn secondary"
                  onClick={handleExportCSV}
                >
                  <Download size={14} /> Exportar Selección ({sortedTableRows.length})
                </button>
              }
            >
              <div className="table-search-bar">
                <span>
                  Mostrando <strong>{sortedTableRows.length}</strong> programas académicos
                </span>
                <span className="table-hint">Haz clic en los encabezados para ordenar</span>
              </div>

              <div className="table-wrap">
                <table className="interactive-table">
                  <thead>
                    <tr>
                      <th
                        onClick={() => {
                          setTableSortKey('school')
                          setTableSortAsc(!tableSortAsc)
                        }}
                        className="sortable"
                      >
                        Carrera / Escuela {tableSortKey === 'school' && (tableSortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="num sortable"
                        onClick={() => {
                          setTableSortKey('postulantes')
                          setTableSortAsc(!tableSortAsc)
                        }}
                      >
                        Postulantes{' '}
                        {tableSortKey === 'postulantes' && (tableSortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="num sortable"
                        onClick={() => {
                          setTableSortKey('ingresantes')
                          setTableSortAsc(!tableSortAsc)
                        }}
                      >
                        Ingresantes{' '}
                        {tableSortKey === 'ingresantes' && (tableSortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="num sortable"
                        onClick={() => {
                          setTableSortKey('conversion')
                          setTableSortAsc(!tableSortAsc)
                        }}
                      >
                        Conversión{' '}
                        {tableSortKey === 'conversion' && (tableSortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="num sortable"
                        onClick={() => {
                          setTableSortKey('comedor')
                          setTableSortAsc(!tableSortAsc)
                        }}
                      >
                        Comedor {tableSortKey === 'comedor' && (tableSortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="num sortable"
                        onClick={() => {
                          setTableSortKey('egresados')
                          setTableSortAsc(!tableSortAsc)
                        }}
                      >
                        Egresados {tableSortKey === 'egresados' && (tableSortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="num sortable"
                        onClick={() => {
                          setTableSortKey('bachiller')
                          setTableSortAsc(!tableSortAsc)
                        }}
                      >
                        Bachilleres{' '}
                        {tableSortKey === 'bachiller' && (tableSortAsc ? '▲' : '▼')}
                      </th>
                      <th
                        className="sortable"
                        onClick={() => {
                          setTableSortKey('gap_score')
                          setTableSortAsc(!tableSortAsc)
                        }}
                      >
                        Prioridad {tableSortKey === 'gap_score' && (tableSortAsc ? '▲' : '▼')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTableRows.length ? (
                      sortedTableRows.map((row) => (
                        <tr key={`${row.school_key}-${row.period || 'all'}`}>
                          <td className="school-cell">
                            <strong>{row.school}</strong>
                            {row.period && <span className="cell-sub">{row.period}</span>}
                          </td>
                          <td className="num font-semibold">
                            {formatNumber(row.postulantes)}
                          </td>
                          <td className="num text-teal">
                            {formatNumber(row.ingresantes)}
                          </td>
                          <td className="num">
                            <span className="pct-badge">{formatPct(row.conversion)}</span>
                          </td>
                          <td className="num text-green">
                            {formatNumber(row.comedor)}
                          </td>
                          <td className="num text-amber">
                            {formatNumber(row.egresados)}
                          </td>
                          <td className="num text-purple">
                            {formatNumber(row.bachiller)}
                          </td>
                          <td>
                            <PriorityBadge score={row.gap_score || 0} />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="8" className="empty-cell">
                          No se encontraron programas académicos con los filtros activos.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        )}
      </main>
    </div>
  )
}
