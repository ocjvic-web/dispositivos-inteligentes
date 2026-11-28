import pytest
from playwright.sync_api import expect


@pytest.mark.frontend
def test_home_carousel_buttons_and_response_observations(
    page,
    site_base_url,
    record_button_action,
):
    response = page.goto(site_base_url, wait_until="domcontentloaded")
    assert response is not None and response.status == 200
    expect(page).to_have_title("PaginaWeb")
    expect(
        page.get_by_role("heading", name="Centro de Innovación Biomédica"),
    ).to_be_visible()

    record_button_action("Siguiente")
    expect(
        page.get_by_role("heading", name="Telemetría Hospitalaria en Tiempo Real"),
    ).to_be_visible()
    record_button_action("Anterior")
    expect(
        page.get_by_role("heading", name="Centro de Innovación Biomédica"),
    ).to_be_visible()


@pytest.mark.frontend
def test_turns_screen_hides_vitals_and_safety_alerts(
    page,
    site_base_url,
):
    response = page.goto(f"{site_base_url}/tv", wait_until="domcontentloaded")
    assert response is not None and response.status == 200
    expect(page.get_by_role("heading", name="Inicia sesión en BioMedica")).to_be_visible()
    expect(page.get_by_text("Signos vitales de la app", exact=True)).to_have_count(0)
    expect(page.get_by_text("Seguridad clínica", exact=True)).to_have_count(0)
    expect(page.get_by_text("SpO₂ por debajo del umbral", exact=True)).to_have_count(0)


@pytest.mark.frontend
def test_protected_clinical_portal_requires_login(
    page,
    site_base_url,
    record_button_action,
):
    response = page.goto(f"{site_base_url}/admin", wait_until="domcontentloaded")
    assert response is not None and response.status == 200
    expect(page.get_by_role("heading", name="Inicia sesión en BioMedica")).to_be_visible()
    expect(page.get_by_role("textbox", name="Correo electrónico")).to_be_visible()
    expect(page.get_by_role("textbox", name="Contraseña")).to_be_visible()
    record_button_action("Mostrar contraseña")
    expect(page.get_by_label("Ocultar contraseña")).to_be_visible()
