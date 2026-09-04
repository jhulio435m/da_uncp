# Observatorio UNCP

Dashboard React/Vite para la dataton UNCP. Consume el dataset agregado en
`src/data/uncp_dashboard_data.json`, exportado desde SQLite. La base se alimenta
con los CSV descargados de la Plataforma Nacional de Datos Abiertos.

## Comandos

```bash
npm install
npm run dev
npm run build
npm run lint
```

## Pipeline de datos

Desde la raiz del proyecto, para usar los archivos locales existentes:

```bash
python scripts/refresh_uncp_dashboard.py
```

Para descargar una version actualizada y compilar la aplicacion:

```bash
python scripts/refresh_uncp_dashboard.py --download --build-frontend
```

La importacion reconstruye `data/uncp.sqlite3` de forma atomica, evita filas
duplicadas y sincroniza automaticamente las dos copias del JSON procesado.

## Producto

La app incluye:

- filtros por periodo, escuela, sexo y busqueda;
- KPIs de acceso, comedor, egreso y territorio;
- embudo academico por periodo;
- ranking de carreras por indice de brecha;
- concentracion territorial con mapa GIS distrital;
- alertas priorizadas;
- matriz de decision para el pitch.

## GIS

Los CSV UNCP no traen geometria ni lat/lon. Algunos recursos incluyen `UBIGEO`,
pero la mayor cobertura territorial viene como departamento, provincia y
distrito. Para el mapa se enriquece con `data/gis/peru_distrital_simple.geojson`
y se cruza por nombres normalizados.

Fuente de geometria: `juaneladio/peru-geojson`, archivo
`peru_distrital_simple.geojson`.
