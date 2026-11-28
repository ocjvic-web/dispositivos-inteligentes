import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from playwright.sync_api import sync_playwright


ROOT_DIR = Path(__file__).resolve().parents[1]
REPORT_DIR = Path(
    os.environ.get(
        "TEST_RESULTS_DIR",
        str(Path(tempfile.gettempdir()) / "biomedica-smarttv-test-results"),
    )
)
OBSERVATIONS_PATH = Path(
    os.environ.get(
        "TEST_OBSERVATIONS_PATH",
        str(REPORT_DIR / "site-test-observations.json"),
    )
)
API_PROBE_RESULTS = []
UI_ACTION_RESULTS = []


def _free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


@pytest.fixture(scope="session")
def site_base_url():
    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    environment = os.environ.copy()
    environment.update(
        {
            "PORT": str(port),
            "SESSION_SECRET": "isolated-test-session-secret",
            "SUPABASE_URL": "",
            "SUPABASE_PUBLISHABLE_KEY": "",
            "ADMIN_USERNAME": "",
            "ADMIN_PASSWORD": "",
        }
    )
    process = subprocess.Popen(
        ["node", "server.js"],
        cwd=ROOT_DIR,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"Local website server exited with code {process.returncode}.")
            try:
                with urllib.request.urlopen(base_url, timeout=1) as response:
                    if response.status == 200:
                        break
            except (OSError, urllib.error.URLError):
                time.sleep(0.2)
        else:
            raise RuntimeError("Local website server did not become ready within 30 seconds.")
        yield base_url
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as playwright:
        instance = playwright.chromium.launch()
        yield instance
        instance.close()


@pytest.fixture
def page(browser):
    context = browser.new_context()
    instance = context.new_page()
    yield instance
    context.close()


@pytest.fixture
def record_button_action(page):
    active_action = {"button": None, "responses": []}
    request_starts = {}

    def on_request(request):
        parsed = urlsplit(request.url)
        if parsed.path.startswith("/api/") or parsed.path == "/config.json":
            request_starts[request] = (time.perf_counter(), active_action["button"])

    def on_response(response):
        started = request_starts.pop(response.request, None)
        if started is None:
            return
        start_time, button_name = started
        parsed = urlsplit(response.url)
        result = {
            "buttonName": button_name or "page/navigation",
            "method": response.request.method,
            "endpoint": parsed.path,
            "httpStatus": response.status,
            "durationMs": round((time.perf_counter() - start_time) * 1000, 2),
        }
        active_action["responses"].append(result)
        UI_ACTION_RESULTS.append(result)

    page.on("request", on_request)
    page.on("response", on_response)

    def click(button_name):
        active_action["button"] = button_name
        active_action["responses"] = []
        started = time.perf_counter()
        page.get_by_role("button", name=button_name, exact=True).click()
        page.wait_for_timeout(250)
        action = {
            "buttonName": button_name,
            "actionDurationMs": round((time.perf_counter() - started) * 1000, 2),
            "endpoint": "N/A (acción local sin solicitud HTTP)",
            "httpStatus": "N/A",
            "responses": list(active_action["responses"]),
        }
        if active_action["responses"]:
            action["endpoint"] = active_action["responses"][0]["endpoint"]
            action["httpStatus"] = active_action["responses"][0]["httpStatus"]
        UI_ACTION_RESULTS.append(action)
        active_action["button"] = None
        return action

    return click


def pytest_sessionfinish(session, exitstatus):
    OBSERVATIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    OBSERVATIONS_PATH.write_text(
        json.dumps(
            {
                "exitStatus": exitstatus,
                "apiProbeCount": len(API_PROBE_RESULTS),
                "apiProbes": API_PROBE_RESULTS,
                "uiActionCount": sum(
                    1 for result in UI_ACTION_RESULTS if "actionDurationMs" in result
                ),
                "uiActionsAndResponses": UI_ACTION_RESULTS,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


@pytest.fixture
def api_probe_recorder():
    def record(*, case_name, method, endpoint, status, duration_ms):
        API_PROBE_RESULTS.append(
            {
                "testCase": case_name,
                "method": method,
                "endpoint": endpoint,
                "httpStatus": status,
                "durationMs": duration_ms,
            }
        )

    return record
