import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    window.history.replaceState({}, '', '/');
    spyOn(window, 'fetch').and.callFake(async (input, init) => {
      const requestUrl = String(input);
      if (requestUrl.endsWith('/api/tv/status')) {
        return new Response(JSON.stringify({ tvs: [], tvPaired: false }));
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
      'Turnos',
      'Dashboard',
      'Conexiones',
      'Chats',
    ]);
    app.navegar('doctor-chats');
    expect(app.vistaActiva).toBe('doctor-chats');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Wearables');
    expect(fixture.nativeElement.querySelector('.fuse-search-wrap')).toBeNull();
    app.navegar('webos');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Smart TVs');
    expect(fixture.nativeElement.textContent).not.toContain('Wearables');
    expect(fixture.nativeElement.textContent).not.toContain('vincular reloj');

    app.portalProfile.role = 'admin';
    expect(app.navigationItems.map((item) => item.label)).toContain('Reportes clínicos');
  });

  it('keeps patient vitals and clinical alerts off the public turns screen', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.portalProfile = {
      id: 'admin-user',
      email: 'admin@example.com',
      first_name: 'Admin',
      last_name: 'Prueba',
      role: 'admin',
      is_active: true,
    };
    app.portalMeasurements = [{
      id: 'measurement-1',
      owner_uid: 'patient-user',
      reading_at: '2026-11-27T12:00:00Z',
      heart_rate_bpm: 75,
      oxygen_saturation_percent: 90,
      body_temperature_celsius: 36.5,
    }];
    app.navegar('tvwall');
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Siguientes turnos');
    expect(text).not.toContain('Signos vitales de la app');
    expect(text).not.toContain('Seguridad clínica');
    expect(text).not.toContain('SpO₂ por debajo del umbral');
    expect(fixture.nativeElement.querySelector('.tv-alert-list')).toBeNull();
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
    expect(app.statsHome.map((stat) => stat.valor)).toEqual(['7', '12', '3']);
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

  it('toggles password visibility on login and registration forms', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.portalReady = true;
    app.navegar('admin');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const loginPassword = compiled.querySelector('#portal-password') as HTMLInputElement;
    const loginToggle = compiled.querySelector('.portal-password-toggle') as HTMLButtonElement;
    expect(loginPassword.type).toBe('password');
    loginToggle.click();
    fixture.detectChanges();
    expect(loginPassword.type).toBe('text');
    loginToggle.click();
    fixture.detectChanges();
    expect(loginPassword.type).toBe('password');

    app.setPortalAuthMode('register');
    fixture.detectChanges();
    const registrationPassword = compiled.querySelector('#registration-password') as HTMLInputElement;
    const confirmationPassword = compiled.querySelector('#registration-confirm-password') as HTMLInputElement;
    const registrationToggle = compiled.querySelector('.portal-password-toggle-register') as HTMLButtonElement;
    expect(registrationPassword.type).toBe('password');
    expect(confirmationPassword.type).toBe('password');
    registrationToggle.click();
    fixture.detectChanges();
    expect(registrationPassword.type).toBe('text');
    expect(confirmationPassword.type).toBe('text');
  });

  it('places clinical assignments in the open admin column above turn management', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    app.portalReady = true;
    app.portalProfile = {
      id: 'admin-user',
      email: 'admin@example.com',
      first_name: 'Admin',
      last_name: 'Prueba',
      role: 'admin',
      is_active: true,
    };
    app.navegar('admin');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const clinicalColumn = compiled.querySelector('.admin-clinical-column') as HTMLElement;
    const requests = clinicalColumn.querySelector('.doctor-requests-card');
    const assignments = clinicalColumn.querySelector('.portal-assignment-card');
    const turns = clinicalColumn.querySelector('.portal-turns-card');
    expect(requests).toBeTruthy();
    expect(assignments).toBeTruthy();
    expect(turns).toBeTruthy();
    expect(getComputedStyle(assignments as HTMLElement).order).toBe('2');
    expect(getComputedStyle(turns as HTMLElement).order).toBe('3');
  });

  it('shows patient health records and assigned turn controls to doctors', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    window.history.replaceState({}, '', '/reportes-clinicos');
    spyOn(app, 'initializePortal').and.resolveTo();
    app.portalReady = true;
    app.portalProfile = {
      id: 'doctor-user',
      email: 'doctor@example.com',
      first_name: 'Doctora',
      last_name: 'Prueba',
      role: 'doctor',
      is_active: true,
    };
    app.portalPatients = [{
      id: 'patient-user',
      email: 'patient@example.com',
      first_name: 'Paciente',
      last_name: 'Prueba',
      role: 'patient',
      is_active: true,
      date_of_birth: '1990-01-02',
      chronic_conditions: ['Hipertensión arterial'],
    }, {
      id: 'patient-user-2',
      email: 'patient2@example.com',
      first_name: 'Otra',
      last_name: 'Paciente',
      role: 'patient',
      is_active: true,
    }];
    app.portalReports = [{
      id: 'report-1',
      ownerUid: 'patient-user',
      malestar: 'Palpitaciones',
      priority: 'Media',
      reviewStatus: 'pending',
      createdAt: '2026-11-27T12:00:00Z',
    }];
    app.portalMeasurements = [{
      id: 'measurement-1',
      owner_uid: 'patient-user',
      reading_at: '2026-11-27T12:00:00Z',
      device_name: 'Galaxy Watch',
      heart_rate_bpm: 82,
      sensor_readings: {
        accelerometer: { label: 'Acelerómetro', unit: 'm/s²', values: [0.2, 0.4] },
      },
    }];
    app.portalHealthConnectRecords = [{
      id: 'health-record-1',
      owner_uid: 'patient-user',
      data_type: 'BLOOD_OXYGEN',
      label: 'Oxígeno en sangre (SpO₂)',
      value: 98,
      unit: 'PERCENT',
      recorded_at: '2026-11-27T11:00:00Z',
      ended_at: '2026-11-27T11:00:00Z',
      source_name: 'Samsung Health',
      source_id: 'com.sec.android.app.shealth',
    }, {
      id: 'health-record-2',
      owner_uid: 'patient-user-2',
      data_type: 'HEART_RATE',
      label: 'Frecuencia cardiaca',
      value: 72,
      unit: 'BPM',
      recorded_at: '2026-11-27T10:00:00Z',
      ended_at: '2026-11-27T10:00:00Z',
      source_name: 'Samsung Health',
      source_id: 'com.sec.android.app.shealth',
    }, {
      id: 'other-health-connect-record',
      owner_uid: 'patient-user',
      data_type: 'STEPS',
      label: 'Pasos',
      value: 2500,
      unit: 'COUNT',
      recorded_at: '2026-11-27T09:00:00Z',
      ended_at: '2026-11-27T09:00:00Z',
      source_name: 'Google Fit',
      source_id: 'com.google.android.apps.fitness',
    }];
    app.clinicTurns = [{
      id: 'turn-1',
      ticket_code: 'T-000001',
      patient_uid: 'patient-user',
      service: 'Consulta general',
      room: 'Consultorio 1',
      priority: 'media',
      status: 'en_espera',
      eta_minutes: 10,
      created_at: '2026-11-27T11:00:00Z',
    }];
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Antecedentes registrados: Hipertensión arterial');
    expect(compiled.textContent).not.toContain('Signos vitales recientes de la app móvil');
    expect(compiled.textContent).not.toContain('Acelerómetro:');
    expect(compiled.textContent).toContain('98 %');
    expect(compiled.textContent).toContain('Samsung Health');
    expect(compiled.textContent).not.toContain('Google Fit');
    expect(compiled.querySelectorAll('.clinical-health-connect-patient-group').length).toBe(2);
    expect(compiled.querySelector('#health-connect-search')).toBeTruthy();
    expect(compiled.querySelector('#health-connect-patient-filter')).toBeTruthy();
    expect(compiled.querySelector('#health-connect-type-filter')).toBeTruthy();
    expect(compiled.querySelector('#health-connect-date-filter')).toBeTruthy();
    expect(compiled.querySelector('#doctor-turn-patient')).toBeTruthy();
    expect(compiled.textContent).toContain('T-000001 · Paciente Prueba');
  });

  it('filters Health Connect records by patient, data type, search, and date range', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    window.history.replaceState({}, '', '/reportes-clinicos');
    spyOn(app, 'initializePortal').and.resolveTo();
    app.portalReady = true;
    app.portalProfile = {
      id: 'doctor-user',
      email: 'doctor@example.com',
      first_name: 'Doctora',
      last_name: 'Prueba',
      role: 'doctor',
      is_active: true,
    };
    app.portalPatients = [{
      id: 'patient-jose',
      email: 'jose@example.com',
      first_name: 'José',
      last_name: 'Ávila',
      role: 'patient',
      is_active: true,
    }, {
      id: 'patient-ana',
      email: 'ana@example.com',
      first_name: 'Ana',
      last_name: 'Ruiz',
      role: 'patient',
      is_active: true,
    }];
    app.portalHealthConnectRecords = [{
      id: 'recent-heart-rate',
      owner_uid: 'patient-jose',
      data_type: 'HEART_RATE',
      label: 'Frecuencia cardiaca',
      value: 72,
      unit: 'BPM',
      recorded_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      source_name: 'Samsung Health',
      source_id: 'com.sec.android.app.shealth',
    }, {
      id: 'older-oxygen',
      owner_uid: 'patient-ana',
      data_type: 'BLOOD_OXYGEN',
      label: 'Oxígeno en sangre',
      value: 98,
      unit: 'PERCENT',
      recorded_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
      source_name: 'Samsung Health',
      source_id: 'com.sec.android.app.shealth',
    }];
    fixture.detectChanges();

    app.healthConnectSearchTerm = 'jose';
    expect(app.groupedClinicalHealthConnectRecords.map((group) => group.patientUid))
      .toEqual(['patient-jose']);

    app.healthConnectSearchTerm = '';
    app.healthConnectPatientFilter = 'patient-ana';
    expect(app.filteredClinicalHealthConnectRecords.map((record) => record['id']))
      .toEqual(['older-oxygen']);

    app.healthConnectPatientFilter = '';
    app.healthConnectDataTypeFilter = 'BLOOD_OXYGEN';
    expect(app.filteredClinicalHealthConnectRecords.map((record) => record['id']))
      .toEqual(['older-oxygen']);

    app.healthConnectDataTypeFilter = '';
    app.healthConnectDateFilter = '30';
    expect(app.filteredClinicalHealthConnectRecords.map((record) => record['id']))
      .toEqual(['recent-heart-rate']);
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
