import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  Award,
  BarChart3,
  Briefcase,
  CheckCircle2,
  Compass,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  Flame,
  GraduationCap,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Map as MapIcon,
  MapPinned,
  Moon,
  RotateCcw,
  Scale,
  School,
  Search,
  SlidersHorizontal,
  Stethoscope,
  Sun,
  Table,
  Target,
  TrendingUp,
  Users,
  Maximize2,
  Move,
  ZoomIn,
  ZoomOut,
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

function KpiCard({ icon: Icon, label, value, note, color = 'cyan', trend = '+12.4%' }) {
  return (
    <article className={`kpi-card accent-${color}`}>
      <div className="kpi-header-row">
        <div className="kpi-icon" aria-hidden="true">
          <Icon size={18} />
        </div>
        {trend && (
          <div className="kpi-trend">
            <TrendingUp size={14} className="trend-arrow" />
            <span>{trend}</span>
          </div>
        )}
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

function HorizontalBars({ rows, valueKey, color, valueLabel = formatNumber }) {
  const max = Math.max(1, ...rows.map((row) => Number(row[valueKey] || 0)))
  if (!rows.length) return <Empty />

  return (
    <div className="bar-list">
      {rows.map((row, idx) => {
        const value = Number(row[valueKey] || 0)
        return (
          <div className="bar-line" key={`${row.school_key || row.key || row.label}-${valueKey}-${idx}`}>
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



/* Hook reutilizable para Zoom y Pan interactivo en mapas SVG */
function useSvgZoomPan({ minZoom = 0.7, maxZoom = 7, initialZoom = 1 } = {}) {
  const [zoom, setZoom] = useState(initialZoom)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0, moved: false })
  const containerRef = useRef(null)

  const handleZoomIn = () => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    setZoom((prevZoom) => {
      const nextZoom = Math.min(maxZoom, Number((prevZoom * 1.35).toFixed(2)))
      const ratio = nextZoom / prevZoom
      setPan((prevPan) => ({
        x: cx - (cx - prevPan.x) * ratio,
        y: cy - (cy - prevPan.y) * ratio,
      }))
      return nextZoom
    })
  }

  const handleZoomOut = () => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    setZoom((prevZoom) => {
      const nextZoom = Math.max(minZoom, Number((prevZoom / 1.35).toFixed(2)))
      const ratio = nextZoom / prevZoom
      setPan((prevPan) => ({
        x: cx - (cx - prevPan.x) * ratio,
        y: cy - (cy - prevPan.y) * ratio,
      }))
      return nextZoom
    })
  }

  const handleReset = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleWheel = (e) => {
    e.preventDefault()
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cursorX = e.clientX - rect.left
    const cursorY = e.clientY - rect.top

    const factor = e.deltaY < 0 ? 1.18 : 0.85
    setZoom((prevZoom) => {
      const nextZoom = Math.min(maxZoom, Math.max(minZoom, Number((prevZoom * factor).toFixed(2))))
      if (nextZoom === prevZoom) return prevZoom
      const scaleRatio = nextZoom / prevZoom
      setPan((prevPan) => ({
        x: cursorX - (cursorX - prevPan.x) * scaleRatio,
        y: cursorY - (cursorY - prevPan.y) * scaleRatio,
      }))
      return nextZoom
    })
  }

  const handleMouseDown = (e) => {
    if (e.button !== 0) return
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    }
  }

  const handleMouseMove = (e) => {
    if (!isDragging) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    if (Math.hypot(dx, dy) > 4) {
      dragStartRef.current.moved = true
    }
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleDoubleClick = (e) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cursorX = e.clientX - rect.left
    const cursorY = e.clientY - rect.top
    setZoom((prevZoom) => {
      const nextZoom = Math.min(maxZoom, Number((prevZoom * 1.5).toFixed(2)))
      const scaleRatio = nextZoom / prevZoom
      setPan((prevPan) => ({
        x: cursorX - (cursorX - prevPan.x) * scaleRatio,
        y: cursorY - (cursorY - prevPan.y) * scaleRatio,
      }))
      return nextZoom
    })
  }

  // Soporte táctil móvil y tablet
  const touchStartRef = useRef({ x: 0, y: 0, dist: 0, panX: 0, panY: 0, zoom: 1 })

  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0]
      touchStartRef.current = {
        x: t.clientX,
        y: t.clientY,
        panX: pan.x,
        panY: pan.y,
        dist: 0,
        zoom,
      }
      setIsDragging(true)
    } else if (e.touches.length === 2) {
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
      touchStartRef.current = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
        panX: pan.x,
        panY: pan.y,
        dist,
        zoom,
      }
    }
  }

  const handleTouchMove = (e) => {
    if (e.touches.length === 1 && isDragging) {
      const t = e.touches[0]
      const dx = t.clientX - touchStartRef.current.x
      const dy = t.clientY - touchStartRef.current.y
      if (Math.hypot(dx, dy) > 4) {
        dragStartRef.current.moved = true
      }
      setPan({
        x: touchStartRef.current.panX + dx,
        y: touchStartRef.current.panY + dy,
      })
    } else if (e.touches.length === 2 && touchStartRef.current.dist > 0) {
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const newDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
      const factor = newDist / touchStartRef.current.dist
      const nextZoom = Math.min(maxZoom, Math.max(minZoom, touchStartRef.current.zoom * factor))
      setZoom(Number(nextZoom.toFixed(2)))
    }
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
  }

  return {
    zoom,
    pan,
    isDragging,
    hasMoved: () => dragStartRef.current.moved,
    containerRef,
    handleZoomIn,
    handleZoomOut,
    handleReset,
    eventHandlers: {
      onWheel: handleWheel,
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
      onDoubleClick: handleDoubleClick,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  }
}

function OverviewGisMap({
  features,
  bounds,
  metricObj,
  routes,
  onSelectFeature,
  selectedFeature,
  onOpenGisTab,
}) {
  const width = 680
  const height = 460
  const maxVal = Math.max(1, ...features.map((f) => f.value))

  const {
    zoom,
    pan,
    isDragging,
    hasMoved,
    containerRef,
    handleZoomIn,
    handleZoomOut,
    handleReset,
    eventHandlers,
  } = useSvgZoomPan({ minZoom: 0.75, maxZoom: 6 })

  return (
    <div className="overview-gis-container">
      <div className="gis-card-header">
        <div className="gis-header-left">
          <div className="gis-card-title">
            <MapPinned size={16} className="text-cyan-400" />
            <span>Territorio & Rutas GIS</span>
          </div>
          <span className="gis-tag">Cobertura Distrital Perú · Heatmap</span>
        </div>
        <button type="button" className="btn-map-expand" onClick={onOpenGisTab}>
          Ver GIS Completo <ArrowUpRight size={13} />
        </button>
      </div>

      <div
        className={`map-viewport-wrapper ${isDragging ? 'is-panning' : ''}`}
        ref={containerRef}
        {...eventHandlers}
      >
        {/* Controles flotantes de Zoom y Pan */}
        <div className="map-zoom-controls">
          <button
            type="button"
            className="map-control-btn"
            onClick={handleZoomIn}
            title="Acercar mapa (Rueda arriba o clic)"
            aria-label="Acercar mapa"
          >
            <ZoomIn size={15} />
          </button>
          <span className="map-zoom-badge" title="Nivel de zoom actual">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="map-control-btn"
            onClick={handleZoomOut}
            title="Alejar mapa (Rueda abajo o clic)"
            aria-label="Alejar mapa"
          >
            <ZoomOut size={15} />
          </button>
          <button
            type="button"
            className="map-control-btn reset-btn"
            onClick={handleReset}
            title="Restablecer encuadre original (100%)"
            aria-label="Restablecer zoom"
          >
            <Maximize2 size={13} />
          </button>
        </div>

        <div className="map-interaction-tooltip">
          <Move size={12} />
          <span>Arrastra para mover · Rueda para zoom</span>
        </div>

        {/* Heatmap Overlay Callout - Highlighting El Tambo, Huancayo */}
        <div className="heatmap-overlay-callout">
          <span className="beacon-pulse" />
          <div className="callout-info">
            <div className="callout-place">El Tambo, Huancayo</div>
            <div className="callout-metric">9,717 estudiantes</div>
          </div>
        </div>

        <svg
          className="overview-map-svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Mapa Geográfico 3D de Afluencia UNCP"
        >
          <defs>
            <radialGradient id="elTamboHeat" cx="48%" cy="56%" r="24%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.85" />
              <stop offset="35%" stopColor="#f43f5e" stopOpacity="0.55" />
              <stop offset="70%" stopColor="#06b6d4" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
            </radialGradient>
            <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <linearGradient id="networkLineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.9" />
            </linearGradient>
          </defs>

          {/* Canvas Dark Gradient Background */}
          <rect width={width} height={height} rx="10" fill="#071220" />
          <g
            className="map-zoomable-layer"
            transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}
            style={{
              transformOrigin: '0 0',
              transition: isDragging ? 'none' : 'transform 0.12s ease-out',
            }}
          >

          {/* Reference Grid lines */}
          <g opacity="0.15">
            {[1, 2, 3, 4, 5].map((i) => (
              <line
                key={`cgx-${i}`}
                x1={(width / 6) * i}
                y1="0"
                x2={(width / 6) * i}
                y2={height}
                stroke="#38bdf8"
                strokeDasharray="3 3"
                strokeWidth="0.5"
              />
            ))}
            {[1, 2, 3, 4].map((i) => (
              <line
                key={`cgy-${i}`}
                x1="0"
                y1={(height / 5) * i}
                x2={width}
                y2={(height / 5) * i}
                stroke="#38bdf8"
                strokeDasharray="3 3"
                strokeWidth="0.5"
              />
            ))}
          </g>

          {/* Heatmap ambient glow */}
          <circle cx={width * 0.48} cy={height * 0.58} r={105} fill="url(#elTamboHeat)" />

          {/* District Polygons */}
          <g className="districts-layer">
            {features.map((feature) => {
              const pathD = geometryToPath(feature.geometry, bounds, width, height)
              if (!pathD) return null
              const isSelected = selectedFeature?.id === feature.id
              const isTambo = feature.name === 'El Tambo'
              return (
                <path
                  key={feature.id}
                  d={pathD}
                  fill={
                    isTambo
                      ? '#f59e0b'
                      : colorForValue(feature.value, maxVal, metricObj.color)
                  }
                  stroke={isSelected ? '#38bdf8' : isTambo ? '#fbbf24' : 'rgba(255, 255, 255, 0.14)'}
                  strokeWidth={isTambo ? '1.8' : isSelected ? '1.5' : '0.5'}
                  className="dist-polygon"
                  onClick={() => { if (!hasMoved()) onSelectFeature(feature) }}
                >
                  <title>
                    {feature.name}, {feature.province}: {formatNumber(feature.value)} {metricObj.label}
                  </title>
                </path>
              )
            })}
          </g>

          {/* Network Connection Lines (Glowing Arcs) */}
          <g className="network-arcs" filter="url(#neonGlow)">
            {routes.slice(0, 10).map((r) => {
              const [x1, y1] = projectPoint(r.origin, bounds, width, height)
              const [x2, y2] = projectPoint(r.destination, bounds, width, height)
              const mx = (x1 + x2) / 2
              const my = Math.min(y1, y2) - 18
              return (
                <path
                  key={`arc-${r.id}`}
                  d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
                  fill="none"
                  stroke="url(#networkLineGrad)"
                  strokeWidth="1.2"
                  strokeDasharray="4 2"
                  className="pulsing-network-line"
                  opacity="0.85"
                />
              )
            })}
          </g>

          {/* Floating Location Pins */}
          <g className="location-pins">
            {[
              { name: 'El Tambo', coords: [-75.22, -12.04], highlight: true, count: '9,717' },
              { name: 'Huancayo', coords: [-75.21, -12.07], count: '6,420' },
              { name: 'Chilca', coords: [-75.20, -12.09], count: '4,100' },
              { name: 'Chupaca', coords: [-75.29, -12.06], count: '950' },
              { name: 'Jauja', coords: [-75.50, -11.77], count: '820' },
              { name: 'Tarma', coords: [-75.69, -11.42], count: '610' },
              { name: 'Satipo', coords: [-74.63, -11.25], count: '540' },
            ].map((pin) => {
              const [px, py] = projectPoint(pin.coords, bounds, width, height)
              return (
                <g key={pin.name} className="pin-group">
                  <circle
                    cx={px}
                    cy={py}
                    r={pin.highlight ? 5.5 : 3.5}
                    fill={pin.highlight ? '#f59e0b' : '#22d3ee'}
                    stroke="#ffffff"
                    strokeWidth="1"
                    filter="url(#neonGlow)"
                  />
                  <text
                    x={px + 7}
                    y={py + 3}
                    fill={pin.highlight ? '#fbbf24' : '#e0f2fe'}
                    fontSize="9.5"
                    fontWeight={pin.highlight ? '800' : '600'}
                    fontFamily="Inter, sans-serif"
                  >
                    {pin.name}
                  </text>
                </g>
              )
            })}
          </g>
          </g>
        </svg>
      </div>
    </div>
  )
}

function CareerExplorerOverviewCard({ schoolRows, onOpenExplorer }) {
  const topCareers = schoolRows.slice(0, 3)
  return (
    <div className="career-overview-card">
      <div className="career-card-header">
        <div className="career-card-title-wrap">
          <GraduationCap size={16} className="text-purple-400" />
          <h3 className="career-card-title">Explorador de Carreras</h3>
        </div>
        <button type="button" className="btn-link-action" onClick={onOpenExplorer}>
          Ver 65 Carreras →
        </button>
      </div>

      {/* Dual Big Metrics */}
      <div className="career-dual-kpis">
        <div className="dual-kpi-box box-egresados">
          <div className="kpi-micro-label">EGRESADOS</div>
          <div className="kpi-macro-number">2,422</div>
          <div className="kpi-micro-note">Ciclo de egreso profesional</div>
        </div>
        <div className="dual-kpi-box box-bachilleres">
          <div className="kpi-micro-label">BACHILLERES</div>
          <div className="kpi-macro-number">3,100</div>
          <div className="kpi-micro-note">Grados académicos conferidos</div>
        </div>
      </div>

      {/* Mini ranking list */}
      <div className="career-mini-list">
        {topCareers.map((c) => (
          <div className="mini-career-row" key={c.school_key}>
            <div className="career-name-row">
              <span className="c-name">{shorten(c.school, 28)}</span>
              <span className="c-conv">{formatPct(c.conversion)} ingreso</span>
            </div>
            <div className="c-numbers">
              <span>{formatNumber(c.postulantes)} post.</span>
              <span>·</span>
              <span>{formatNumber(c.ingresantes)} ing.</span>
              <span>·</span>
              <span className="c-gap">Brecha {formatNumber(c.gap_score)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CriticalAlertsOverviewCard() {
  const alerts = [
    {
      title: 'Ingeniería de Sistemas 2024-I',
      sub: '9.5% conversion',
      desc: 'Alta demanda insatisfecha (911 postulantes compitiendo por 40 vacantes oficiales).',
      progress: 9.5,
      type: 'warning',
      color: '#f59e0b',
    },
    {
      title: 'Huayucachi',
      sub: '19.6% comedor coverage',
      desc: 'Baja cobertura de asistencia alimentaria respecto a estudiantes en vulnerabilidad.',
      progress: 19.6,
      type: 'danger',
      color: '#f43f5e',
    },
    {
      title: 'Medicina Humana',
      sub: '1.1% conversión crítica',
      desc: 'Mayor cuello de botella institucional (1,995 postulantes para 21 vacantes).',
      progress: 1.1,
      type: 'critical',
      color: '#ec4899',
    },
  ]

  return (
    <div className="alerts-overview-card">
      <div className="alerts-card-header">
        <div className="alerts-title-wrap">
          <span className="red-notification-dot" />
          <h3 className="alerts-card-title">Critical Alerts</h3>
        </div>
        <span className="badge-alert-count">3 activas</span>
      </div>

      <div className="alerts-items-list">
        {alerts.map((a) => (
          <div className="alert-item-box" key={a.title}>
            <div className="alert-header-line">
              <div className="alert-left-title">
                <AlertTriangle size={14} style={{ color: a.color }} />
                <strong>{a.title}</strong>
              </div>
              <span className="alert-metric-pill" style={{ borderColor: a.color, color: a.color }}>
                {a.sub}
              </span>
            </div>
            <p className="alert-desc-text">{a.desc}</p>
            <div className="alert-progress-wrap">
              <div className="alert-progress-track">
                <div
                  className="alert-progress-fill"
                  style={{ width: `${Math.max(4, a.progress)}%`, background: a.color }}
                />
              </div>
              <span className="alert-progress-label">{a.progress}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HistoricalFunnel() {
  const stages = [
    {
      name: 'Postulantes',
      value: 47964,
      pct: '100%',
      widthPct: 100,
      grad: 'linear-gradient(90deg, #8b5cf6, #7c3aed)',
      color: '#8b5cf6',
      sub: 'Demanda total histórica (convocatorias UNCP)',
    },
    {
      name: 'Ingresantes',
      value: 6091,
      pct: '12.7%',
      widthPct: 62,
      grad: 'linear-gradient(90deg, #a855f7, #06b6d4)',
      color: '#06b6d4',
      sub: 'Admitidos por examen ordinario, CEPRE y modalidades',
    },
    {
      name: 'Egresados',
      value: 2422,
      pct: '5.0%',
      widthPct: 40,
      grad: 'linear-gradient(90deg, #06b6d4, #0d9488)',
      color: '#0d9488',
      sub: 'Estudiantes que concluyeron el plan de estudios',
    },
    {
      name: 'Bachilleres',
      value: 3100,
      pct: '6.5%',
      widthPct: 48,
      grad: 'linear-gradient(90deg, #0d9488, #10b981)',
      color: '#10b981',
      sub: 'Grados otorgados mediante resoluciones rectorales',
    },
  ]

  return (
    <div className="historical-funnel-card">
      <div className="funnel-header">
        <div>
          <h3 className="funnel-card-title">Embudo Histórico de Estudiantes</h3>
          <p className="funnel-card-sub">
            Flujo longitudinal con degradé de Púrpura a Teal (comparativa 2022-II, 2023-I y posteriores)
          </p>
        </div>
        <span className="funnel-tag-period">2022-II · 2023-I · 2026-I</span>
      </div>

      <div className="funnel-segments-wrap">
        {stages.map((stage) => (
          <div className="funnel-step" key={stage.name}>
            <div className="step-label-row">
              <span className="step-title">{stage.name}</span>
              <span className="step-values">
                <strong>{formatNumber(stage.value)}</strong>
                <span className="step-badge-pct">{stage.pct}</span>
              </span>
            </div>
            <div className="step-bar-track">
              <div
                className="step-bar-fill"
                style={{
                  width: `${stage.widthPct}%`,
                  background: stage.grad,
                }}
              />
            </div>
            <div className="step-sub-desc">{stage.sub}</div>
          </div>
        ))}
      </div>

      <div className="funnel-semesters-row">
        <div className="sem-item">
          <div className="sem-pill">2022-II</div>
          <div className="sem-data">818 Egresados</div>
        </div>
        <div className="sem-item">
          <div className="sem-pill">2023-I</div>
          <div className="sem-data">1,505 Ingresantes · 1,406 Comedor</div>
        </div>
        <div className="sem-item">
          <div className="sem-pill">2024-I</div>
          <div className="sem-data">7,425 Postulantes · 19.9% Conv.</div>
        </div>
        <div className="sem-item">
          <div className="sem-pill">2025-I</div>
          <div className="sem-data">14,475 Postulantes · 8.6% Conv.</div>
        </div>
      </div>
    </div>
  )
}


function SamplingTableCard({ onExportCSV }) {
  const rows = [
    {
      entry: 'Acceso General UNCP',
      conversion: '12.7%',
      postulantes: '47,964',
      ingresantes: '6,091',
      status: 'Auditado',
      statusClass: 'status-emerald',
    },
    {
      entry: 'Huayucachi (Distrito)',
      conversion: '19.6%',
      postulantes: '184',
      ingresantes: '36',
      status: 'En Muestra',
      statusClass: 'status-cyan',
    },
    {
      entry: 'Ingeniería de Sistemas 2024-I',
      conversion: '9.5%',
      postulantes: '911',
      ingresantes: '40',
      status: 'Crítico',
      statusClass: 'status-amber',
    },
    {
      entry: 'Medicina Humana 2025-I',
      conversion: '1.1%',
      postulantes: '1,995',
      ingresantes: '21',
      status: 'Alta Presión',
      statusClass: 'status-rose',
    },
  ]

  return (
    <div className="sampling-card">
      <div className="sampling-card-header">
        <div>
          <h3 className="sampling-title">Muestreo y Eliminación de Entradas</h3>
          <p className="sampling-sub">
            Control de integridad referencial, deduplicación canónica SHA-256 e integración con Excel.
          </p>
        </div>
        <button type="button" className="btn-sampling-export" onClick={onExportCSV}>
          <FileSpreadsheet size={14} /> Exportar Excel / CSV
        </button>
      </div>

      <div className="sampling-table-wrap">
        <table className="sampling-table">
          <thead>
            <tr>
              <th>Entrada / Muestra</th>
              <th>Tasa Conversión</th>
              <th>Postulantes</th>
              <th>Ingresantes</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.entry}>
                <td className="entry-cell">{row.entry}</td>
                <td className="conversion-cell">{row.conversion}</td>
                <td className="num-cell">{row.postulantes}</td>
                <td className="num-cell">{row.ingresantes}</td>
                <td>
                  <span className={`status-pill ${row.statusClass}`}>{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sampling-card-footer">
        <div className="integrity-note">
          <CheckCircle2 size={13} className="text-emerald-400" />
          <span>Integridad SQLite: 0 duplicados redundantes · 68,126 registros base</span>
        </div>
        <span className="sync-pill">Sincronización 100% Determinista</span>
      </div>
    </div>
  )
}

// ============================================================================
// HELPER: CLASIFICACIÓN DE ÁREAS Y METADATOS ACADÉMICOS PARA CARRERAS UNCP
// ============================================================================
function getCareerMeta(schoolName = '') {
  const s = schoolName.toLowerCase()
  if (
    s.includes('medicina') ||
    s.includes('enfermer') ||
    s.includes('odontolog') ||
    s.includes('farmacia')
  ) {
    return {
      areaKey: 'salud',
      areaLabel: 'Ciencias de la Salud',
      icon: Stethoscope,
      badgeColor: '#06b6d4',
      badgeClass: 'badge-area-salud',
    }
  }
  if (
    s.includes('derecho') ||
    s.includes('sociolog') ||
    s.includes('antropolog') ||
    s.includes('educaci') ||
    s.includes('social') ||
    s.includes('filosof') ||
    s.includes('comunicac')
  ) {
    return {
      areaKey: 'sociales',
      areaLabel: 'Ciencias Sociales y Humanas',
      icon: Scale,
      badgeColor: '#a855f7',
      badgeClass: 'badge-area-sociales',
    }
  }
  if (
    s.includes('administrac') ||
    s.includes('contabil') ||
    s.includes('econom')
  ) {
    return {
      areaKey: 'empresariales',
      areaLabel: 'Ciencias Empresariales',
      icon: Briefcase,
      badgeColor: '#f59e0b',
      badgeClass: 'badge-area-empresa',
    }
  }
  if (
    s.includes('agronom') ||
    s.includes('forestal') ||
    s.includes('zootecn') ||
    s.includes('agroindustrial')
  ) {
    return {
      areaKey: 'agrarias',
      areaLabel: 'Ciencias Agrarias y Ambientales',
      icon: School,
      badgeColor: '#10b981',
      badgeClass: 'badge-area-agro',
    }
  }
  return {
    areaKey: 'ingenieria',
    areaLabel: 'Ingenierías y Arquitectura',
    icon: Compass,
    badgeColor: '#3b82f6',
    badgeClass: 'badge-area-ingenieria',
  }
}

function getSelectivityBadge(conversion, postulantes, ingresantes) {
  const ratio = ingresantes > 0 ? postulantes / ingresantes : 0
  const ratioRounded = Math.round(ratio)
  const ratioLabel = ingresantes > 0 ? `1 : ${ratioRounded}` : 'N/D'
  const ratioFull = ingresantes > 0 ? `1 vacante c/ ${ratioRounded} post.` : 'Sin vacantes'

  if (conversion < 4 || ratio >= 25) {
    return {
      tag: 'Ultra Competitiva',
      level: 'Alta Selectividad (Crítica)',
      className: 'comp-critical',
      color: '#ef4444',
      ratioLabel,
      ratioFull,
      ratio: ratioRounded,
    }
  }
  if (conversion < 12 || ratio >= 8) {
    return {
      tag: 'Alta Demanda',
      level: 'Competencia Elevada',
      className: 'comp-high',
      color: '#f59e0b',
      ratioLabel,
      ratioFull,
      ratio: ratioRounded,
    }
  }
  if (conversion < 25 || ratio >= 4) {
    return {
      tag: 'Competencia Media',
      level: 'Selectividad Moderada',
      className: 'comp-medium',
      color: '#06b6d4',
      ratioLabel,
      ratioFull,
      ratio: ratioRounded,
    }
  }
  return {
    tag: 'Acceso Regular',
    level: 'Acceso Fluido',
    className: 'comp-regular',
    color: '#10b981',
    ratioLabel,
    ratioFull,
    ratio: ratioRounded,
  }
}

// ============================================================================
// COMPONENTE: COMPARATIVO EJECUTIVO DE ADMISIÓN POR ESCUELA (EXPERT LEVEL)
// ============================================================================
function AdmissionSchoolComparative({ rows }) {
  const [viewMode, setViewMode] = useState('table') // 'table' | 'cards'
  const [search, setSearch] = useState('')
  const [selectedArea, setSelectedArea] = useState('ALL')
  const [sortBy, setSortBy] = useState('postulantes') // 'postulantes' | 'selectivity' | 'ingresantes' | 'alpha'
  const [showAll, setShowAll] = useState(false)

  // Enriquecer datos de cada carrera
  const enrichedRows = useMemo(() => {
    return rows.map((r) => {
      const meta = getCareerMeta(r.school)
      const comp = getSelectivityBadge(r.conversion, r.postulantes, r.ingresantes)
      return {
        ...r,
        meta,
        comp,
      }
    })
  }, [rows])

  // Conteos por área de conocimiento
  const areaCounts = useMemo(() => {
    const counts = { ALL: enrichedRows.length, ingenieria: 0, salud: 0, sociales: 0, empresariales: 0, agrarias: 0 }
    enrichedRows.forEach((r) => {
      if (counts[r.meta.areaKey] !== undefined) {
        counts[r.meta.areaKey]++
      }
    })
    return counts
  }, [enrichedRows])

  // Filtrado y ordenamiento dinámico
  const displayedRows = useMemo(() => {
    const list = enrichedRows.filter((r) => {
      const matchesSearch =
        !search.trim() ||
        r.school.toLowerCase().includes(search.toLowerCase()) ||
        r.meta.areaLabel.toLowerCase().includes(search.toLowerCase())
      const matchesArea = selectedArea === 'ALL' || r.meta.areaKey === selectedArea
      return matchesSearch && matchesArea
    })

    list.sort((a, b) => {
      if (sortBy === 'postulantes') return b.postulantes - a.postulantes
      if (sortBy === 'selectivity') return a.conversion - b.conversion // Más selectivas primero (menor % de ingreso)
      if (sortBy === 'ingresantes') return b.ingresantes - a.ingresantes
      if (sortBy === 'alpha') return a.school.localeCompare(b.school)
      return 0
    })

    return list
  }, [enrichedRows, search, selectedArea, sortBy])

  const maxPostulantes = useMemo(() => {
    return Math.max(1, ...enrichedRows.map((r) => r.postulantes))
  }, [enrichedRows])

  // Indicadores de cabecera ejecutiva
  const topDemandSchool = useMemo(() => {
    return [...enrichedRows].sort((a, b) => b.postulantes - a.postulantes)[0]
  }, [enrichedRows])

  const mostSelectiveSchool = useMemo(() => {
    return [...enrichedRows]
      .filter((r) => r.postulantes >= 80)
      .sort((a, b) => a.conversion - b.conversion)[0]
  }, [enrichedRows])

  const totalPostulantes = useMemo(() => {
    return enrichedRows.reduce((acc, r) => acc + r.postulantes, 0)
  }, [enrichedRows])

  const totalIngresantes = useMemo(() => {
    return enrichedRows.reduce((acc, r) => acc + r.ingresantes, 0)
  }, [enrichedRows])

  const visibleList = showAll ? displayedRows : displayedRows.slice(0, 14)

  return (
    <div className="comparative-admission-section">
      {/* Cinta de Inteligencia y KPIs Ejecutivos */}
      <div className="comparative-kpi-ribbon">
        <div className="ribbon-card ribbon-primary">
          <div className="ribbon-icon-wrap bg-cyan-glow">
            <Flame size={18} className="text-cyan" />
          </div>
          <div className="ribbon-info">
            <span className="ribbon-caption">Máxima Presión de Demanda</span>
            <strong className="ribbon-value">{topDemandSchool ? topDemandSchool.school : 'N/D'}</strong>
            <span className="ribbon-sub">
              {topDemandSchool ? `${formatNumber(topDemandSchool.postulantes)} postulantes registrados` : ''}
            </span>
          </div>
        </div>

        <div className="ribbon-card ribbon-accent">
          <div className="ribbon-icon-wrap bg-purple-glow">
            <Target size={18} className="text-purple" />
          </div>
          <div className="ribbon-info">
            <span className="ribbon-caption">Mayor Exigencia y Selectividad</span>
            <strong className="ribbon-value">{mostSelectiveSchool ? mostSelectiveSchool.school : 'N/D'}</strong>
            <span className="ribbon-sub">
              {mostSelectiveSchool ? `${formatPct(mostSelectiveSchool.conversion)} conversión · ${mostSelectiveSchool.comp.ratioFull}` : ''}
            </span>
          </div>
        </div>

        <div className="ribbon-card ribbon-neutral">
          <div className="ribbon-icon-wrap bg-teal-glow">
            <Users size={18} className="text-teal" />
          </div>
          <div className="ribbon-info">
            <span className="ribbon-caption">Capacidad Global Analizada</span>
            <strong className="ribbon-value">
              {formatNumber(totalIngresantes)} <span className="ribbon-unit">vacantes admitidas</span>
            </strong>
            <span className="ribbon-sub">
              Sobre {formatNumber(totalPostulantes)} postulantes ({formatPct((totalIngresantes / Math.max(1, totalPostulantes)) * 100)} efectividad)
            </span>
          </div>
        </div>
      </div>

      {/* Barra de Control, Filtros de Área y Búsqueda */}
      <div className="comparative-controls-deck">
        <div className="deck-left">
          <div className="area-filter-tabs">
            {[
              { key: 'ALL', label: 'Todas las Facultades' },
              { key: 'ingenieria', label: 'Ingenierías y Arq.' },
              { key: 'salud', label: 'Ciencias de la Salud' },
              { key: 'sociales', label: 'Ciencias Sociales' },
              { key: 'empresariales', label: 'Empresariales' },
              { key: 'agrarias', label: 'Agrarias y Amb.' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`area-tab-btn ${selectedArea === tab.key ? 'active' : ''}`}
                onClick={() => setSelectedArea(tab.key)}
              >
                <span>{tab.label}</span>
                <span className="tab-count-badge">{areaCounts[tab.key] || 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="deck-right">
          <div className="comparative-search-wrap">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              className="comparative-search-input"
              placeholder="Buscar carrera o especialidad..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="clear-search-btn" onClick={() => setSearch('')}>
                ×
              </button>
            )}
          </div>

          <div className="sort-selector-wrap">
            <SlidersHorizontal size={13} className="sort-icon" />
            <select
              className="comparative-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label="Criterio de ordenamiento"
            >
              <option value="postulantes">Ordenar: Mayor Demanda (Postulantes ↓)</option>
              <option value="selectivity">Ordenar: Mayor Selectividad (Tasa Ingreso ↑)</option>
              <option value="ingresantes">Ordenar: Mayor Vacantes (Ingresantes ↓)</option>
              <option value="alpha">Ordenar: Alfabético (A - Z)</option>
            </select>
          </div>

          <div className="view-mode-toggle">
            <button
              type="button"
              className={`view-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              title="Vista Matriz de Inteligencia (Tabla)"
            >
              <Table size={14} />
              <span>Tabla</span>
            </button>
            <button
              type="button"
              className={`view-btn ${viewMode === 'cards' ? 'active' : ''}`}
              onClick={() => setViewMode('cards')}
              title="Vista Cuadrícula de Tarjetas Tácticas"
            >
              <LayoutGrid size={14} />
              <span>Tarjetas</span>
            </button>
          </div>
        </div>
      </div>

      {/* Contenido Principal: Tabla Ejecutiva o Tarjetas */}
      {displayedRows.length === 0 ? (
        <div className="comparative-empty-state">
          <AlertTriangle size={24} className="text-amber" />
          <p>No se encontraron programas académicos que coincidan con los filtros seleccionados.</p>
          <button
            type="button"
            className="btn-reset-filters"
            onClick={() => {
              setSearch('')
              setSelectedArea('ALL')
            }}
          >
            Restablecer criterios
          </button>
        </div>
      ) : viewMode === 'table' ? (
        <div className="comparative-table-wrapper">
          <table className="executive-admission-table">
            <thead>
              <tr>
                <th className="th-rank"># Rank</th>
                <th className="th-school">Programa Académico y Área de Conocimiento</th>
                <th className="th-postulantes">Postulantes (Demanda)</th>
                <th className="th-ingresantes">Ingresantes (Vacantes)</th>
                <th className="th-ratio">Ratio de Competencia</th>
                <th className="th-conversion">Tasa de Ingreso (% Selectividad)</th>
                <th className="th-status">Diagnóstico Institucional</th>
              </tr>
            </thead>
            <tbody>
              {visibleList.map((item, idx) => {
                const IconComponent = item.meta.icon
                const pctBarWidth = Math.min(100, Math.max(2, item.conversion))
                const volumePct = Math.round((item.postulantes / maxPostulantes) * 100)

                return (
                  <tr key={item.school_key} className="table-admission-row">
                    <td className="td-rank">
                      <span className={`rank-pill rank-${idx < 3 ? idx + 1 : 'regular'}`}>
                        {idx === 0 ? '🥇 #1' : idx === 1 ? '🥈 #2' : idx === 2 ? '🥉 #3' : `#${idx + 1}`}
                      </span>
                    </td>
                    <td className="td-school">
                      <div className="school-cell-content">
                        <div className={`school-icon-circle ${item.meta.badgeClass}`}>
                          <IconComponent size={15} />
                        </div>
                        <div className="school-text-meta">
                          <strong className="school-title">{item.school}</strong>
                          <span className="school-area-tag">{item.meta.areaLabel}</span>
                        </div>
                      </div>
                    </td>
                    <td className="td-postulantes">
                      <div className="postulantes-cell">
                        <strong className="num-val text-blue">{formatNumber(item.postulantes)}</strong>
                        <div className="relative-demand-track" title={`${volumePct}% relativo a la carrera de máxima demanda`}>
                          <div className="relative-demand-fill" style={{ width: `${volumePct}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="td-ingresantes">
                      <div className="ingresantes-cell">
                        <span className="vacantes-pill">
                          <CheckCircle2 size={12} className="text-teal" />
                          <strong>{formatNumber(item.ingresantes)}</strong> vacantes
                        </span>
                      </div>
                    </td>
                    <td className="td-ratio">
                      <div className="ratio-cell">
                        <span className={`ratio-indicator-badge ${item.comp.className}`}>
                          <strong>{item.comp.ratioLabel}</strong>
                        </span>
                        <span className="ratio-sublabel">{item.comp.ratioFull}</span>
                      </div>
                    </td>
                    <td className="td-conversion">
                      <div className="conversion-cell">
                        <div className="conversion-top">
                          <strong className="conversion-percentage">{formatPct(item.conversion)}</strong>
                        </div>
                        <div className="conversion-gauge-track">
                          <div
                            className="conversion-gauge-fill"
                            style={{
                              width: `${pctBarWidth}%`,
                              background: item.comp.color,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="td-status">
                      <span className={`status-tag-badge ${item.comp.className}`}>
                        {item.comp.tag}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="comparative-cards-grid">
          {visibleList.map((item, idx) => {
            const IconComponent = item.meta.icon
            const pctBarWidth = Math.min(100, Math.max(2, item.conversion))

            return (
              <article className="executive-career-card" key={item.school_key}>
                <div className="card-top-header">
                  <div className="card-school-info">
                    <div className={`school-icon-circle ${item.meta.badgeClass}`}>
                      <IconComponent size={16} />
                    </div>
                    <div>
                      <h4 className="card-school-name">{item.school}</h4>
                      <span className="card-area-badge">{item.meta.areaLabel}</span>
                    </div>
                  </div>
                  <span className={`rank-pill rank-${idx < 3 ? idx + 1 : 'regular'}`}>
                    #{idx + 1}
                  </span>
                </div>

                <div className="card-kpi-tiles">
                  <div className="card-tile">
                    <div className="tile-header">
                      <Users size={12} className="text-blue" />
                      <span>Postulantes</span>
                    </div>
                    <strong className="tile-val text-blue">{formatNumber(item.postulantes)}</strong>
                  </div>

                  <div className="card-tile">
                    <div className="tile-header">
                      <CheckCircle2 size={12} className="text-teal" />
                      <span>Ingresantes</span>
                    </div>
                    <strong className="tile-val text-teal">{formatNumber(item.ingresantes)}</strong>
                  </div>

                  <div className="card-tile">
                    <div className="tile-header">
                      <Target size={12} className="text-purple" />
                      <span>Ratio Vacante</span>
                    </div>
                    <strong className="tile-val text-purple">{item.comp.ratioLabel}</strong>
                  </div>
                </div>

                <div className="card-selectivity-gauge">
                  <div className="gauge-labels">
                    <span className="gauge-lbl">Tasa de Ingreso</span>
                    <div className="gauge-val-group">
                      <strong className="gauge-pct">{formatPct(item.conversion)}</strong>
                      <span className={`gauge-badge ${item.comp.className}`}>{item.comp.tag}</span>
                    </div>
                  </div>
                  <div className="progress-bar-wrap">
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${pctBarWidth}%`,
                        background: item.comp.color,
                      }}
                    />
                  </div>
                  <div className="gauge-subtext">
                    {item.ingresantes} ingresaron de {formatNumber(item.postulantes)} postulantes · {item.comp.ratioFull}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Paginación / Expansión de Carreras */}
      {displayedRows.length > 14 && (
        <div className="comparative-pagination-bar">
          <button
            type="button"
            className="btn-show-more-schools"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll
              ? 'Mostrar solo los primeros 14 programas'
              : `Ver la totalidad de las ${displayedRows.length} carreras profesionales analizadas`}
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// COMPONENTE: DECK DE TELEMETRÍA GEOESPACIAL Y LEYENDA HUD GIS (EXPERT LEVEL)
// ============================================================================
function GisTelemetryDeck({
  geoDepartment,
  geoProvince,
  gisFilteredFeatures,
  activeMetricObj,
  maxGeoValue,
}) {
  const totalMetricInView = useMemo(() => {
    return gisFilteredFeatures.reduce((acc, f) => acc + (Number(f.value) || 0), 0)
  }, [gisFilteredFeatures])

  return (
    <div className="gis-telemetry-deck">
      {/* Chips de Telemetría Cartográfica */}
      <div className="gis-telemetry-chips">
        <div className="telemetry-badge radar-active">
          <span className="radar-pulse-beacon">
            <span className="ping-ring"></span>
            <span className="core-dot"></span>
          </span>
          <span className="badge-text">SISTEMA GIS ACTIVO</span>
        </div>

        <div className="telemetry-badge scope-badge">
          <MapPinned size={14} className="badge-icon text-cyan" />
          <div className="badge-text-group">
            <span className="badge-caption">ÁMBITO CARTOGRÁFICO</span>
            <strong className="badge-val">
              {geoDepartment === 'ALL' ? 'Nacional (Perú)' : `Región ${geoDepartment}`}
              {geoProvince !== 'ALL' && ` · Prov. ${geoProvince}`}
            </strong>
          </div>
        </div>

        <div className="telemetry-badge coverage-badge">
          <Layers size={14} className="badge-icon text-purple" />
          <div className="badge-text-group">
            <span className="badge-caption">COBERTURA VECTORIAL</span>
            <strong className="badge-val">
              <span className="highlight-number">{gisFilteredFeatures.length}</span> Distritos Georreferenciados
            </strong>
          </div>
        </div>

        <div className="telemetry-badge flow-badge">
          <Users size={14} className="badge-icon text-blue" />
          <div className="badge-text-group">
            <span className="badge-caption">FLUJO TOTAL ({activeMetricObj.label.toUpperCase()})</span>
            <strong className="badge-val">
              {formatNumber(totalMetricInView)} <span className="unit-label">estudiantes</span>
            </strong>
          </div>
        </div>

        <div className="telemetry-badge hub-badge">
          <School size={14} className="badge-icon text-amber" />
          <div className="badge-text-group">
            <span className="badge-caption">NODO MATRIZ UNCP</span>
            <strong className="badge-val">Campus Central El Tambo</strong>
          </div>
        </div>
      </div>

      {/* Leyenda y Gradiente Cuantílico Espectral */}
      <div className="gis-legend-hud">
        <div className="legend-hud-top">
          <div className="legend-metric-chip" style={{ borderColor: `${activeMetricObj.color}40` }}>
            <span className="legend-color-dot" style={{ background: activeMetricObj.color }} />
            <span className="legend-metric-name">
              Gradiente: <strong>{activeMetricObj.label}</strong>
            </span>
          </div>
          <span className="legend-crs-pill">EPSG:4326 · WGS 84</span>
        </div>

        <div className="legend-track-container">
          <div
            className="legend-gradient-bar"
            style={{
              background: `linear-gradient(to right, #dbeafe, #38bdf8, ${activeMetricObj.color}, #ea580c)`,
            }}
          />
          <div className="legend-ticks-row">
            <span className="legend-tick">
              <span className="tick-pipe" />
              <span className="tick-label">0 (Mín)</span>
            </span>
            <span className="legend-tick">
              <span className="tick-pipe" />
              <span className="tick-label">P50: {formatNumber(Math.round(maxGeoValue * 0.5))}</span>
            </span>
            <span className="legend-tick highlight-peak">
              <span className="tick-pipe" />
              <span className="tick-label">Pico: {formatNumber(maxGeoValue)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const data = dashboardData
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('uncp_theme') || 'dark'
    } catch {
      return 'dark'
    }
  })

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.className = `theme-${theme}`
    try {
      localStorage.setItem('uncp_theme', theme)
    } catch {}
  }, [theme])

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
  const gisZoomPan = useSvgZoomPan({ minZoom: 0.7, maxZoom: 8 })

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

  const kpis = useMemo(() => {
    const isFiltered = period !== 'ALL' || school !== 'ALL' || sex !== 'ALL' || Boolean(query)
    const postulantes = sum(filteredSchoolRows, 'postulantes')
    const ingresantes = sum(filteredSchoolRows, 'ingresantes')
    const conversion = postulantes ? (ingresantes * 100) / postulantes : 0
    const districtCount = new Set(geoRows.map((r) => r.district)).size

    return [
      {
        icon: Database,
        label: 'BASE',
        value: isFiltered
          ? formatNumber(
              postulantes +
                ingresantes +
                sum(filteredSchoolRows, 'comedor') +
                sum(filteredSchoolRows, 'egresados') +
                sum(filteredSchoolRows, 'bachiller'),
            )
          : '68,126',
        trend: '+100%',
        note: `${data.totals.datasets} datasets · ${data.totals.resources} archivos`,
        color: 'cyan',
      },
      {
        icon: Users,
        label: 'POSTULANTES',
        value: isFiltered ? formatNumber(postulantes) : '47,964',
        trend: '+14.2%',
        note: period === 'ALL' ? 'Demanda total histórica' : `Periodo ${period}`,
        color: 'blue',
      },
      {
        icon: Target,
        label: 'CONVERSIÓN DE INGRESO',
        value: isFiltered ? formatPct(conversion) : '12.7%',
        trend: '+1.5%',
        note: `${formatNumber(ingresantes || 6091)} ingresantes admitidos`,
        color: 'teal',
      },
      {
        icon: MapPinned,
        label: 'DISTRITOS',
        value: isFiltered ? formatNumber(districtCount) : '123',
        trend: '+8',
        note: 'Cobertura territorial regional',
        color: 'gold',
      },
    ]
  }, [
    data.totals.datasets,
    data.totals.resources,
    filteredSchoolRows,
    geoRows,
    period,
    query,
    school,
    sex,
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
    <div className={`app-shell theme-${theme}`} data-theme={theme}>
      {/* Top Navigation Bar: Logo, Title, and Right-aligned Interactive Filters */}
      <header className="app-header">
        <div className="top-nav-main">
          <div className="top-nav-brand">
            <div className="brand-logo-crest" title="Universidad Nacional del Centro del Perú">
              <School size={22} className="crest-icon" />
            </div>
            <div className="brand-text-block">
              <div className="system-subtitle">Sistema de Inteligencia de Datos Universitarios</div>
              <h1 className="system-title">Observatorio Institucional de Acceso, Permanencia y Bienestar</h1>
            </div>
          </div>

          <div className="top-nav-controls">
            <div className="filter-pill-group">
              <div className="filter-control">
                <label htmlFor="period-select">
                  <Filter size={11} /> Semestre/Periodo
                </label>
                <select
                  id="period-select"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  <option value="ALL">All Semesters</option>
                  {data.periods.map((item) => (
                    <option value={item} key={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-control">
                <label htmlFor="school-select">
                  <School size={11} /> Escuela Profesional
                </label>
                <select
                  id="school-select"
                  value={school}
                  onChange={(e) => setSchool(e.target.value)}
                >
                  <option value="ALL">All 65 Careers</option>
                  {data.schools.map((item) => (
                    <option value={item.key} key={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-control">
                <label htmlFor="sex-select">
                  <Users size={11} /> Sexo Publicado
                </label>
                <select
                  id="sex-select"
                  value={sex}
                  onChange={(e) => setSex(e.target.value)}
                >
                  <option value="ALL">All</option>
                  {data.sex_summary.map((item) => (
                    <option value={item.key} key={item.key}>
                      {item.sex}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-control search-control">
                <label htmlFor="search-input">
                  <Search size={11} /> Búsqueda Libre
                </label>
                <div className="search-input-wrap">
                  <input
                    id="search-input"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Búsqueda Libre..."
                  />
                  {query && (
                    <button
                      type="button"
                      className="clear-search-btn"
                      onClick={() => setQuery('')}
                      title="Limpiar búsqueda"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {isFiltered && (
                <button
                  type="button"
                  className="btn-reset-pill"
                  onClick={handleResetFilters}
                  title="Restablecer filtros"
                >
                  <RotateCcw size={12} />
                </button>
              )}
            </div>

            <div className="header-meta-actions">
              <button
                type="button"
                className="btn-theme-toggle"
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro'}
                aria-label="Alternar tema de color"
              >
                {theme === 'dark' ? (
                  <>
                    <Sun size={14} className="theme-toggle-icon sun-icon" />
                    <span>Claro</span>
                  </>
                ) : (
                  <>
                    <Moon size={14} className="theme-toggle-icon moon-icon" />
                    <span>Oscuro</span>
                  </>
                )}
              </button>

              <button
                type="button"
                className="btn-export-top"
                onClick={handleExportCSV}
                title="Descargar matriz en CSV"
              >
                <Download size={13} /> Exportar
              </button>
              <div className="live-db-pill">
                <span className="pulse-dot-green" />
                <span>SQLite Activa</span>
              </div>
            </div>
          </div>
        </div>

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

        {/* RUTA 1: VISIÓN GLOBAL (SaaS Command Center) */}
        {activeTab === 'overview' && (
          <div className="tab-view fade-in">
            {/* Main Content Area: Territory & GIS Map (Left) + Career Explorer & Alerts (Right) */}
            <div className="overview-main-grid">
              <div className="overview-map-col">
                <OverviewGisMap
                  features={gisFilteredFeatures}
                  bounds={activeBounds}
                  metricObj={activeMetricObj}
                  routes={corridorRoutes}
                  onSelectFeature={setSelectedFeature}
                  selectedFeature={selectedFeature}
                  onOpenGisTab={() => setActiveTab('gis')}
                />
              </div>

              <div className="overview-right-col">
                <CareerExplorerOverviewCard
                  schoolRows={filteredSchoolRows}
                  onOpenExplorer={() => setActiveTab('explorer')}
                />
                <CriticalAlertsOverviewCard />
              </div>
            </div>

            {/* Bottom Row: Historical Funnel (Left) + Sampling & Excel Integration (Right) */}
            <div className="overview-lower-grid mt-4">
              <div className="overview-funnel-col">
                <HistoricalFunnel />
              </div>

              <div className="overview-sampling-col">
                <SamplingTableCard onExportCSV={handleExportCSV} />
              </div>
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
                hint="Relación directa entre postulantes e ingresantes efectivos, ratios de selectividad y estado de competencia institucional."
              >
                <AdmissionSchoolComparative rows={filteredSchoolRows} />
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
                <GisTelemetryDeck
                  geoDepartment={geoDepartment}
                  geoProvince={geoProvince}
                  gisFilteredFeatures={gisFilteredFeatures}
                  activeMetricObj={activeMetricObj}
                  maxGeoValue={maxGeoValue}
                />

                <div
                  className={`svg-map-wrapper ${gisZoomPan.isDragging ? 'is-panning' : ''}`}
                  ref={gisZoomPan.containerRef}
                  {...gisZoomPan.eventHandlers}
                >
                  {/* Controles flotantes de Zoom y Pan en Mapa Extendido */}
                  <div className="map-zoom-controls">
                    <button
                      type="button"
                      className="map-control-btn"
                      onClick={gisZoomPan.handleZoomIn}
                      title="Acercar mapa (Rueda arriba o clic)"
                      aria-label="Acercar mapa"
                    >
                      <ZoomIn size={15} />
                    </button>
                    <span className="map-zoom-badge" title="Nivel de zoom actual">
                      {Math.round(gisZoomPan.zoom * 100)}%
                    </span>
                    <button
                      type="button"
                      className="map-control-btn"
                      onClick={gisZoomPan.handleZoomOut}
                      title="Alejar mapa (Rueda abajo o clic)"
                      aria-label="Alejar mapa"
                    >
                      <ZoomOut size={15} />
                    </button>
                    <button
                      type="button"
                      className="map-control-btn reset-btn"
                      onClick={gisZoomPan.handleReset}
                      title="Restablecer encuadre original (100%)"
                      aria-label="Restablecer zoom"
                    >
                      <Maximize2 size={13} />
                    </button>
                  </div>

                  <div className="map-interaction-tooltip">
                    <Move size={12} />
                    <span>Arrastra para mover · Rueda para zoom · Doble clic para acercar</span>
                  </div>

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
                      fill="var(--bg-map-canvas, #f8fafc)"
                      stroke="var(--border-subtle, #e2e8f0)"
                    />
                    <g
                      className="map-zoomable-layer"
                      transform={`translate(${gisZoomPan.pan.x}, ${gisZoomPan.pan.y}) scale(${gisZoomPan.zoom})`}
                      style={{
                        transformOrigin: '0 0',
                        transition: gisZoomPan.isDragging ? 'none' : 'transform 0.12s ease-out',
                      }}
                    >

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
                            onClick={() => { if (!gisZoomPan.hasMoved()) setSelectedFeature(feature) }}
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
                    </g>
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
                          <span className="stat-pill-label">
                            <Users size={12} className="text-blue" /> Postulantes
                          </span>
                          <strong className="stat-pill-val text-blue">
                            {formatNumber(m.postulantes)}
                          </strong>
                        </div>
                        <div className="stat-pill-item">
                          <span className="stat-pill-label">
                            <CheckCircle2 size={12} className="text-teal" /> Ingresantes
                          </span>
                          <strong className="stat-pill-val text-teal">
                            {formatNumber(m.ingresantes)}
                          </strong>
                        </div>
                        <div className="stat-pill-item">
                          <span className="stat-pill-label">
                            <Target size={12} className="text-purple" /> Tasa Conversión
                          </span>
                          <strong className="stat-pill-val text-purple">
                            {formatPct(m.conversion)}
                          </strong>
                        </div>
                        <div className="stat-pill-item">
                          <span className="stat-pill-label">
                            <Utensils size={12} className="text-green" /> Comedor Univ.
                          </span>
                          <strong className="stat-pill-val text-green">
                            {formatNumber(m.comedor)}
                          </strong>
                        </div>
                        <div className="stat-pill-item">
                          <span className="stat-pill-label">
                            <GraduationCap size={12} className="text-amber" /> CEPRE UNCP
                          </span>
                          <strong className="stat-pill-val text-amber">
                            {formatNumber(m.cepre)}
                          </strong>
                        </div>
                        <div className="stat-pill-item">
                          <span className="stat-pill-label">
                            <Award size={12} className="text-emerald" /> Egresados
                          </span>
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
