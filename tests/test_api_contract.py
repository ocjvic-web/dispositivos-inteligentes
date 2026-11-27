import json
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import pytest

API_CONTRACTS = [
    ("config", "GET", "/config.json", None, 503),
    ("core-reports", "GET", "/api/core/reports", None, 401),
    ("review-report", "PATCH", "/api/core/reports/test-report/review", None, 401),
    ("chat-notification", "POST", "/api/core/chat/notifications", None, 401),
    ("devices", "GET", "/api/devices", None, 200),
    ("status-full", "GET", "/api/status", None, 200),
    ("status-compact", "GET", "/api/status?compact=1", None, 200),
    ("tv-status", "GET", "/api/tv/status", None, 200),
    ("tv-pair-invalid", "POST", "/api/tv/pair", {}, 404),
    ("tv-unpair-invalid", "POST", "/api/tv/unpair", {"tvId": "missing-test-tv"}, 404),
    ("telemetry-history", "GET", "/api/telemetry/history", None, 200),
    (
        "telemetry-history-unknown-device",
        "GET",
        "/api/telemetry/history?wearableId=missing-test-device",
        None,
        200,
    ),
    ("tv-feed-unconfigured", "GET", "/api/tv-feed", None, 503),
    ("telemetry-invalid", "POST", "/api/telemetry", {}, 400),
    ("select-wearable-invalid", "POST", "/api/select-wearable", {}, 400),
    ("pair-invalid", "POST", "/api/pair", {}, 400),
    ("admin-root-retired", "GET", "/api/admin/", None, 410),
    ("admin-login-retired", "POST", "/api/admin/login", None, 410),
    ("admin-session-retired", "GET", "/api/admin/session", None, 410),
    ("admin-users-read-retired", "GET", "/api/admin/users", None, 410),
    ("admin-users-create-retired", "POST", "/api/admin/users", None, 410),
    ("admin-user-update-retired", "PATCH", "/api/admin/users/test-user", None, 410),
    ("admin-appointments-read-retired", "GET", "/api/admin/appointments", None, 410),
    ("admin-appointments-create-retired", "POST", "/api/admin/appointments", None, 410),
    (
        "admin-appointment-update-retired",
        "PATCH",
        "/api/admin/appointments/test-appointment",
        None,
        410,
    ),
    ("disconnect-devices", "POST", "/api/unpair", {}, 200),
]

PROBES_PER_CONTRACT = 40
API_PROBE_CASES = [
    (contract, probe_number)
    for contract in API_CONTRACTS
    for probe_number in range(PROBES_PER_CONTRACT)
]
assert len(API_PROBE_CASES) >= 1000


@pytest.mark.parametrize(
    ("contract", "probe_number"),
    API_PROBE_CASES,
    ids=[
        f"{contract[0]}-probe-{probe_number + 1:02d}"
        for contract, probe_number in API_PROBE_CASES
    ],
)
@pytest.mark.backend
def test_site_api_contract_matrix(
    site_base_url,
    api_probe_recorder,
    contract,
    probe_number,
):
    name, method, path, payload, expected_status = contract
    parsed = urlsplit(path)
    query = parse_qsl(parsed.query, keep_blank_values=True)
    query.append(("probe", str(probe_number)))
    probe_path = urlunsplit(
        ("", "", parsed.path, urlencode(query), ""),
    )
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{site_base_url}{probe_path}",
        data=body,
        method=method,
        headers={
            "Accept": "application/json",
            "X-Test-Case": f"{name}-{probe_number:02d}",
            **({"Content-Type": "application/json"} if body is not None else {}),
        },
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status = response.status
            response_body = response.read()
            content_type = response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as error:
        status = error.code
        response_body = error.read()
        content_type = error.headers.get("Content-Type", "")
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    endpoint = parsed.path
    case_name = f"{name}-probe-{probe_number + 1:02d}"
    api_probe_recorder(
        case_name=case_name,
        method=method,
        endpoint=endpoint,
        status=status,
        duration_ms=duration_ms,
    )
    assert status == expected_status, (
        f"{case_name}: {method} {endpoint} returned HTTP {status} "
        f"in {duration_ms} ms; expected {expected_status}."
    )
    assert "application/json" in content_type, (
        f"{case_name}: {method} {endpoint} returned unexpected content type "
        f"{content_type!r}."
    )
    response_json = json.loads(response_body)
    assert isinstance(response_json, (dict, list)), (
        f"{case_name}: {method} {endpoint} did not return a JSON object or array."
    )
    expected_fields = {
        "devices": {"wearables", "tvs", "activeWearableId", "activeTvId", "tvPaired"},
        "status-full": {
            "wearables",
            "tvs",
            "activeWearableId",
            "tvPaired",
            "lastTelemetry",
            "telemetryHistory",
        },
        "status-compact": {
            "activeWearableId",
            "tvPaired",
            "lastTelemetry",
            "telemetryHistory",
        },
        "tv-status": {"tvs", "activeTvId", "tvPaired", "tv"},
        "telemetry-history": {"wearableId", "points"},
        "telemetry-history-unknown-device": {"wearableId", "points"},
    }.get(name)
    if expected_fields:
        assert expected_fields.issubset(response_json), (
            f"{case_name}: {method} {endpoint} is missing fields "
            f"{expected_fields - response_json.keys()}."
        )
