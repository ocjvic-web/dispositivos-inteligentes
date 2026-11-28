# Sitio BioMedica: CI y pruebas

Cada pull request y cada push a `main` ejecuta `.github/workflows/portal-ci.yml`:
build Angular, pruebas unitarias, flujos UI con Playwright, 1,040 pruebas de
contratos API con pytest sobre un servidor local aislado y la suite de caja roja
del proyecto móvil. La caja roja ejercita entradas inválidas y fallos controlados
de red/servicio; no es una prueba de intrusión. Las pruebas no escriben en
producción.

Cada ejecución de CI publica dos artefactos PDF descargables:

- `pruebas-frontend-backend-*`: flujos Playwright, botones, endpoints, estados
  HTTP, duraciones y resultados de cada sondeo de API.
- `pruebas-caja-roja-*`: resultado y duración de cada suite de caja roja.

El artefacto `evidencia-pruebas-bioMedica-*` incluye también JUnit XML,
observaciones JSON por solicitud, salida de Angular y el resumen/log de caja
roja. Las acciones de interfaz sin llamada HTTP indican `N/A` para endpoint y
estado. Render conserva el despliegue detrás de `autoDeployTrigger: checksPass`.

Para reproducir las pruebas localmente:

```powershell
npm ci
npm run build
python -m pip install -r requirements-test.txt
python -m playwright install chromium
$env:TEST_RESULTS_DIR = "$env:TEMP\biomedica-smarttv-test-results"
python -m pytest -m frontend --junitxml "$env:TEST_RESULTS_DIR\frontend-junit.xml"
python -m pytest -m backend --junitxml "$env:TEST_RESULTS_DIR\backend-junit.xml"
```

Render debe tener el auto-deploy configurado como `After CI Checks Pass`; esa
política también está declarada en `render.yaml` con `autoDeployTrigger: checksPass`.

Para repetir caja roja localmente, desde el repositorio móvil con Flutter y las
dependencias npm de `backend` instaladas, ejecuta:

```powershell
.\scripts\pruebas\run-caja-roja.ps1
```
