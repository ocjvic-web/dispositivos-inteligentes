import { ClinicalPortalService } from './clinical-portal.service';

describe('ClinicalPortalService runtime configuration', () => {
  const runtimeConfig = JSON.stringify({
    supabaseUrl: 'https://project.supabase.co',
    supabasePublishableKey: 'public-test-key',
  });

  it('surfaces an unavailable configuration endpoint', async () => {
    const fetcher = jasmine.createSpy('fetch').and.resolveTo(
      new Response('unavailable', { status: 503 }),
    );
    const service = new ClinicalPortalService(fetcher, '/config.json');

    await expectAsync(service.initialize()).toBeRejectedWithError(
      'No se pudo cargar la configuración de Supabase (HTTP 503).',
    );
    expect(fetcher).toHaveBeenCalledWith('/config.json', { cache: 'no-store' });
  });

  it('rejects incomplete runtime configuration', async () => {
    const fetcher = jasmine.createSpy('fetch').and.resolveTo(
      new Response(JSON.stringify({ supabaseUrl: 'https://project.supabase.co' })),
    );
    const service = new ClinicalPortalService(fetcher, '/config.json');

    await expectAsync(service.initialize()).toBeRejectedWithError(
      'Falta configurar Supabase para el portal web.',
    );
  });

  it('initializes without a saved user session when configuration is valid', async () => {
    const fetcher = jasmine.createSpy('fetch').and.resolveTo(
      new Response(runtimeConfig),
    );
    const service = new ClinicalPortalService(fetcher, '/config.json');

    await expectAsync(service.initialize()).toBeResolvedTo(null);
  });

  it('registers patients with the mobile profile fields and current terms acceptance', async () => {
    let signupPayload: { email?: string; data?: Record<string, unknown> } = {};
    const fetcher = jasmine.createSpy('fetch').and.callFake(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/config.json') return new Response(runtimeConfig);
        if (url.includes('/auth/v1/signup')) {
          signupPayload = JSON.parse(String(init?.body)) as typeof signupPayload;
          return new Response(JSON.stringify({
            user: {
              id: 'patient-user-id',
              aud: 'authenticated',
              role: 'authenticated',
              email: 'patient@example.com',
              app_metadata: {},
              user_metadata: {},
              created_at: '2026-11-06T00:00:00Z',
            },
            session: null,
          }));
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    );
    const service = new ClinicalPortalService(fetcher, '/config.json');
    await service.initialize();

    await expectAsync(service.register({
      role: 'patient',
      firstName: 'Ana',
      lastName: 'Prueba',
      dateOfBirth: '1990-04-15',
      chronicConditions: ['Asma'],
      otherChronicCondition: '',
      email: ' PATIENT@example.com ',
      password: 'ClaveSegura123',
    })).toBeResolvedTo(null);

    const metadata = signupPayload.data ?? {};
    expect(signupPayload.email).toBe('patient@example.com');
    expect(metadata['first_name']).toBe('Ana');
    expect(metadata['last_name']).toBe('Prueba');
    expect(metadata['date_of_birth']).toBe('1990-04-15');
    expect(metadata['chronic_conditions']).toEqual(['Asma']);
    expect(metadata['registration_role']).toBe('patient');
    expect(metadata['terms_accepted']).toBe(true);
    expect(metadata['terms_version']).toBe('1.0');
  });

  it('stores doctor credentials in signup metadata without granting the doctor role', async () => {
    let signupPayload: { email?: string; data?: Record<string, unknown> } = {};
    const fetcher = jasmine.createSpy('fetch').and.callFake(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/config.json') return new Response(runtimeConfig);
        if (url.includes('/auth/v1/signup')) {
          signupPayload = JSON.parse(String(init?.body)) as typeof signupPayload;
          return new Response(JSON.stringify({
            user: {
              id: 'doctor-user-id',
              aud: 'authenticated',
              role: 'authenticated',
              email: 'doctor@example.com',
              app_metadata: {},
              user_metadata: {},
              created_at: '2026-11-06T00:00:00Z',
            },
            session: null,
          }));
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    );
    const service = new ClinicalPortalService(fetcher, '/config.json');
    await service.initialize();

    await expectAsync(service.register({
      role: 'doctor',
      firstName: 'Médica',
      lastName: 'Prueba',
      dateOfBirth: '1985-02-10',
      chronicConditions: [],
      otherChronicCondition: '',
      email: 'doctor@example.com',
      password: 'ClaveSegura123',
      professionalLicense: 'CED-123456',
      specialty: 'Medicina interna',
      specialtyLicense: 'ESP-123456',
      institution: 'Hospital de prueba',
      contactPhone: '5551234567',
    })).toBeResolvedTo(null);

    const metadata = signupPayload.data ?? {};
    expect(metadata['registration_role']).toBe('doctor');
    expect(metadata['professional_license']).toBe('CED-123456');
    expect(metadata['specialty']).toBe('Medicina interna');
    expect(metadata['specialty_license']).toBe('ESP-123456');
    expect(metadata['institution']).toBe('Hospital de prueba');
    expect(metadata['contact_phone']).toBe('5551234567');
    expect(metadata['terms_accepted']).toBe(true);
    expect(metadata['role']).toBeUndefined();
  });
});
