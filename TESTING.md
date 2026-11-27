# Sitio BioMedica: CI y pruebas

Cada pull request y cada merge a `main` ejecuta `.github/workflows/portal-ci.yml`:
build Angular, pruebas unitarias, flujos UI con Playwright y 1,040 casos de
contrato API con pytest sobre un servidor local aislado. Las pruebas no escriben
en producción.

El artefacto `biomedica-site-test-results` contiene `site-test-observations.json`
con nombre de botón, duración, endpoint, estatus HTTP y tiempos por llamada, más
el reporte JUnit. Las acciones de interfaz que no hacen una llamada HTTP indican
`N/A` para endpoint y estatus.

Para reproducir las pruebas localmente:

```powershell
npm ci
npm run build
python -m pip install -r requirements-test.txt
python -m playwright install chromium
$env:TEST_RESULTS_DIR = "$env:TEMP\biomedica-smarttv-test-results"
python -m pytest --junitxml "$env:TEST_RESULTS_DIR\junit.xml"
```

Render debe tener el auto-deploy configurado como `After CI Checks Pass`; esa
política también está declarada en `render.yaml` con `autoDeployTrigger: checksPass`.
