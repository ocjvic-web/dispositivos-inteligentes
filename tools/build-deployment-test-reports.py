import argparse
import html
import json
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright


def load_json(path):
    if not path or not Path(path).is_file():
        return {}
    with Path(path).open(encoding="utf-8") as source:
        return json.load(source)


def load_junit(path):
    if not path or not Path(path).is_file():
        return []
    root = ET.parse(path).getroot()
    cases = []
    for element in root.iter("testcase"):
        cases.append(
            {
                "name": element.attrib.get("name", "Prueba sin nombre"),
                "classname": element.attrib.get("classname", ""),
                "seconds": float(element.attrib.get("time", "0") or 0),
                "failed": any(element.find(tag) is not None for tag in ("failure", "error")),
                "skipped": element.find("skipped") is not None,
            }
        )
    return cases


def summary(cases):
    return {
        "total": len(cases),
        "failed": sum(case["failed"] for case in cases),
        "skipped": sum(case["skipped"] for case in cases),
        "passed": sum(not case["failed"] and not case["skipped"] for case in cases),
        "duration": sum(case["seconds"] for case in cases),
    }


def esc(value):
    return html.escape(str(value), quote=True)


def status_badge(status):
    label = esc(status)
    class_name = "pass" if status in ("PASS", "PASS / HTTP") else "fail"
    if status in ("N/A", "NO EJECUTADO"):
        class_name = "neutral"
    return f'<span class="badge {class_name}">{label}</span>'


def report_html(title, subtitle, content, metadata):
    metadata_rows = "".join(
        f"<tr><th>{esc(key)}</th><td>{esc(value)}</td></tr>"
        for key, value in metadata.items()
    )
    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>{esc(title)}</title>
<style>
@page {{ size: A4 landscape; margin: 15mm 12mm 18mm; }}
* {{ box-sizing: border-box; }}
body {{ color:#172033; font:9pt/1.4 "Segoe UI",Arial,sans-serif; margin:0; }}
h1,h2,h3 {{ color:#12355b; break-after:avoid; }}
h1 {{ font-size:23pt; margin:0 0 4pt; }}
h2 {{ border-bottom:1px solid #cbd5e1; font-size:15pt; margin:18pt 0 8pt; padding-bottom:4pt; }}
p {{ margin:5pt 0 8pt; }}
.subtitle {{ color:#53657d; font-size:11pt; margin-bottom:15pt; }}
.summary {{ border-collapse:collapse; margin:10pt 0 14pt; width:100%; }}
.summary th,.summary td {{ border:1px solid #cbd5e1; padding:5pt 7pt; text-align:left; }}
.summary th {{ background:#eaf2f8; width:24%; }}
table.data {{ border-collapse:collapse; font-size:7.3pt; margin:8pt 0 14pt; width:100%; }}
table.data thead {{ display:table-header-group; }}
table.data tr {{ break-inside:avoid; }}
table.data th,table.data td {{ border:1px solid #cbd5e1; padding:3pt 4pt; text-align:left; vertical-align:top; }}
table.data th {{ background:#eaf2f8; color:#12355b; }}
.badge {{ border-radius:3px; font-size:7pt; font-weight:700; padding:2pt 4pt; white-space:nowrap; }}
.pass {{ background:#dcfce7; color:#166534; }} .fail {{ background:#fee2e2; color:#991b1b; }}
.neutral {{ background:#e2e8f0; color:#334155; }}
.note {{ background:#f1f5f9; border-left:3px solid #0e7490; margin:10pt 0; padding:7pt 9pt; }}
.mono {{ font-family:Consolas,monospace; overflow-wrap:anywhere; }}
.page-break {{ break-before:page; }}
footer {{ color:#64748b; font-size:7pt; }}
</style>
</head>
<body>
<h1>{esc(title)}</h1>
<p class="subtitle">{esc(subtitle)}</p>
<table class="summary">{metadata_rows}</table>
{content}
<footer>Generado automáticamente en {esc(datetime.now(timezone.utc).isoformat())}.</footer>
</body>
</html>"""


def make_web_report(args, output_dir):
    frontend_cases = load_junit(args.frontend_junit)
    backend_cases = load_junit(args.backend_junit)
    frontend_observations = load_json(args.frontend_observations)
    backend_observations = load_json(args.backend_observations)
    api_probes = backend_observations.get("apiProbes", [])
    angular_log = Path(args.angular_log)
    angular_match = None
    if angular_log.is_file():
        angular_match = re.search(
            r"TOTAL:\s+(\d+)\s+SUCCESS",
            angular_log.read_text(encoding="utf-8", errors="replace"),
        )
    actions = [
        item
        for item in frontend_observations.get("uiActionsAndResponses", [])
        if "actionDurationMs" in item
    ]
    network_observations = [
        item
        for item in frontend_observations.get("uiActionsAndResponses", [])
        if "durationMs" in item and "method" in item
    ]

    frontend_summary = summary(frontend_cases)
    backend_summary = summary(backend_cases)
    total = frontend_summary["total"] + backend_summary["total"]
    failed = frontend_summary["failed"] + backend_summary["failed"]
    metadata = {
        "Resultado": "PASS" if total and not failed else ("FAIL" if failed else "SIN RESULTADOS"),
        "Pruebas Playwright (interfaz)": frontend_summary["total"],
        "Contratos API (backend)": backend_summary["total"],
        "Total": total,
        "Pruebas unitarias Angular": (
            f"{angular_match.group(1)} aprobadas" if angular_match else "ver log del artefacto"
        ),
        "Commit": os.environ.get("GITHUB_SHA", "ejecución local"),
        "Workflow": os.environ.get("GITHUB_RUN_ID", "ejecución local"),
    }

    frontend_rows = []
    for case in frontend_cases:
        state = "FAIL" if case["failed"] else ("N/A" if case["skipped"] else "PASS")
        frontend_rows.append(
            "<tr>"
            f"<td>{esc(case['classname'])}</td>"
            f"<td>{esc(case['name'])}</td>"
            f"<td>{status_badge(state)}</td>"
            f"<td>{case['seconds'] * 1000:.2f} ms</td>"
            "</tr>"
        )
    frontend_table = (
        "<h2>Frontend — Playwright</h2>"
        f"<p>{frontend_summary['passed']} aprobadas, {frontend_summary['failed']} fallidas, "
        f"{frontend_summary['skipped']} omitidas; "
        f"{frontend_summary['duration']:.2f} s acumulados.</p>"
        "<table class='data'><thead><tr><th>Suite</th><th>Escenario</th>"
        "<th>Resultado</th><th>Duración</th></tr></thead><tbody>"
        + "".join(frontend_rows)
        + "</tbody></table>"
    )

    action_rows = []
    for action in actions:
        endpoint = action.get("endpoint", "N/A")
        http_status = action.get("httpStatus", "N/A")
        responses = action.get("responses", [])
        if responses:
            endpoint = "; ".join(
                f"{response.get('method', '')} {response.get('endpoint', '')} "
                f"→ HTTP {response.get('httpStatus', 'N/A')} "
                f"({response.get('durationMs', 0)} ms)"
                for response in responses
            )
        action_rows.append(
            "<tr>"
            f"<td>{esc(action.get('buttonName', 'Acción'))}</td>"
            f"<td class='mono'>{esc(endpoint)}</td>"
            f"<td>{esc(http_status)}</td>"
            f"<td>{esc(action.get('actionDurationMs', 'N/A'))} ms</td>"
            "</tr>"
        )
    action_table = (
        "<h3>Acciones visibles y llamadas observadas</h3>"
        "<table class='data'><thead><tr><th>Botón/acción</th><th>Endpoint y respuesta</th>"
        "<th>Estado HTTP</th><th>Duración</th></tr></thead><tbody>"
        + ("".join(action_rows) or "<tr><td colspan='4'>No hay acciones registradas.</td></tr>")
        + "</tbody></table>"
    )
    network_rows = [
        "<tr>"
        f"<td>{esc(item.get('buttonName', 'page/navigation'))}</td>"
        f"<td>{esc(item.get('method', ''))}</td>"
        f"<td class='mono'>{esc(item.get('endpoint', ''))}</td>"
        f"<td>HTTP {esc(item.get('httpStatus', 'N/A'))}</td>"
        f"<td>{esc(item.get('durationMs', 'N/A'))} ms</td>"
        "</tr>"
        for item in network_observations
    ]
    network_table = (
        "<h3>Respuestas HTTP observadas durante Playwright</h3>"
        "<table class='data'><thead><tr><th>Origen</th><th>Método</th><th>Endpoint</th>"
        "<th>Estado</th><th>Duración</th></tr></thead><tbody>"
        + (
            "".join(network_rows)
            or "<tr><td colspan='5'>Sin solicitudes API/config registradas en el navegador.</td></tr>"
        )
        + "</tbody></table>"
    )

    failed_backend_names = [
        case["name"] for case in backend_cases if case["failed"]
    ]
    api_rows = []
    for probe in api_probes:
        case_name = probe.get("testCase", "")
        failed = any(case_name in name for name in failed_backend_names)
        result = "FAIL" if failed else ("PASS" if backend_cases else "N/A")
        api_rows.append(
            "<tr>"
            f"<td>{esc(case_name)}</td>"
            f"<td>{esc(probe.get('method', ''))}</td>"
            f"<td class='mono'>{esc(probe.get('endpoint', ''))}</td>"
            f"<td>{status_badge(result)}</td>"
            f"<td>HTTP {esc(probe.get('httpStatus', 'N/A'))}</td>"
            f"<td>{esc(probe.get('durationMs', 'N/A'))} ms</td>"
            "</tr>"
        )
    backend_table = (
        "<div class='page-break'></div><h2>Backend — contratos API</h2>"
        f"<p>{backend_summary['passed']} aprobadas, {backend_summary['failed']} fallidas, "
        f"{backend_summary['skipped']} omitidas; "
        f"{backend_summary['duration']:.2f} s acumulados. "
        f"Se registraron {len(api_probes)} respuestas HTTP.</p>"
        "<table class='data'><thead><tr><th>Prueba</th><th>Método</th><th>Endpoint</th>"
        "<th>Resultado del contrato</th><th>Respuesta</th><th>Duración</th></tr></thead><tbody>"
        + "".join(api_rows)
        + "</tbody></table>"
    )
    content = frontend_table + action_table + network_table + backend_table
    html_content = report_html(
        "Reporte de pruebas frontend y backend",
        "Playwright UI y contratos API del sitio BioMedica SmartTV",
        content,
        metadata,
    )
    html_path = output_dir / "pruebas-frontend-backend.html"
    pdf_path = output_dir / "pruebas-frontend-backend.pdf"
    html_path.write_text(html_content, encoding="utf-8")
    render_pdf(html_path, pdf_path)
    return pdf_path


def make_redbox_report(args, output_dir):
    data = load_json(args.redbox_summary)
    steps = data.get("steps", [])
    passed = sum(int(step.get("ExitCode", 1)) == 0 for step in steps)
    failed = len(steps) - passed
    run_result = data.get("result", "NO EJECUTADO")
    metadata = {
        "Suite": data.get("suite", "caja-roja"),
        "Resultado global": run_result,
        "Pruebas de suite": len(steps),
        "Aprobadas / fallidas": f"{passed} / {failed}",
        "Inicio": data.get("startedAt", "No disponible"),
        "Fin": data.get("finishedAt", "No disponible"),
        "Commit": os.environ.get("GITHUB_SHA", "ejecución local"),
        "Workflow": os.environ.get("GITHUB_RUN_ID", "ejecución local"),
    }
    rows = []
    for step in steps:
        code = int(step.get("ExitCode", 1))
        state = "PASS" if code == 0 else "FAIL"
        rows.append(
            "<tr>"
            f"<td>{esc(step.get('Step', 'Prueba sin nombre'))}</td>"
            f"<td>{status_badge(state)}</td>"
            f"<td>{code}</td>"
            f"<td>{esc(step.get('Seconds', 'N/A'))} s</td>"
            "</tr>"
        )
    log_name = data.get("logFile", "salida-terminal.log")
    note = (
        "Caja roja ejercita entradas inválidas y fallos controlados de conectividad/"
        "servicio. No es una prueba de intrusión ni genera carga contra servicios "
        "productivos. El log de terminal detallado se adjunta al artefacto de CI."
    )
    content = (
        "<h2>Resultados por suite</h2>"
        "<table class='data'><thead><tr><th>Escenario</th><th>Resultado</th>"
        "<th>Código</th><th>Duración</th></tr></thead><tbody>"
        + (
            "".join(rows)
            or "<tr><td colspan='4'>No se encontró un resumen JSON de caja roja.</td></tr>"
        )
        + "</tbody></table>"
        + f"<div class='note'>{esc(note)} Log incluido: <span class='mono'>{esc(log_name)}</span>.</div>"
    )
    html_content = report_html(
        "Reporte de pruebas de caja roja",
        "Fallos controlados, datos inválidos y recuperación de BioMedica",
        content,
        metadata,
    )
    html_path = output_dir / "pruebas-caja-roja.html"
    pdf_path = output_dir / "pruebas-caja-roja.pdf"
    html_path.write_text(html_content, encoding="utf-8")
    render_pdf(html_path, pdf_path)
    return pdf_path


def render_pdf(html_path, pdf_path):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page()
            page.goto(html_path.resolve().as_uri(), wait_until="load")
            page.pdf(
                path=str(pdf_path),
                format="A4",
                landscape=True,
                print_background=True,
                display_header_footer=True,
                header_template="<div></div>",
                footer_template=(
                    "<div style='width:100%;font:8px Arial;color:#64748b;"
                    "text-align:center;'>BioMedica · <span class='pageNumber'></span>"
                    " / <span class='totalPages'></span></div>"
                ),
                margin={"top": "15mm", "right": "12mm", "bottom": "18mm", "left": "12mm"},
            )
        finally:
            browser.close()
    if not pdf_path.is_file() or pdf_path.stat().st_size < 1000:
        raise RuntimeError(f"PDF report was not created correctly: {pdf_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--frontend-junit", required=True)
    parser.add_argument("--backend-junit", required=True)
    parser.add_argument("--frontend-observations", required=True)
    parser.add_argument("--backend-observations", required=True)
    parser.add_argument("--angular-log", required=True)
    parser.add_argument("--redbox-summary", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    web_pdf = make_web_report(args, output_dir)
    redbox_pdf = make_redbox_report(args, output_dir)
    print(f"Frontend/backend PDF: {web_pdf} ({web_pdf.stat().st_size} bytes)")
    print(f"Red-box PDF: {redbox_pdf} ({redbox_pdf.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
