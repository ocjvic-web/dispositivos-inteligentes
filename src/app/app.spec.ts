import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    window.history.replaceState({}, '', '/');
    spyOn(window, 'fetch').and.callFake(async (input, init) => {
      const requestUrl = String(input);
      if (requestUrl.endsWith('/api/status')) {
        return new Response(JSON.stringify({ wearables: [], tvs: [], tvPaired: false }));
      }
      if (requestUrl.endsWith('/api/tv-feed')) {
        return new Response(JSON.stringify({ queue: [], currentTurn: null }));
      }
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      return new Response(JSON.stringify({ message: 'Supabase is not configured.' }), { status: 503 });
    });
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the BioMedica home title', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Centro de Innovación Biomédica');
  });

  it('shows only public navigation and account actions to visitors', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();

    expect(app.navigationItems.map((item) => item.label)).toEqual([
      'Inicio',
      'Estadísticas',
      'Contacto',
    ]);
    expect(fixture.nativeElement.textContent).toContain('Iniciar sesión');
    expect(fixture.nativeElement.textContent).toContain('Registro');

    app.navegar('dashboard');
    expect(app.vistaActiva).toBe('admin');
  });

  it('shows role-specific menus and prevents patients from opening clinician modules', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.portalProfile = {
      id: 'patient-user',
      email: 'patient@example.com',
      first_name: 'Paciente',
      last_name: 'Prueba',
      role: 'patient',
      is_active: true,
    };
    expect(app.navigationItems.map((item) => item.label)).toEqual([
      'Inicio',
      'Reportes',
      'Mis signos vitales',
      'Historial',
      'Perfil',
      'Mi consulta',
    ]);
    app.navegar('webos');
    expect(app.vistaActiva).toBe('patient-profile');

    app.portalProfile.role = 'doctor';
    expect(app.navigationItems.map((item) => item.label)).toEqual([
      'Inicio',
      'Wearables',
      'Turnos',
      'Dashboard',
      'Conexiones',
      'Chats',
    ]);
    app.navegar('doctor-chats');
    expect(app.vistaActiva).toBe('doctor-chats');
    app.navegar('wearable');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Flutter Wearable Biomédico');
    expect(fixture.nativeElement.textContent).toContain('Catálogo de Wearables Biomédicos');
  });

  it('opens the current user profile for patients, doctors, and administrators', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.portalReady = true;
    app.portalProfile = {
      id: 'profile-user',
      email: 'person@example.com',
      first_name: 'Bio',
      last_name: 'Medica',
      role: 'patient',
      is_active: true,
      date_of_birth: '1990-01-01',
      chronic_conditions: ['Asma'],
    };

    for (const role of ['patient', 'doctor', 'admin'] as const) {
      app.portalProfile = { ...app.portalProfile, role };
      app.navegar('inicio');
      fixture.detectChanges();
      const profileButton = fixture.nativeElement.querySelector('.header-profile-button') as HTMLButtonElement;
      profileButton.click();
      fixture.detectChanges();

      expect(app.vistaActiva).toBe('patient-profile');
      expect(fixture.nativeElement.textContent).toContain('Mi perfil');
      expect(fixture.nativeElement.textContent).toContain('Bio Medica');
      expect(fixture.nativeElement.textContent).toContain('person@example.com');
      expect(fixture.nativeElement.textContent).toContain(
        role === 'admin' ? 'Administrador' : role === 'doctor' ? 'Médico' : 'Paciente',
      );
    }
  });

  it('offers patient and doctor registration with role-specific fields', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    app.vistaActiva = 'admin';
    app.portalReady = true;
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const registerLink = [...compiled.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Regístrate'));
    expect(registerLink).toBeTruthy();
    registerLink?.click();
    fixture.detectChanges();

    expect(compiled.querySelector('#registration-first-name')).toBeTruthy();
    expect(compiled.querySelector('#registration-date-of-birth')).toBeTruthy();
    expect(compiled.querySelector('#registration-email')).toBeTruthy();
    expect(compiled.textContent).toContain('Padecimientos crónicos (opcional)');
    expect(compiled.querySelector('#professional-license')).toBeFalsy();

    const doctorChoice = [...compiled.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Médico');
    doctorChoice?.click();
    fixture.detectChanges();

    expect(compiled.querySelector('#professional-license')).toBeTruthy();
    expect(compiled.querySelector('#medical-specialty')).toBeTruthy();
    expect(compiled.textContent).toContain('pendientes de revisión');
    expect(compiled.querySelector('#other-chronic-condition')).toBeFalsy();
  });

  it('requires reading the terms before allowing registration acceptance', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    app.vistaActiva = 'admin';
    app.portalReady = true;
    app.portalAuthMode = 'register';
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const termsLink = [...compiled.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Leer términos y condiciones'));
    termsLink?.click();
    fixture.detectChanges();

    expect(compiled.querySelector('[role="dialog"]')).toBeTruthy();
    expect(compiled.textContent).toContain('Versión 1.0');
    const accept = [...compiled.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((button) => button.textContent?.includes('Aceptar y volver'));
    expect(accept?.disabled).toBeTrue();
    expect(app.portalRegistration.termsAccepted).toBeFalse();

    const termsContent = document.createElement('div');
    Object.defineProperties(termsContent, {
      scrollHeight: { value: 500 },
      scrollTop: { value: 410 },
      clientHeight: { value: 100 },
    });
    const scrollEvent = new Event('scroll');
    termsContent.dispatchEvent(scrollEvent);
    app.onPortalTermsScroll(scrollEvent);
    expect(app.portalTermsReadToEnd).toBeTrue();

    app.portalTermsAcceptedInDialog = true;
    app.acceptPortalTerms();
    expect(app.portalRegistration.termsAccepted).toBeTrue();
    expect(app.portalTermsOpen).toBeFalse();
  });

  it('keeps an unapproved medical registration out of the patient portal', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    app.vistaActiva = 'admin';
    app.portalReady = true;
    app.portalProfile = {
      id: 'doctor-applicant',
      email: 'doctor@example.com',
      first_name: 'Médica',
      last_name: 'Prueba',
      role: 'patient',
      is_active: true,
      doctor_application_status: 'pending',
    };
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Pendiente de revisión administrativa');
    expect(compiled.textContent).toContain('Un administrador debe verificar tus datos antes de asignarte pacientes');
    expect(compiled.textContent).not.toContain('Mis médicos');
  });
});
