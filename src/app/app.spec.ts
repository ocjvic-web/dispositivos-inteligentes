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
      'Reportes clínicos',
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

    app.portalProfile.role = 'admin';
    expect(app.navigationItems.map((item) => item.label)).toContain('Reportes clínicos');
  });

  it('renders the task board with persisted task states and no demo widget', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.portalProfile = {
      id: 'doctor-user',
      email: 'doctor@example.com',
      first_name: 'Médico',
      last_name: 'Prueba',
      role: 'doctor',
      is_active: true,
    };
    app.tareas = [{
      id: 'task-1',
      titulo: 'Revisar mediciones',
      descripcion: 'Validar lecturas recientes.',
      prioridad: 'alta',
      estado: 'en_progreso',
      fechaLimite: '2026-11-20',
      asignadoA: 'Médico Prueba',
      categoria: 'Monitoreo',
    }];
    fixture.detectChanges();
    app.vistaActiva = 'dashboard';
    fixture.detectChanges();

    const dashboard = fixture.nativeElement.querySelector('.dashboard-wrapper') as HTMLElement;
    expect(dashboard.querySelectorAll('.kanban-column').length).toBe(4);
    expect(dashboard.textContent).toContain('Revisar mediciones');
    expect(dashboard.textContent).not.toContain('StatsWidget');
    expect(dashboard.textContent).not.toContain('microapp Flutter');
    expect(dashboard.querySelector('select[id^="task-status-"]')).toBeNull();
    expect((dashboard.querySelector('.task-card') as HTMLElement).draggable).toBeTrue();
  });

  it('moves a task to the dropped Kanban column', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    const task = {
      id: 'task-1',
      titulo: 'Revisar mediciones',
      descripcion: '',
      prioridad: 'media' as const,
      estado: 'pendiente' as const,
      fechaLimite: '',
      asignadoA: 'Médico Prueba',
      categoria: 'Monitoreo',
    };
    app.tareas = [task];
    const dataTransfer = new DataTransfer();
    const dragStart = new DragEvent('dragstart', { dataTransfer });
    const drop = new DragEvent('drop', { dataTransfer });
    const updateStatus = spyOn(app, 'cambiarEstado').and.resolveTo();

    app.iniciarArrastre(dragStart, task);
    app.soltarTarea(drop, 'completada');

    expect(updateStatus).toHaveBeenCalledWith(task, 'completada');
    expect(app.draggedTask).toBeNull();
    expect(app.dropTargetStatus).toBeNull();
  });

  it('moves touch-dragged tasks using the handle and destination column', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.portalProfile = {
      id: 'doctor-user',
      email: 'doctor@example.com',
      first_name: 'Médico',
      last_name: 'Prueba',
      role: 'doctor',
      is_active: true,
    };
    const task = {
      id: 'task-touch',
      titulo: 'Revisar mediciones',
      descripcion: '',
      prioridad: 'media' as const,
      estado: 'pendiente' as const,
      fechaLimite: '',
      asignadoA: 'Médico Prueba',
      categoria: 'Monitoreo',
    };
    app.tareas = [task];
    fixture.detectChanges();
    app.vistaActiva = 'dashboard';
    fixture.detectChanges();

    const handle = fixture.nativeElement.querySelector('.task-drag-handle') as HTMLElement;
    const destination = fixture.nativeElement.querySelector(
      '.kanban-column[data-kanban-status="completada"]',
    ) as HTMLElement;
    spyOn(handle, 'setPointerCapture');
    spyOn(document, 'elementFromPoint').and.returnValue(destination);
    const updateStatus = spyOn(app, 'cambiarEstado').and.resolveTo();
    const pointerDown = new PointerEvent('pointerdown', {
      pointerType: 'touch',
      isPrimary: true,
      pointerId: 7,
      clientX: 20,
      clientY: 20,
    });
    Object.defineProperty(pointerDown, 'currentTarget', { value: handle });

    app.iniciarArrastrePointer(pointerDown, task);
    app.moverArrastrePointer(new PointerEvent('pointermove', {
      pointerType: 'touch',
      isPrimary: true,
      pointerId: 7,
      clientX: 40,
      clientY: 40,
    }));
    app.soltarArrastrePointer(new PointerEvent('pointerup', {
      pointerType: 'touch',
      isPrimary: true,
      pointerId: 7,
      clientX: 40,
      clientY: 40,
    }));

    expect(updateStatus).toHaveBeenCalledWith(task, 'completada');
    expect(app.draggedTask).toBeNull();
    expect(app.dropTargetStatus).toBeNull();
  });

  it('derives platform statistics from available data instead of fixed examples', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.portalProfile = {
      id: 'doctor-user',
      email: 'doctor@example.com',
      first_name: 'Médico',
      last_name: 'Prueba',
      role: 'doctor',
      is_active: true,
    };
    app.dashboardMetrics = {
      patientCount: 7,
      measurementCount: 12,
      monthlyMeasurements: [],
    };
    app.reportStatsAvailable = true;
    app.portalReports = [{ id: 'report-1' }, { id: 'report-2' }, { id: 'report-3' }];
    app.wearables = [{
      id: 'wearable-1',
      nombre: 'Reloj de prueba',
      modelo: 'Round',
      estado: 'Conectado',
      bateria: 80,
      ritmoCardiaco: 72,
      spo2: 98,
      temperatura: 36.5,
      ubicacion: 'Prueba',
    }];

    expect(app.statsHome.map((stat) => stat.valor)).toEqual(['7', '1', '12', '3']);
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
