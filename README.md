# Observatorio UNCP

Proyecto de datos para analizar acceso, permanencia y bienestar estudiantil de
la Universidad Nacional del Centro del Peru. Usa SQLite como fuente de verdad y
publica un dashboard React completamente estatico.

## Arquitectura

```text
datosabiertos.gob.pe -> recursos locales -> SQLite -> JSON agregado -> React/Vite
```

- `scripts/download_uncp_datasets.py`: descarga idempotente y manifiesto.
- `scripts/import_uncp_sqlite.py`: reconstruccion atomica de SQLite.
- `scripts/build_uncp_dashboard.py`: consultas SQL, indicadores, GIS y exportacion.
- `scripts/refresh_uncp_dashboard.py`: orquestador del flujo completo.
- `data/uncp.sqlite3`: base local generada; no se versiona.
- `observatorio-uncp/`: aplicacion web.

## Uso habitual

Procesar los archivos que ya estan descargados:

```bash
python scripts/refresh_uncp_dashboard.py
```

Actualizar desde el portal y compilar el frontend:

```bash
python scripts/refresh_uncp_dashboard.py --download --build-frontend
```

Desarrollo web:

```bash
cd observatorio-uncp
npm install
npm run dev
```

Validacion:

```bash
python -m unittest discover -s tests -v
cd observatorio-uncp
npm run lint
npm run build
```

## Base de datos

La base se genera primero en un archivo temporal, pasa `PRAGMA integrity_check`
y solo entonces reemplaza la version anterior. Las filas repetidas se detectan
con SHA-256 sobre su contenido canonico.

Las tablas principales son `datasets`, `resources`, `periods`, `schools`,
`territories`, `academic_records` e `imports`. Las vistas `record_facts`,
`topic_totals` y `period_topic_totals` sirven a la exportacion.

No se almacenan UUID, fechas de nacimiento, codigos de matricula ni filas CSV
originales. Si en el futuro se necesita seguimiento longitudinal, se puede
definir temporalmente `UNCP_RECORD_KEY`; el importador guardara un HMAC del UUID,
nunca el identificador original.

El navegador recibe exclusivamente el JSON agregado ubicado en
`observatorio-uncp/src/data/uncp_dashboard_data.json`.
