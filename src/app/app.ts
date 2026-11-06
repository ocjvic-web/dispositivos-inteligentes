import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { environment } from '../environments/environment';
import {
  ClinicalConversation,
  ClinicalMessage,
  ClinicalMessageType,
  ClinicalPortalService,
  ClinicTurn,
  DashboardMetrics,
  DashboardTask,
  DashboardTaskInput,
  DashboardTaskPriority,
  DashboardTaskStatus,
  DoctorCredentials,
  PortalProfile,
  PortalRegistration,
  PortalRole,
  SupportConversation,
  SupportMessage,
} from './clinical-portal.service';
import Fuse from 'fuse.js';

export type EstadoTarea = DashboardTaskStatus;
export type Prioridad = DashboardTaskPriority;
type VistaActiva =
  | 'inicio'
  | 'dashboard'
  | 'wearable'
  | 'webos'
  | 'tvwall'
  | 'admin'
  | 'contacto'
  | 'estadisticas'
  | 'patient-reports'
  | 'patient-vitals'
  | 'patient-history'
  | 'patient-profile'
  | 'patient-consult'
  | 'doctor-chats'
  | 'clinical-reports'
  | 'support';
interface NavigationItem {
  label: string;
  vista: VistaActiva;
}
type RolAdministrador = 'superadmin' | 'operador' | 'visor';
type EstadoUsuario = 'activo' | 'bloqueado';
type EstadoTurno = 'en_espera' | 'en_atencion' | 'finalizado';

export interface Tarea {
  id: string;
  titulo: string;
  descripcion: string;
  prioridad: Prioridad;
  estado: EstadoTarea;
  fechaLimite: string;
  asignadoA: string;
  categoria: string;
}

interface WearableDevice {
  id: string;
  nombre: string;
  modelo: string;
  estado: 'Conectado' | 'En espera' | 'Sincronizando';
  bateria: number;
  ritmoCardiaco: number;
  spo2: number;
  temperatura: number;
  ubicacion: string;
}

interface TvDevice {
  id: string;
  nombre: string;
  plataforma: string;
  resolucion: string;
  sala: string;
  estado: 'Disponible' | 'Emparejado' | 'En espera';
  appActiva: string;
}

interface TelemetrySnapshot {
  wearableId: string;
  heartRate: number;
  spo2: number;
  temperature: number;
  battery: number;
  steps?: number;
  stress?: number;
  respiratoryRate?: number;
  hrv?: number;
  signalQuality?: number;
  perfusionIndex?: number;
  sequence?: number;
  source?: string;
  timestamp?: string;
}

interface UsuarioAdministrador {
  id: string;
  username: string;
  displayName: string;
  role: RolAdministrador;
  status: EstadoUsuario;
  createdAt: string;
  lastLoginAt?: string | null;
}

interface SesionAdministrador {
  username: string;
  displayName: string;
  role: RolAdministrador;
  expiresAt: string;
}

interface TurnoAtencion {
  id: string;
  codigo: string;
  paciente: string;
  servicio: string;
  sala: string;
  prioridad: Prioridad;
  estado: EstadoTurno;
  etaMin: number;
  updatedAt: string;
}

const wearablePlaceholder: WearableDevice = {
  id: 'sin-wearable',
  nombre: 'Sin wearable conectado',
  modelo: 'Esperando primer smartwatch remoto',
  estado: 'En espera',
  bateria: 0,
  ritmoCardiaco: 0,
  spo2: 0,
  temperatura: 0,
  ubicacion: 'Conecta un reloj desde Render para verlo aquí',
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css', './portal.css']
})
export class App implements OnInit, OnDestroy {
  private readonly adminTokenStorageKey = 'biomedica.admin.token';
  private readonly clinicalPortal = new ClinicalPortalService(
    (...args) => window.fetch(...args),
    `${environment.apiUrl}/config.json`,
    `${environment.apiUrl}/api/core/reports`,
  );
  private readonly routeMap: Record<VistaActiva, string> = {
    inicio: '/',
    dashboard: '/dashboard',
    wearable: '/wearable',
    webos: '/webos',
    tvwall: '/tv',
    admin: '/admin',
    contacto: '/contacto',
    estadisticas: '/estadisticas',
    'patient-reports': '/reportes',
    'patient-vitals': '/signos-vitales',
    'patient-history': '/historial',
    'patient-profile': '/perfil',
    'patient-consult': '/mi-consulta',
    'doctor-chats': '/chats',
    'clinical-reports': '/reportes-clinicos',
    support: '/soporte',
  };

  vistaActiva: VistaActiva = 'inicio';
  menuAbierto = false;
  puenteActivo = false;
  puenteMensaje = 'Esperando telemetría remota desde Render.';
  wearableSeleccionadoId = '';
  tvSeleccionadaId = 'tv-lg-01';
  tvEmparejada = false;
  tvMensaje = 'Selecciona un dispositivo registrado para conectarlo.';
  tvWallUrl = '/tv';
  activeTvId = 'tv-lg-01';
  deviceBusy = false;
  deviceNotice = '';
  deviceError = '';
  lastTelemetry: TelemetrySnapshot = {
    wearableId: '',
    heartRate: 0,
    spo2: 0,
    temperature: 0,
    battery: 0,
    steps: 0,
    stress: 0,
    respiratoryRate: 0,
    hrv: 0,
    signalQuality: 0,
    perfusionIndex: 0,
    sequence: 0,
    source: 'cloud-idle',
  };

  private bridgeInterval: ReturnType<typeof setInterval> | null = null;
  adminToken = '';
  adminBusy = false;
  adminMensaje = 'Acceso restringido a administradores autorizados.';
  adminLogin = { username: 'admin', password: '' };
  adminSession: SesionAdministrador | null = null;
  adminUsers: UsuarioAdministrador[] = [];
  turnosAtencion: TurnoAtencion[] = [];
  portalProfile: PortalProfile | null = null;
  supportConversations: SupportConversation[] = [];
  supportMessages: SupportMessage[] = [];
  selectedSupportConversationId = '';
  supportMessageDraft = '';
  portalReady = false;
  portalError = '';
  portalStatus = '';
  portalLogin = { email: '', password: '' };
  portalAuthMode: 'login' | 'register' = 'login';
  portalRegistrationRole: 'patient' | 'doctor' = 'patient';
  portalRegistration: PortalRegistration & {
    confirmPassword: string;
    termsAccepted: boolean;
  } = {
    role: 'patient',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    chronicConditions: [],
    otherChronicCondition: '',
    email: '',
    password: '',
    confirmPassword: '',
    termsAccepted: false,
    professionalLicense: '',
    specialty: '',
    specialtyLicense: '',
    institution: '',
    contactPhone: '',
  };
  portalPasswordVisible = false;
  portalTermsOpen = false;
  portalTermsReadToEnd = false;
  portalTermsAcceptedInDialog = false;
  readonly portalChronicConditionOptions = [
    'Hipertensión arterial',
    'Diabetes tipo 2',
    'Asma',
    'Enfermedad cardiovascular',
    'Enfermedad renal crónica',
    'Colesterol alto',
    'Enfermedad tiroidea',
    'EPOC',
    'Artritis',
    'Cáncer',
    'Otra',
  ];
  readonly portalTermsSections = [
    {
      title: '1. Aceptación y alcance',
      body: 'Estos términos regulan el uso de BioMedica, una aplicación de seguimiento personal de salud. Al crear una cuenta confirmas que leíste y aceptas estas condiciones, incluido el tratamiento de datos personales y de salud descrito aquí. Si no estás de acuerdo, no crees una cuenta ni uses las funciones que requieren acceso.',
    },
    {
      title: '2. Funciones y finalidad',
      body: 'BioMedica permite consultar y registrar mediciones, vincular dispositivos compatibles, organizar recordatorios de medicación y medición, y crear reportes de malestares. La información se ofrece para ayudarte a organizar y consultar tus propios datos de salud y, cuando corresponda, facilitar su consulta por personal autorizado asignado a tu atención.',
    },
    {
      title: '3. No es un servicio médico ni de emergencia',
      body: 'BioMedica no diagnostica enfermedades, no prescribe ni modifica tratamientos, y no sustituye la valoración de un profesional de salud. Las mediciones de teléfonos y dispositivos pueden ser inexactas, incompletas o retrasarse. No uses la aplicación para decidir por tu cuenta suspender medicamentos o retrasar atención. Ante síntomas graves o una emergencia, contacta inmediatamente a los servicios de emergencia de tu localidad o a un profesional.',
    },
    {
      title: '4. Cuenta y datos proporcionados',
      body: 'Debes proporcionar datos correctos y mantener actualizada la información que registres. Eres responsable de proteger tu contraseña, cerrar sesión en dispositivos compartidos y avisar al administrador si sospechas un acceso no autorizado. No uses la cuenta de otra persona ni ingreses datos de terceros sin autorización. Si eres menor de edad, usa el servicio con la autorización y supervisión de tu madre, padre o tutor.',
    },
    {
      title: '5. Información personal y de salud',
      body: 'Para operar la aplicación se pueden tratar tu nombre, correo, fecha de nacimiento, padecimientos que declares, ritmo cardiaco, oxigenación, temperatura cuando el dispositivo la proporcione, fechas de medición, dispositivo de origen, recordatorios, malestares, descripciones, prioridades de reportes y datos técnicos necesarios para la conexión. Autorizas expresamente su tratamiento para autenticarte, mostrar tus registros, generar recordatorios, atender reportes y prestar las funciones que solicites; no se venden para publicidad. Las cuentas autorizadas de profesionales solo pueden consultar información de pacientes que tengan asignados conforme a la configuración del servicio.',
    },
    {
      title: '6. Almacenamiento y proveedores',
      body: 'La aplicación usa Supabase para autenticación y datos relacionales, y servicios de Render y Firebase/Firestore para componentes de la API y reportes. La comunicación con dispositivos puede usar Bluetooth y los permisos del sistema operativo. Estos proveedores procesan datos para prestar el servicio de acuerdo con sus funciones y configuraciones. Ningún sistema conectado a Internet puede garantizar disponibilidad o seguridad absoluta.',
    },
    {
      title: '7. Permisos, dispositivos y notificaciones',
      body: 'Bluetooth, sensores y notificaciones requieren permisos del dispositivo. Puedes desactivarlos desde los ajustes del sistema, pero algunas funciones dejarán de operar. El ahorro de batería, la falta de conexión, las restricciones del fabricante o la desinstalación pueden impedir o retrasar recordatorios. La app no garantiza que una notificación llegue a una hora determinada; mantén tus propios medios de control de tratamientos.',
    },
    {
      title: '8. Uso permitido y disponibilidad',
      body: 'Usa BioMedica de manera lícita y no intentes acceder a cuentas, datos o sistemas ajenos, interferir con el servicio, cargar contenido malicioso o eludir controles de seguridad. Las funciones pueden cambiar, suspenderse o no estar disponibles por mantenimiento, fallos de red, dispositivos incompatibles o servicios de terceros.',
    },
    {
      title: '9. Conservación y solicitudes',
      body: 'Los datos se conservan mientras sean necesarios para prestar el servicio y mantener la cuenta, sujetos a obligaciones aplicables y copias de respaldo de los proveedores. La eliminación de la cuenta y el ejercicio de derechos de acceso, rectificación, cancelación u oposición, cuando procedan, pueden requerir asistencia del administrador de la plataforma. Contacta al administrador que te proporcionó el acceso para presentar la solicitud; algunas copias de respaldo pueden conservarse durante el ciclo técnico de eliminación o por obligaciones legales.',
    },
    {
      title: '10. Propiedad intelectual y cambios',
      body: 'La aplicación, su diseño y sus materiales pertenecen a sus titulares o licenciantes y no se transfieren al usuario. Podemos actualizar funciones o estos términos para reflejar cambios técnicos, legales o del servicio. Si una nueva versión requiere consentimiento, se solicitará nuevamente antes de continuar usando la función correspondiente.',
    },
    {
      title: '11. Responsabilidad',
      body: 'En la medida permitida por la legislación aplicable, BioMedica se proporciona como herramienta de apoyo y no garantiza que las mediciones, sincronizaciones, alertas o reportes estén siempre disponibles o libres de errores. Nada en estos términos limita derechos irrenunciables del consumidor o responsabilidades que la ley no permita excluir.',
    },
    {
      title: '12. Legislación y contacto',
      body: 'Estos términos se interpretan conforme a la legislación aplicable, sin limitar los derechos que te correspondan en tu lugar de residencia. Para consultas, correcciones o solicitudes sobre tu cuenta y tus datos, contacta al administrador de la plataforma BioMedica que te proporcionó el acceso.',
    },
  ];
  portalDoctors: PortalProfile[] = [];
  portalPatients: PortalProfile[] = [];
  portalReports: Record<string, unknown>[] = [];
  portalMeasurements: Record<string, unknown>[] = [];
  portalConversations: ClinicalConversation[] = [];
  portalMessages: ClinicalMessage[] = [];
  selectedPatientUid = '';
  selectedConversationId = '';
  portalBusy = false;
  messageDraft = '';
  messageType: ClinicalMessageType = 'chat';
  selectedImage: File | null = null;
  signedImages: Record<string, string> = {};
  doctorCredentials: DoctorCredentials[] = [];
  portalUsers: PortalProfile[] = [];
  doctorAssignments: { doctor_uid: string; patient_uid: string }[] = [];
  clinicTurns: ClinicTurn[] = [];
  selectedDoctorUid = '';
  selectedPatientUids: string[] = [];
  doctorRequest = {
    professionalLicense: '',
    specialty: '',
    specialtyLicense: '',
    institution: '',
    contactPhone: '',
  };
  turnDraft = {
    ticket_code: '',
    patient_uid: '',
    service: 'Consulta general',
    room: 'Consultorio 1',
    priority: 'media' as Prioridad,
    status: 'en_espera' as ClinicTurn['status'],
    eta_minutes: 0,
  };
  turnosPublicError = '';
  nuevoUsuario = {
    displayName: '',
    username: '',
    password: '',
    role: 'operador' as RolAdministrador,
  };
  nuevoTurno = {
    codigo: '',
    paciente: '',
    servicio: 'Telemetria',
    sala: 'Modulo A',
    prioridad: 'media' as Prioridad,
    etaMin: 8,
  };

  toggleMenu() { this.menuAbierto = !this.menuAbierto; }

  // ── Buscador Fuse.js ────────────────────────────────────────────────────
  busquedaQuery = '';
  busquedaAbierta = false;
  busquedaResultados: { titulo: string; descripcion: string; vista: VistaActiva; icon: string }[] = [];

  private readonly _catalogoBusqueda: { titulo: string; descripcion: string; vista: VistaActiva; icon: string }[] = [
    { titulo: 'Monitor Multiparámetro UCI', descripcion: 'ECG, SpO2, presión arterial y temperatura del paciente en tiempo real.', vista: 'inicio', icon: '🫀' },
    { titulo: 'Analizador Hematológico', descripcion: 'Biomarcadores y paneles clínicos de laboratorio automatizados.', vista: 'inicio', icon: '🧬' },
    { titulo: 'Telemetría Biomédica', descripcion: 'Centraliza señales de dispositivos médicos y genera alertas clínicas.', vista: 'inicio', icon: '📡' },
    { titulo: 'Wearables Clínicos', descripcion: 'Smartwatches y sensores conectados con telemetría en tiempo real.', vista: 'wearable', icon: '⌚' },
    { titulo: 'Dashboard Clínico', descripcion: 'Panel de tareas y estadísticas para gestión del flujo hospitalario.', vista: 'dashboard', icon: '📋' },
    { titulo: 'Conexiones', descripcion: 'Vinculación de wearables y pantallas compatibles.', vista: 'webos', icon: '📺' },
    { titulo: 'Pantalla Smart TV Wall', descripcion: 'Vista de televisión en sala con datos de telemetría en vivo.', vista: 'tvwall', icon: '🖥️' },
    { titulo: 'Administración de Usuarios', descripcion: 'Panel de control con roles: superadmin, operador y visor.', vista: 'admin', icon: '🔐' },
    { titulo: 'Estadísticas de la Plataforma', descripcion: 'Métricas de wearables, sesiones, telemetría y actividad clínica.', vista: 'estadisticas', icon: '📊' },
    { titulo: 'Contacto y Soporte', descripcion: 'Formulario de contacto y datos de soporte técnico biomédico.', vista: 'contacto', icon: '✉️' },
    { titulo: 'Autenticación PIN Smartwatch', descripcion: 'Login seguro con PIN o biometría en la app del smartwatch.', vista: 'wearable', icon: '🔑' },
    { titulo: 'Ritmo Cardíaco SpO2', descripcion: 'Monitoreo de frecuencia cardíaca y saturación de oxígeno en sangre.', vista: 'wearable', icon: '❤️' },
    { titulo: 'Sesión y Seguridad', descripcion: 'Token de sesión con expiración automática a los 15 minutos.', vista: 'admin', icon: '🛡️' },
  ];

  private _fuse = new Fuse(this._catalogoBusqueda, {
    keys: ['titulo', 'descripcion'],
    threshold: 0.4,
    includeScore: true,
  });

  buscar(): void {
    const q = this.busquedaQuery.trim();
    this.busquedaResultados = q.length < 2
      ? []
      : this._fuse.search(q).slice(0, 6).map(r => r.item);
  }

  irAResultado(item: { vista: VistaActiva }): void {
    this.navegar(item.vista);
    this.busquedaQuery = '';
    this.busquedaResultados = [];
    this.busquedaAbierta = false;
  }

  abrirBusqueda(): void {
    this.busquedaAbierta = true;
    setTimeout(() => (document.getElementById('fuse-input') as HTMLInputElement)?.focus(), 50);
  }

  cerrarBusqueda(): void {
    this.busquedaAbierta = false;
    this.busquedaQuery = '';
    this.busquedaResultados = [];
  }

  get navigationItems(): NavigationItem[] {
    const role = this.portalProfile?.role;
    if (!role) {
      return [
        { label: 'Inicio', vista: 'inicio' },
        { label: 'Estadísticas', vista: 'estadisticas' },
        { label: 'Contacto', vista: 'contacto' },
      ];
    }

    if (role === 'patient') {
      if (this.portalProfile?.doctor_application_status) {
        return [
          { label: 'Inicio', vista: 'inicio' },
          { label: 'Perfil', vista: 'patient-profile' },
        ];
      }
      return [
        { label: 'Inicio', vista: 'inicio' },
        { label: 'Reportes', vista: 'patient-reports' },
        { label: 'Mis signos vitales', vista: 'patient-vitals' },
        { label: 'Historial', vista: 'patient-history' },
        { label: 'Perfil', vista: 'patient-profile' },
        { label: 'Mi consulta', vista: 'patient-consult' },
      ];
    }

    if (role === 'doctor') {
      return [
        { label: 'Inicio', vista: 'inicio' },
        { label: 'Reportes clínicos', vista: 'clinical-reports' },
        { label: 'Wearables', vista: 'wearable' },
        { label: 'Turnos', vista: 'tvwall' },
        { label: 'Dashboard', vista: 'dashboard' },
        { label: 'Conexiones', vista: 'webos' },
        { label: 'Chats', vista: 'doctor-chats' },
      ];
    }

    return [
      { label: 'Inicio', vista: 'inicio' },
      { label: 'Reportes clínicos', vista: 'clinical-reports' },
      { label: 'Dashboard', vista: 'dashboard' },
      { label: 'Wearables', vista: 'wearable' },
      { label: 'Turnos', vista: 'tvwall' },
      { label: 'Conexiones', vista: 'webos' },
      { label: 'Estadísticas', vista: 'estadisticas' },
      { label: 'Contacto', vista: 'contacto' },
      { label: 'Administración', vista: 'admin' },
      { label: 'Soporte a usuarios', vista: 'support' },
    ];
  }

  openPortalAuth(mode: 'login' | 'register'): void {
    this.setPortalAuthMode(mode);
    this.navegar('admin');
  }

  private svgData(title: string, subtitle: string, leftColor: string, rightColor: string): string {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900" viewBox="0 0 1400 900">
        <defs>
          <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${leftColor}"/>
            <stop offset="100%" stop-color="${rightColor}"/>
          </linearGradient>
          <filter id="blur"><feGaussianBlur stdDeviation="40"/></filter>
        </defs>
        <rect width="1400" height="900" fill="url(#g)"/>
        <circle cx="240" cy="180" r="120" fill="rgba(255,255,255,0.12)" filter="url(#blur)"/>
        <circle cx="1180" cy="180" r="160" fill="rgba(255,255,255,0.08)" filter="url(#blur)"/>
        <circle cx="1120" cy="760" r="200" fill="rgba(255,255,255,0.10)" filter="url(#blur)"/>
        <rect x="110" y="110" width="1180" height="680" rx="36" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.20)"/>
        <text x="140" y="250" fill="#ffffff" font-size="56" font-family="Arial, Helvetica, sans-serif" font-weight="700">${title}</text>
        <text x="140" y="320" fill="rgba(255,255,255,0.92)" font-size="28" font-family="Arial, Helvetica, sans-serif">${subtitle}</text>
        <path d="M140 500 C240 450, 300 550, 400 500 S560 450, 660 500 S820 550, 920 500 S1080 450, 1180 500" stroke="rgba(255,255,255,0.92)" stroke-width="10" fill="none" stroke-linecap="round"/>
      </svg>`;
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg.replace(/\s+/g, ' ').trim());
  }

  navegar(vista: VistaActiva) {
    if (!this.canAccessView(vista)) {
      if (!this.portalProfile) {
        this.portalStatus = 'Inicia sesión para acceder a esta sección.';
        vista = 'admin';
      } else {
        vista = this.portalProfile.role === 'patient'
          ? 'patient-profile'
          : this.portalProfile.role === 'doctor' ? 'dashboard' : 'admin';
      }
    }
    this.vistaActiva = vista;
    this.menuAbierto = false;
    this.sincronizarRuta();
    if ((vista === 'support' || vista === 'clinical-reports') && this.portalProfile) {
      void this.refreshPortalData();
    }
    if (vista !== 'tvwall') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  private canAccessView(vista: VistaActiva): boolean {
    const role = this.portalProfile?.role;
    const publicViews: VistaActiva[] = ['inicio', 'estadisticas', 'contacto', 'admin'];
    if (!role) return publicViews.includes(vista);

    if (role === 'patient') {
      const patientViews: VistaActiva[] = [
        'inicio', 'patient-reports', 'patient-vitals', 'patient-history',
        'patient-profile', 'patient-consult', 'support',
      ];
      if (this.portalProfile?.doctor_application_status) {
        return ['inicio', 'patient-profile', 'support'].includes(vista);
      }
      return patientViews.includes(vista);
    }

    if (role === 'doctor') {
      return [
        'inicio', 'dashboard', 'wearable', 'tvwall', 'webos', 'doctor-chats',
        'clinical-reports',
        'support', 'patient-profile',
      ].includes(vista);
    }

    return true;
  }

  // Hero Slider
  heroSlide = 0;
  private sliderInterval: ReturnType<typeof setInterval> | null = null;
  heroSlides = [
    { titulo: 'Centro de Innovación Biomédica', subtitulo: 'Monitoreo clínico de próxima generación con inteligencia artificial para UCI y hospitalización.', cta: 'Explorar Plataforma', img: '/biomedica/hero-clinic.jpg' },
    { titulo: 'Telemetría Hospitalaria en Tiempo Real', subtitulo: 'Centraliza ECG, SpO2 y presión arterial de todos tus dispositivos médicos en un único dashboard.', cta: 'Ver Demostración', img: '/biomedica/product-icu.jpg' },
    { titulo: 'Wearables Clínicos Conectados', subtitulo: 'Desde pulsioxímetros hasta holters cardiacos: integra y analiza toda tu red de sensores biomédicos.', cta: 'Ver Catálogo', img: '/biomedica/hero-wearable.jpg' },
  ];

  async ngOnInit() {
    this.vistaActiva = this.rutaInicial();
    this.tvWallUrl = `${window.location.origin}/tv`;
    this.sincronizarRuta();
    this.sliderInterval = setInterval(() => { this.heroSlide = (this.heroSlide + 1) % this.heroSlides.length; }, 5500);
    await this.initializePortal();
    await Promise.all([this.cargarEstadoPuente(), this.cargarTurnosTv()]);
    this.bridgeInterval = setInterval(() => {
      void this.cargarEstadoPuente();
      void this.cargarTurnosTv();
      if (this.portalProfile && this.selectedConversationId) {
        void this.loadDoctorMessages(this.selectedConversationId);
      }
    }, 5000);
  }

  ngOnDestroy() {
    if (this.sliderInterval) clearInterval(this.sliderInterval);
    if (this.bridgeInterval) clearInterval(this.bridgeInterval);
  }
  setSlide(i: number) { this.heroSlide = i; }
  prevSlide() { this.heroSlide = (this.heroSlide - 1 + this.heroSlides.length) % this.heroSlides.length; }
  nextSlide() { this.heroSlide = (this.heroSlide + 1) % this.heroSlides.length; }

  popupVisible = false;
  mostrarPopup() { this.popupVisible = true; }
  cerrarPopup() { this.popupVisible = false; }

  productos = [
    { nombre: 'Monitor Multiparámetro UCI', descripcion: 'Seguimiento continuo de ECG, SpO2, presión arterial y temperatura del paciente.', icon: '🫀', img: '/biomedica/product-icu.jpg' },
    { nombre: 'Analizador Hematológico', descripcion: 'Procesamiento automatizado de biomarcadores y paneles clínicos de laboratorio.', icon: '🧬', img: '/biomedica/product-lab.jpg' },
    { nombre: 'Telemetría Biomédica', descripcion: 'Centraliza señales de dispositivos médicos y genera alertas clínicas en tiempo real.', icon: '📡', img: '/biomedica/hero-clinic.jpg' },
  ];

  footerGaleria = [
    '/biomedica/product-icu.jpg',
    '/biomedica/product-lab.jpg',
    '/biomedica/hero-wearable.jpg',
  ];

  imagenesComplementarias = [
    { titulo: 'Sala UCI', subtitulo: 'Monitoreo continuo y respuesta rápida', img: '/biomedica/hero-clinic.jpg' },
    { titulo: 'Laboratorio Clínico', subtitulo: 'Biomarcadores y automatización', img: '/biomedica/product-lab.jpg' },
    { titulo: 'Wearables Médicos', subtitulo: 'Sensores biomédicos conectados', img: '/biomedica/hero-wearable.jpg' },
    { titulo: 'IA de Apoyo', subtitulo: 'Predicción y alertas tempranas', img: '/biomedica/product-icu.jpg' },
  ];

  wearables: WearableDevice[] = [];

  tvs: TvDevice[] = [
    {
      id: 'tv-lg-01',
      nombre: 'LG OLED webOS 24',
      plataforma: 'LG webOS',
      resolucion: '4K UHD',
      sala: 'Consultorio principal',
      estado: 'Disponible',
      appActiva: 'BioMedica TV Hub',
    },
    {
      id: 'tv-lg-02',
      nombre: 'LG NanoCell webOS',
      plataforma: 'LG webOS',
      resolucion: '4K HDR',
      sala: 'Sala de telemetría',
      estado: 'Disponible',
      appActiva: 'BioMedica TV Hub',
    },
    {
      id: 'tv-samsung-01',
      nombre: 'Samsung Smart TV',
      plataforma: 'Samsung Tizen',
      resolucion: '4K UHD',
      sala: 'Sala de espera',
      estado: 'Disponible',
      appActiva: 'BioMedica TV Hub',
    },
    {
      id: 'tv-android-01',
      nombre: 'Android TV',
      plataforma: 'Android TV',
      resolucion: '4K UHD',
      sala: 'Consultorio 2',
      estado: 'Disponible',
      appActiva: 'BioMedica TV Hub',
    },
  ];
  private readonly tvPlaceholder: TvDevice = {
    id: '',
    nombre: 'Sin pantalla registrada',
    plataforma: '—',
    resolucion: '—',
    sala: '—',
    estado: 'En espera',
    appActiva: '—',
  };

  private api(path: string): string {
    return `${environment.apiUrl}${path}`;
  }

  private rutaInicial(): VistaActiva {
    const pathname = window.location.pathname.toLowerCase();
    if (pathname === '/dashboard') return 'dashboard';
    if (pathname === '/wearable') return 'wearable';
    if (pathname === '/webos') return 'webos';
    if (pathname === '/tv' || pathname === '/tvwall') return 'tvwall';
    if (pathname === '/admin') return 'admin';
    if (pathname === '/contacto') return 'contacto';
    if (pathname === '/estadisticas') return 'estadisticas';
    if (pathname === '/reportes') return 'patient-reports';
    if (pathname === '/signos-vitales') return 'patient-vitals';
    if (pathname === '/historial') return 'patient-history';
    if (pathname === '/perfil') return 'patient-profile';
    if (pathname === '/mi-consulta') return 'patient-consult';
    if (pathname === '/chats') return 'doctor-chats';
    if (pathname === '/reportes-clinicos') return 'clinical-reports';
    if (pathname === '/soporte') return 'support';
    return 'inicio';
  }

  private sincronizarRuta(): void {
    const ruta = this.routeMap[this.vistaActiva] ?? '/';
    if (window.location.pathname !== ruta) {
      window.history.replaceState({}, '', ruta);
    }
  }

  private obtenerTokenGuardado(): string {
    return window.localStorage.getItem(this.adminTokenStorageKey) ?? '';
  }

  private guardarTokenAdmin(token: string): void {
    this.adminToken = token;
    window.localStorage.setItem(this.adminTokenStorageKey, token);
  }

  private limpiarTokenAdmin(): void {
    this.adminToken = '';
    window.localStorage.removeItem(this.adminTokenStorageKey);
  }

  private encabezadosAdmin(includeJson = true): HeadersInit {
    return {
      ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
      ...(this.adminToken ? { Authorization: `Bearer ${this.adminToken}` } : {}),
    };
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.api(path), init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload as T;
  }

  private dateOffset(daysFromNow: number): string {
    return new Date(Date.now() + (daysFromNow * 86400000)).toISOString().slice(0, 10);
  }

  private fusionarWearables(wearables: Partial<WearableDevice>[]): void {
    for (const incoming of wearables) {
      if (!incoming.id) {
        continue;
      }

      const index = this.wearables.findIndex((item) => item.id === incoming.id);
      if (index >= 0) {
        this.wearables[index] = { ...this.wearables[index], ...incoming };
        continue;
      }

      this.wearables.unshift({
        id: incoming.id,
        nombre: incoming.nombre ?? `Wearable ${incoming.id.slice(-6).toUpperCase()}`,
        modelo: incoming.modelo ?? 'Wearable remoto conectado',
        estado: incoming.estado ?? 'Conectado',
        bateria: incoming.bateria ?? 100,
        ritmoCardiaco: incoming.ritmoCardiaco ?? 72,
        spo2: incoming.spo2 ?? 98,
        temperatura: incoming.temperatura ?? 36.6,
        ubicacion: incoming.ubicacion ?? 'Sesion remota',
      });
    }
  }

  private async cargarEstadoPuente(): Promise<void> {
    try {
      const data = await this.requestJson<{
        wearables?: Partial<WearableDevice>[];
        wearable?: Partial<WearableDevice>;
        tv?: Partial<TvDevice>;
        tvs?: TvDevice[];
        activeWearableId?: string;
        tvPaired?: boolean;
        lastTelemetry?: Partial<TelemetrySnapshot>;
      }>('/api/status');

      if (data.wearables?.length) {
        this.fusionarWearables(data.wearables);
      }
      if (data.tvs?.length) {
        this.tvs = data.tvs;
      }

      if (data.activeWearableId) {
        this.wearableSeleccionadoId = data.activeWearableId;
      }

      const wearableId = data.wearable?.id;
      if (wearableId) {
        const wearableIndex = this.wearables.findIndex((item) => item.id === wearableId);
        if (wearableIndex >= 0) {
          this.wearables[wearableIndex] = { ...this.wearables[wearableIndex], ...data.wearable };
        }
      }

      const tvId = data.tv?.id;
      if (tvId) {
        const tvIndex = this.tvs.findIndex((item) => item.id === tvId);
        if (tvIndex >= 0) {
          this.tvs[tvIndex] = { ...this.tvs[tvIndex], ...data.tv };
        }
      }

      if (data.lastTelemetry) {
        this.lastTelemetry = { ...this.lastTelemetry, ...data.lastTelemetry };
      }

      this.tvEmparejada = Boolean(data.tvPaired);
      this.activeTvId = data.tv?.id ?? this.activeTvId;
      this.puenteActivo = Boolean(data.wearable?.id);
      this.puenteMensaje = data.wearable?.id
        ? `Conectado a nube · wearable ${data.wearable.nombre ?? 'N/A'} · TV ${data.tv?.nombre ?? 'N/A'} · seq ${this.lastTelemetry.sequence ?? 0}`
        : 'Sin wearables remotos activos todavía. Abre la app del smartwatch para registrar uno.';
      this.tvMensaje = this.tvEmparejada
        ? `Dispositivo conectado: ${data.wearable?.nombre ?? 'Wearable'} → ${data.tv?.nombre ?? 'Pantalla'}.`
        : 'Selecciona un wearable y una pantalla registrada para emparejar.';
    } catch {
      this.puenteActivo = false;
      this.puenteMensaje = 'La nube no está respondiendo temporalmente. Recarga o revisa Render.';
    }
  }

  async cargarTurnosTv(): Promise<void> {
    try {
      const data = await this.requestJson<{
        queue: {
          ticket_code: string;
          service: string;
          room: string;
          status: 'en_espera' | 'en_atencion';
          eta_minutes: number;
          updated_at: string;
        }[];
        currentTurn: {
          ticket_code: string;
          service: string;
          room: string;
          status: 'en_espera' | 'en_atencion';
          eta_minutes: number;
          updated_at: string;
        } | null;
      }>('/api/tv-feed');

      const queue = [...data.queue];
      if (data.currentTurn && !queue.some((turn) => turn.ticket_code === data.currentTurn?.ticket_code)) {
        queue.unshift(data.currentTurn);
      }
      this.turnosAtencion = queue.map((turn) => ({
        id: turn.ticket_code,
        codigo: turn.ticket_code,
        paciente: '',
        servicio: turn.service,
        sala: turn.room,
        prioridad: 'media',
        estado: turn.status,
        etaMin: turn.eta_minutes,
        updatedAt: turn.updated_at,
      }));
      this.turnosPublicError = '';
    } catch (error) {
      this.turnosAtencion = [];
      this.turnosPublicError = error instanceof Error ? error.message : 'No se pudo consultar la cola de turnos.';
    }
  }

  get statsHome() {
    const reportCount = this.reportStatsAvailable
      ? this.portalReports.length.toLocaleString('es-MX')
      : '—';
    const measurementCount = this.dashboardMetrics?.measurementCount.toLocaleString('es-MX') ?? '—';
    const patientCount = this.dashboardMetrics?.patientCount.toLocaleString('es-MX') ?? '—';
    return [
      { valor: patientCount, label: 'Pacientes visibles', icon: '🏥', color: '#001ef8' },
      { valor: this.connectedWearableCount.toLocaleString('es-MX'), label: 'Wearables conectados', icon: '📡', color: '#f80000' },
      { valor: measurementCount, label: 'Mediciones registradas', icon: '💓', color: '#10b981' },
      { valor: reportCount, label: 'Reportes disponibles', icon: '📋', color: '#f59e0b' },
    ];
  }

  servicios = [
    { titulo: 'Telemetría Hospitalaria', desc: 'Monitoreo 24/7 de signos vitales con alertas automáticas y tableros clínicos en tiempo real.', icon: '📊' },
    { titulo: 'Integración HL7/FHIR', desc: 'Interoperabilidad total con sistemas HIS, LIS y EHR mediante estándares internacionales.', icon: '🔗' },
    { titulo: 'IA Biomédica', desc: 'Algoritmos de análisis predictivo sobre señales cardiacas, respiratorias y metabólicas.', icon: '🤖' },
    { titulo: 'Wearables Clínicos', desc: 'Compatibilidad con más de 200 dispositivos médicos certificados para uso hospitalario.', icon: '⌚' },
    { titulo: 'Seguridad Regulatoria', desc: 'Cumplimiento HIPAA, ISO 27001 y normativas locales para datos de salud.', icon: '🔒' },
    { titulo: 'Soporte 24/7', desc: 'Equipo de ingenieros biomédicos disponibles en todo momento para soporte técnico.', icon: '🛟' },
  ];

  // Estadísticas view
  dashboardMetrics: DashboardMetrics | null = null;
  statsLoading = false;
  statsError = '';
  reportStatsAvailable = false;
  graficaMensual: { mes: string; mediciones: number; reportes: number }[] = [];

  get maxRegistrosMensuales(): number {
    return Math.max(
      1,
      ...this.graficaMensual.flatMap((month) => [month.mediciones, month.reportes]),
    );
  }

  get connectedWearableCount(): number {
    return this.wearables.filter((wearable) => wearable.estado === 'Conectado').length;
  }

  get dispositivosTipo(): { tipo: string; cantidad: number; color: string }[] {
    const colors = ['#001ef8', '#f80000', '#10b981', '#f59e0b', '#8b5cf6'];
    const byModel = new Map<string, number>();
    for (const wearable of this.wearables) {
      byModel.set(wearable.modelo, (byModel.get(wearable.modelo) ?? 0) + 1);
    }
    return [...byModel.entries()].map(([tipo, cantidad], index) => ({
      tipo,
      cantidad,
      color: colors[index % colors.length],
    }));
  }

  get totalDispositivos(): number {
    return this.wearables.length;
  }

  porcentaje(n: number): number {
    return this.totalDispositivos === 0
      ? 0
      : Math.round((n / this.totalDispositivos) * 100);
  }

  get wearableSeleccionado(): WearableDevice {
    return this.wearables.find((w) => w.id === this.wearableSeleccionadoId) ?? this.wearables[0] ?? wearablePlaceholder;
  }

  get tvSeleccionada(): TvDevice {
    return this.tvs.find((tv) => tv.id === this.tvSeleccionadaId) ?? this.tvs[0] ?? this.tvPlaceholder;
  }

  get turnoActual(): TurnoAtencion | null {
    return this.turnosAtencion.find((turno) => turno.estado === 'en_atencion') ?? null;
  }

  get turnosEnEspera(): TurnoAtencion[] {
    return this.turnosAtencion.filter((turno) => turno.estado === 'en_espera').slice(0, 5);
  }

  get turnosFinalizadosHoy(): number {
    return this.turnosAtencion.filter((turno) => turno.estado === 'finalizado').length;
  }

  get alertasCriticas(): string[] {
    const alertas: string[] = [];
    if (this.lastTelemetry.heartRate >= 110) alertas.push('Frecuencia cardiaca elevada');
    if (this.lastTelemetry.spo2 <= 92) alertas.push('SpO2 por debajo del umbral');
    if ((this.lastTelemetry.stress ?? 0) >= 70) alertas.push('Indice de estres fuera de rango');
    if (alertas.length === 0) {
      alertas.push('Sin alertas clinicas criticas');
    }
    return alertas;
  }

  seleccionarWearable(id: string) {
    this.wearableSeleccionadoId = id;
    this.tvMensaje = `Wearable ${this.wearableSeleccionado.nombre} seleccionado.`;
    void fetch(this.api('/api/select-wearable'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wearableId: id }),
    }).finally(() => void this.cargarEstadoPuente());
  }

  seleccionarTv(id: string) {
    this.tvSeleccionadaId = id;
    this.deviceNotice = '';
    this.deviceError = '';
    this.tvMensaje = `${this.tvSeleccionada.nombre} seleccionada.`;
  }

  get tvSeleccionadaEmparejada(): boolean {
    return this.tvEmparejada && this.activeTvId === this.tvSeleccionadaId;
  }

  get tvSeleccionadaWebOSActiva(): boolean {
    return this.tvSeleccionadaEmparejada
      && this.tvSeleccionada.plataforma.toLowerCase().includes('webos');
  }

  async conectarDispositivo(): Promise<void> {
    this.deviceBusy = true;
    this.deviceError = '';
    this.deviceNotice = '';
    try {
      const response = await fetch(this.api('/api/pair'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wearableId: this.wearableSeleccionadoId, tvId: this.tvSeleccionadaId }),
      });
      if (!response.ok) {
        throw new Error(`No se pudo conectar el dispositivo (HTTP ${response.status}).`);
      }
      this.deviceNotice = 'Dispositivo conectado correctamente.';
      await this.cargarEstadoPuente();
    } catch (error) {
      this.deviceError = error instanceof Error ? error.message : 'No se pudo conectar el dispositivo.';
    } finally {
      this.deviceBusy = false;
    }
  }

  async desconectarDispositivo(): Promise<void> {
    this.deviceBusy = true;
    this.deviceError = '';
    this.deviceNotice = '';
    try {
      const response = await fetch(this.api('/api/unpair'), { method: 'POST' });
      if (!response.ok) {
        throw new Error(`No se pudo desconectar el dispositivo (HTTP ${response.status}).`);
      }
      this.deviceNotice = 'Dispositivo desconectado correctamente.';
      await this.cargarEstadoPuente();
    } catch (error) {
      this.deviceError = error instanceof Error ? error.message : 'No se pudo desconectar el dispositivo.';
    } finally {
      this.deviceBusy = false;
    }
  }

  abrirPantallaTv(): void {
    window.open(this.tvWallUrl, '_blank', 'noopener');
  }

  etiquetaEstadoTurno(estado: EstadoTurno): string {
    const etiquetas: Record<EstadoTurno, string> = {
      en_espera: 'En espera',
      en_atencion: 'En atencion',
      finalizado: 'Finalizado',
    };
    return etiquetas[estado];
  }

  colorEstadoTurno(estado: EstadoTurno): string {
    const colores: Record<EstadoTurno, string> = {
      en_espera: '#f59e0b',
      en_atencion: '#0ea5e9',
      finalizado: '#16a34a',
    };
    return colores[estado];
  }

  async initializePortal(): Promise<void> {
    try {
      this.portalProfile = await this.clinicalPortal.initialize();
      if (this.portalProfile) {
        await this.refreshPortalData();
        if (!this.canAccessView(this.vistaActiva)) {
          this.navegar(this.portalProfile.role === 'patient'
            ? 'patient-profile'
            : this.portalProfile.role === 'doctor' ? 'dashboard' : 'admin');
        }
      } else if (!this.canAccessView(this.vistaActiva)) {
        this.navegar('admin');
      }
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo inicializar el portal clínico.';
      if (!this.portalProfile && !this.canAccessView(this.vistaActiva)) {
        this.portalStatus = 'Inicia sesión para acceder a esta sección.';
        this.navegar('admin');
      }
    } finally {
      this.portalReady = true;
    }
  }

  async signInPortal(): Promise<void> {
    this.portalBusy = true;
    this.portalError = '';
    this.portalStatus = '';
    try {
      const profile = await this.clinicalPortal.signIn(
        this.portalLogin.email,
        this.portalLogin.password,
      );
      this.portalLogin.password = '';
      this.portalProfile = profile;
      await this.refreshPortalData();
      this.navegar(profile.role === 'patient'
        ? 'patient-profile'
        : profile.role === 'doctor' ? 'dashboard' : 'admin');
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo iniciar sesión.';
    } finally {
      this.portalBusy = false;
    }
  }

  setPortalAuthMode(mode: 'login' | 'register'): void {
    this.portalAuthMode = mode;
    this.portalError = '';
    this.portalStatus = '';
  }

  setPortalRegistrationRole(role: 'patient' | 'doctor'): void {
    this.portalRegistrationRole = role;
    this.portalRegistration.role = role;
    this.portalError = '';
  }

  togglePortalCondition(condition: string, selected: boolean): void {
    const conditions = new Set(this.portalRegistration.chronicConditions);
    if (selected) conditions.add(condition);
    else conditions.delete(condition);
    this.portalRegistration.chronicConditions = [...conditions];
  }

  openPortalTerms(): void {
    this.portalTermsOpen = true;
    this.portalTermsReadToEnd = false;
    this.portalTermsAcceptedInDialog = false;
    this.portalRegistration.termsAccepted = false;
  }

  onPortalTermsScroll(event: Event): void {
    const element = event.target as HTMLElement;
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= 24) {
      this.portalTermsReadToEnd = true;
    }
  }

  acceptPortalTerms(): void {
    if (!this.portalTermsReadToEnd || !this.portalTermsAcceptedInDialog) return;
    this.portalRegistration.termsAccepted = true;
    this.portalTermsOpen = false;
  }

  closePortalTerms(): void {
    this.portalTermsOpen = false;
    this.portalRegistration.termsAccepted = false;
  }

  get portalDateOfBirthMax(): string {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }

  get doctorApplicationStatusLabel(): string {
    switch (this.portalProfile?.doctor_application_status) {
      case 'pending':
        return 'Pendiente de revisión administrativa';
      case 'verified':
        return 'Solicitud aprobada. El acceso clínico requiere iniciar sesión nuevamente.';
      case 'rejected':
        return 'Solicitud no aprobada';
      default:
        return '';
    }
  }

  async registerPortal(): Promise<void> {
    this.portalError = '';
    this.portalStatus = '';
    const validation = this.validatePortalRegistration();
    if (validation) {
      this.portalError = validation;
      return;
    }

    this.portalBusy = true;
    try {
      const { confirmPassword: _confirmPassword, termsAccepted: _termsAccepted, ...registration } =
        this.portalRegistration;
      const profile = await this.clinicalPortal.register({
        ...registration,
        role: this.portalRegistrationRole,
      });
      this.portalLogin.email = registration.email;
      this.portalLogin.password = '';
      this.portalRegistration.password = '';
      this.portalRegistration.confirmPassword = '';
      this.portalAuthMode = 'login';
      if (!profile) {
        this.portalStatus = this.portalRegistrationRole === 'doctor'
          ? 'Te enviamos un correo para confirmar tu cuenta. Tu solicitud médica quedó registrada y permanecerá pendiente hasta que un administrador revise y apruebe tus datos.'
          : 'Te enviamos un correo para confirmar tu cuenta. Confírmalo antes de iniciar sesión.';
        return;
      }
      this.portalProfile = profile;
      await this.refreshPortalData();
      this.navegar(profile.role === 'patient'
        ? 'patient-profile'
        : profile.role === 'doctor' ? 'dashboard' : 'admin');
      this.portalStatus = profile.doctor_application_status
        ? 'Tu solicitud médica quedó registrada y está pendiente de revisión administrativa. No tendrás acceso clínico hasta recibir aprobación.'
        : 'Tu cuenta se creó correctamente.';
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo crear la cuenta.';
    } finally {
      this.portalBusy = false;
    }
  }

  async requestPortalPasswordReset(): Promise<void> {
    this.portalError = '';
    this.portalStatus = '';
    const email = this.portalLogin.email.trim();
    if (!this.isValidPortalEmail(email)) {
      this.portalError = 'Escribe un correo válido para enviarte el enlace.';
      return;
    }
    this.portalBusy = true;
    try {
      await this.clinicalPortal.requestPasswordReset(email);
      this.portalStatus = 'Si existe una cuenta con ese correo, recibirás instrucciones para cambiar la contraseña.';
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo solicitar el cambio de contraseña.';
    } finally {
      this.portalBusy = false;
    }
  }

  private validatePortalRegistration(): string | null {
    const registration = this.portalRegistration;
    const firstNameLength = Array.from(registration.firstName.trim()).length;
    const lastNameLength = Array.from(registration.lastName.trim()).length;
    if (firstNameLength < 2) return 'Escribe tu nombre.';
    if (firstNameLength > 100) return 'El nombre excede la longitud permitida.';
    if (lastNameLength < 2) return 'Escribe tus apellidos.';
    if (lastNameLength > 150) return 'Los apellidos exceden la longitud permitida.';
    if (!registration.dateOfBirth) return 'Selecciona tu fecha de nacimiento.';
    if (registration.dateOfBirth > this.portalDateOfBirthMax) {
      return 'La fecha de nacimiento no puede ser futura.';
    }
    if (!this.isValidPortalEmail(registration.email)) return 'Ingresa un correo válido.';
    const passwordLength = Array.from(registration.password).length;
    if (passwordLength < 8) return 'Usa al menos 8 caracteres.';
    if (passwordLength > 30) return 'La contraseña excede la longitud permitida.';
    if (!registration.confirmPassword) return 'Confirma tu contraseña.';
    if (registration.confirmPassword !== registration.password) {
      return 'Las contraseñas no coinciden.';
    }
    if (!registration.termsAccepted) return 'Lee y acepta los términos para continuar.';

    if (this.portalRegistrationRole === 'doctor') {
      const licenseLength = Array.from(registration.professionalLicense?.trim() ?? '').length;
      const specialtyLength = Array.from(registration.specialty?.trim() ?? '').length;
      const specialtyLicense = registration.specialtyLicense?.trim() ?? '';
      const institution = registration.institution?.trim() ?? '';
      const phone = registration.contactPhone?.trim() ?? '';
      if (licenseLength < 5 || licenseLength > 40) {
        return 'Escribe una cédula profesional válida (de 5 a 40 caracteres).';
      }
      if (specialtyLength < 1 || specialtyLength > 120) {
        return 'Escribe una especialidad válida.';
      }
      if (specialtyLicense && (specialtyLicense.length < 5 || specialtyLicense.length > 40)) {
        return 'La cédula de especialidad debe tener entre 5 y 40 caracteres.';
      }
      if (institution.length > 160) return 'El nombre de la institución excede la longitud permitida.';
      if (phone && (phone.length < 7 || phone.length > 25)) {
        return 'El teléfono debe tener entre 7 y 25 caracteres.';
      }
    }
    return null;
  }

  private isValidPortalEmail(value: string): boolean {
    const email = value.trim();
    if (!email || Array.from(email).length > 254) return false;
    const [localPart, ...domainParts] = email.split('@');
    const domain = domainParts.join('@');
    const emailPattern = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
    return localPart.length <= 64 && domain.length <= 253 && emailPattern.test(email);
  }

  async signOutPortal(): Promise<void> {
    this.portalBusy = true;
    try {
      await this.clinicalPortal.signOut();
      this.portalProfile = null;
      this.portalDoctors = [];
      this.portalPatients = [];
      this.portalReports = [];
      this.portalMeasurements = [];
      this.portalConversations = [];
      this.portalMessages = [];
      this.portalUsers = [];
      this.clinicTurns = [];
      this.supportConversations = [];
      this.supportMessages = [];
      this.tareas = [];
      this.tasksError = '';
      this.taskNotice = '';
      this.taskActionError = '';
      this.dashboardMetrics = null;
      this.graficaMensual = [];
      this.reportStatsAvailable = false;
      this.statsError = '';
      this.selectedSupportConversationId = '';
      this.selectedConversationId = '';
      this.selectedPatientUid = '';
      this.portalError = '';
      this.portalStatus = '';
      this.navegar('inicio');
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo cerrar sesión.';
    } finally {
      this.portalBusy = false;
    }
  }

  async refreshPortalData(): Promise<void> {
    const currentProfile = this.portalProfile;
    if (!currentProfile) return;
    const syncWarnings: string[] = [];
    this.tasksError = '';
    this.statsError = '';
    try {
      const profile = await this.clinicalPortal.loadProfile(currentProfile.id);
      this.portalProfile = profile;
      this.tasksLoading = profile.role === 'doctor' || profile.role === 'admin';
      this.statsLoading = ['doctor', 'patient', 'admin'].includes(profile.role);
      if (!profile.is_active) {
        await this.clinicalPortal.signOut();
        this.portalProfile = null;
        this.portalDoctors = [];
        this.portalPatients = [];
        this.portalReports = [];
        this.portalMeasurements = [];
        this.portalConversations = [];
        this.portalMessages = [];
        this.portalUsers = [];
        this.supportConversations = [];
        this.supportMessages = [];
        this.tareas = [];
        this.tasksError = '';
        this.dashboardMetrics = null;
        this.graficaMensual = [];
        this.reportStatsAvailable = false;
        this.statsError = '';
        this.portalError = 'Tu cuenta está dada de baja. Se cerró la sesión y tus datos se conservan.';
        this.navegar('admin');
        return;
      }
      if (profile.role === 'patient' && profile.doctor_application_status) {
        this.portalDoctors = [];
        this.portalPatients = [];
        this.portalReports = [];
        this.portalMeasurements = [];
        this.portalConversations = [];
        this.portalMessages = [];
        this.tareas = [];
        this.dashboardMetrics = null;
        this.reportStatsAvailable = false;
        return;
      }
      if (profile.role === 'doctor') {
        const [patients, conversations, tasksResult] = await Promise.all([
          this.clinicalPortal.loadDoctorPatients(profile.id),
          this.clinicalPortal.loadDoctorConversations(profile.id),
          this.clinicalPortal.loadDashboardTasks().then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason: unknown) => ({ status: 'rejected' as const, reason }),
          ),
        ]);
        this.portalPatients = patients;
        const assignedUids = new Set(patients.map((patient) => patient.id));
        this.portalConversations = conversations;
        this.reportStatsAvailable = false;
        if (tasksResult.status === 'fulfilled') {
          this.tareas = tasksResult.value.map((task) => this.toTarea(task));
          this.tasksError = '';
        } else {
          this.tareas = [];
          this.tasksError = tasksResult.reason instanceof Error
            ? tasksResult.reason.message
            : 'No se pudieron cargar las tareas.';
          syncWarnings.push(`Tareas: ${this.tasksError}`);
        }
        const [reportsResult, measurementsResult] = await Promise.allSettled([
          this.clinicalPortal.loadAssignedReports(),
          this.clinicalPortal.loadPatientMeasurements(patients.map((patient) => patient.id)),
        ]);
        if (reportsResult.status === 'fulfilled') {
          this.portalReports = reportsResult.value.filter((report) => {
            const ownerUid = report['ownerUid'];
            return typeof ownerUid === 'string' && assignedUids.has(ownerUid);
          });
          this.reportStatsAvailable = true;
        } else {
          this.portalReports = [];
          syncWarnings.push(
            reportsResult.reason instanceof Error
              ? `Reportes: ${reportsResult.reason.message}`
              : 'No se pudieron cargar los reportes.',
          );
        }
        if (measurementsResult.status === 'fulfilled') {
          this.portalMeasurements = measurementsResult.value;
        } else {
          this.portalMeasurements = [];
          syncWarnings.push(
            measurementsResult.reason instanceof Error
              ? `Mediciones: ${measurementsResult.reason.message}`
              : 'No se pudieron cargar las mediciones.',
          );
        }
        if (this.selectedPatientUid && !assignedUids.has(this.selectedPatientUid)) {
          this.selectedPatientUid = '';
          this.selectedConversationId = '';
          this.portalMessages = [];
        }
      } else if (profile.role === 'patient') {
        const [doctors, conversations, measurementsResult, reportsResult] = await Promise.all([
          this.clinicalPortal.loadAssignedDoctors(profile.id),
          this.clinicalPortal.loadPatientConversations(profile.id),
          this.clinicalPortal.loadPatientMeasurements([profile.id]).then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason: unknown) => ({ status: 'rejected' as const, reason }),
          ),
          this.clinicalPortal.loadAssignedReports().then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason: unknown) => ({ status: 'rejected' as const, reason }),
          ),
        ]);
        this.portalDoctors = doctors;
        this.portalConversations = conversations;
        this.tareas = [];
        this.tasksError = '';
        this.reportStatsAvailable = false;
        if (measurementsResult.status === 'fulfilled') {
          this.portalMeasurements = measurementsResult.value;
        } else {
          this.portalMeasurements = [];
          syncWarnings.push(
            measurementsResult.reason instanceof Error
              ? `Signos vitales: ${measurementsResult.reason.message}`
              : 'No se pudieron cargar los signos vitales.',
          );
        }
        if (reportsResult.status === 'fulfilled') {
          this.portalReports = reportsResult.value.filter((report) => report['ownerUid'] === profile.id);
          this.reportStatsAvailable = true;
        } else {
          this.portalReports = [];
          syncWarnings.push(
            reportsResult.reason instanceof Error
              ? `Reportes: ${reportsResult.reason.message}`
              : 'No se pudieron cargar tus reportes.',
          );
        }
        if (this.selectedConversationId && !conversations.some(
          (conversation) => conversation.id === this.selectedConversationId,
        )) {
          this.selectedConversationId = '';
          this.portalMessages = [];
        }
      } else if (profile.role === 'admin') {
        const [adminData, turns, tasksResult, reportsResult] = await Promise.all([
          this.clinicalPortal.loadAdminUsers(),
          this.clinicalPortal.loadClinicTurns(),
          this.clinicalPortal.loadDashboardTasks().then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason: unknown) => ({ status: 'rejected' as const, reason }),
          ),
          this.clinicalPortal.loadAssignedReports().then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason: unknown) => ({ status: 'rejected' as const, reason }),
          ),
        ]);
        this.portalUsers = adminData.profiles;
        this.doctorCredentials = adminData.credentials;
        this.doctorAssignments = adminData.assignments;
        this.clinicTurns = turns;
        if (tasksResult.status === 'fulfilled') {
          this.tareas = tasksResult.value.map((task) => this.toTarea(task));
          this.tasksError = '';
        } else {
          this.tareas = [];
          this.tasksError = tasksResult.reason instanceof Error
            ? tasksResult.reason.message
            : 'No se pudieron cargar las tareas.';
          syncWarnings.push(`Tareas: ${this.tasksError}`);
        }
        if (reportsResult.status === 'fulfilled') {
          this.portalReports = reportsResult.value;
          this.reportStatsAvailable = true;
        } else {
          this.portalReports = [];
          this.reportStatsAvailable = false;
          syncWarnings.push(
            reportsResult.reason instanceof Error
              ? `Reportes: ${reportsResult.reason.message}`
              : 'No se pudieron cargar los reportes.',
          );
        }
      } else {
        this.tareas = [];
        this.tasksError = '';
        this.reportStatsAvailable = false;
      }
      if (profile.role === 'doctor' || profile.role === 'patient' || profile.role === 'admin') {
        const metricsResult = await Promise.allSettled([
          this.clinicalPortal.loadDashboardMetrics(),
        ]);
        if (metricsResult[0].status === 'fulfilled') {
          this.dashboardMetrics = metricsResult[0].value;
          this.statsError = '';
        } else {
          this.dashboardMetrics = null;
          this.statsError = metricsResult[0].reason instanceof Error
            ? metricsResult[0].reason.message
            : 'No se pudieron cargar las estadísticas.';
          syncWarnings.push(`Estadísticas: ${this.statsError}`);
        }
        this.actualizarGraficaMensual();
      }
      if (this.vistaActiva === 'support') {
        this.supportConversations = await this.clinicalPortal.loadSupportConversations();
        if (this.selectedSupportConversationId && !this.supportConversations.some(
          (conversation) => conversation.id === this.selectedSupportConversationId,
        )) {
          this.selectedSupportConversationId = '';
          this.supportMessages = [];
        }
      }
      this.portalError = syncWarnings.join(' ');
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudieron sincronizar los datos del portal.';
    } finally {
      this.tasksLoading = false;
      this.statsLoading = false;
    }
  }

  get selectedSupportStatus(): SupportConversation['status'] | null {
    return this.supportConversations.find(
      (conversation) => conversation.id === this.selectedSupportConversationId,
    )?.status ?? null;
  }

  get selectedSupportCustomerUid(): string {
    return this.supportConversations.find(
      (conversation) => conversation.id === this.selectedSupportConversationId,
    )?.customer_uid ?? '';
  }

  supportCustomerName(customerUid: string): string {
    const customer = this.portalUsers.find((user) => user.id === customerUid);
    return customer ? `${customer.first_name} ${customer.last_name}` : 'Usuario';
  }

  async startSupportConversation(): Promise<void> {
    if (!this.portalProfile || this.portalProfile.role === 'admin' || this.portalBusy) return;
    this.portalBusy = true;
    this.portalError = '';
    try {
      const conversation = await this.clinicalPortal.createSupportConversation();
      this.supportConversations = [conversation, ...this.supportConversations];
      await this.selectSupportConversation(conversation);
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo iniciar el chat de soporte.';
    } finally {
      this.portalBusy = false;
    }
  }

  async selectSupportConversation(conversation: SupportConversation): Promise<void> {
    this.selectedSupportConversationId = conversation.id;
    this.portalError = '';
    try {
      this.supportMessages = await this.clinicalPortal.loadSupportMessages(conversation.id);
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo cargar la conversación de soporte.';
    }
  }

  async sendSupportMessage(): Promise<void> {
    if (!this.selectedSupportConversationId || this.portalBusy) return;
    this.portalBusy = true;
    this.portalError = '';
    try {
      await this.clinicalPortal.sendSupportMessage(
        this.selectedSupportConversationId,
        this.supportMessageDraft,
      );
      this.supportMessageDraft = '';
      this.supportMessages = await this.clinicalPortal.loadSupportMessages(
        this.selectedSupportConversationId,
      );
      await this.refreshPortalData();
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo enviar el mensaje.';
    } finally {
      this.portalBusy = false;
    }
  }

  async setSupportConversationStatus(status: SupportConversation['status']): Promise<void> {
    if (!this.selectedSupportConversationId || this.portalBusy) return;
    this.portalBusy = true;
    this.portalError = '';
    try {
      await this.clinicalPortal.updateSupportConversationStatus(
        this.selectedSupportConversationId,
        status,
      );
      await this.refreshPortalData();
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo actualizar la solicitud.';
    } finally {
      this.portalBusy = false;
    }
  }

  async selectPatientForDoctor(patient: PortalProfile): Promise<void> {
    this.selectedPatientUid = patient.id;
    this.selectedConversationId = '';
    this.portalMessages = [];
    this.portalError = '';
    try {
      const conversation = await this.clinicalPortal.getOrCreateConversation(patient.id);
      this.selectedConversationId = conversation.id;
      await this.loadDoctorMessages(conversation.id);
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo abrir la conversación.';
    }
  }

  async startPatientChat(doctor: PortalProfile): Promise<void> {
    this.portalError = '';
    try {
      this.messageType = 'chat';
      this.selectedConversationId = await this.clinicalPortal.startPatientConversation(doctor.id);
      this.selectedPatientUid = this.portalProfile?.id ?? '';
      await this.refreshPortalData();
      await this.loadDoctorMessages(this.selectedConversationId);
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo iniciar el chat.';
    }
  }

  async selectPatientConversation(conversation: ClinicalConversation): Promise<void> {
    this.selectedConversationId = conversation.id;
    this.selectedPatientUid = conversation.patient_uid;
    try {
      await this.loadDoctorMessages(conversation.id);
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo abrir la conversación.';
    }
  }

  async loadDoctorMessages(conversationId: string): Promise<void> {
    try {
      this.portalMessages = await this.clinicalPortal.loadMessages(conversationId);
      const entries = await Promise.all(
        this.portalMessages
          .filter((message) => message.attachment_path)
          .map(async (message) => [
            message.id,
            await this.clinicalPortal.signedImageUrl(message.attachment_path!),
          ] as const),
      );
      this.signedImages = Object.fromEntries(entries);
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo cargar el chat.';
    }
  }

  handleImageSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedImage = input.files?.[0] ?? null;
  }

  async sendDoctorMessage(): Promise<void> {
    const conversationId = this.selectedConversationId;
    if (!conversationId || this.portalBusy) return;
    const body = this.messageDraft.trim();
    if (!body) {
      this.portalError = 'Escribe el mensaje antes de enviarlo.';
      return;
    }
    this.portalBusy = true;
    this.portalError = '';
    let uploadedPath: string | null = null;
    try {
      if (this.selectedImage) {
        uploadedPath = await this.clinicalPortal.uploadImage(
          conversationId,
          this.selectedImage,
        );
      }
      await this.clinicalPortal.sendMessage(
        conversationId,
        body,
        this.messageType,
        uploadedPath,
      );
      this.messageDraft = '';
      this.selectedImage = null;
      await this.loadDoctorMessages(conversationId);
    } catch (error) {
      if (uploadedPath) {
        try {
          await this.clinicalPortal.removeImage(uploadedPath);
        } catch (cleanupError) {
          console.error('Could not remove an unattached clinical image:', cleanupError);
        }
      }
      this.portalError = error instanceof Error ? error.message : 'No se pudo enviar el mensaje.';
    } finally {
      this.portalBusy = false;
    }
  }

  async submitDoctorCredentials(): Promise<void> {
    this.portalBusy = true;
    this.portalError = '';
    this.portalStatus = '';
    try {
      await this.clinicalPortal.submitDoctorCredentials(this.doctorRequest);
      this.doctorRequest = {
        professionalLicense: '',
        specialty: '',
        specialtyLicense: '',
        institution: '',
        contactPhone: '',
      };
      this.portalStatus = 'Solicitud recibida; un administrador debe verificarla antes de habilitar atención.';
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo enviar la solicitud.';
    } finally {
      this.portalBusy = false;
    }
  }

  async reviewDoctor(credentials: DoctorCredentials, status: 'verified' | 'rejected'): Promise<void> {
    const notes = window.prompt('Nota de revisión (no reemplaza verificar la cédula en fuentes oficiales):') ?? '';
    if (!notes && status === 'rejected') return;
    this.portalBusy = true;
    this.portalError = '';
    this.portalStatus = '';
    try {
      await this.clinicalPortal.reviewDoctorCredentials(
        credentials.doctor_uid,
        status,
        notes,
      );
      await this.refreshPortalData();
      this.portalStatus = status === 'verified'
        ? 'Solicitud aprobada. Confirma la verificación profesional antes de asignar pacientes.'
        : 'Solicitud rechazada.';
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo revisar la solicitud.';
    } finally {
      this.portalBusy = false;
    }
  }

  selectDoctorForAssignment(doctorUid: string): void {
    this.selectedDoctorUid = doctorUid;
    this.selectedPatientUids = this.doctorAssignments
      .filter((assignment) => assignment.doctor_uid === doctorUid)
      .map((assignment) => assignment.patient_uid);
  }

  togglePatientAssignment(patientUid: string, checked: boolean): void {
    const selected = new Set(this.selectedPatientUids);
    if (checked) selected.add(patientUid);
    else selected.delete(patientUid);
    this.selectedPatientUids = [...selected];
  }

  async saveDoctorAssignments(): Promise<void> {
    if (!this.selectedDoctorUid) return;
    this.portalBusy = true;
    this.portalError = '';
    this.portalStatus = '';
    try {
      await this.clinicalPortal.assignPatients(
        this.selectedDoctorUid,
        this.selectedPatientUids,
      );
      await this.refreshPortalData();
      this.portalStatus = 'Asignaciones clínicas actualizadas.';
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudieron guardar las asignaciones.';
    } finally {
      this.portalBusy = false;
    }
  }

  async setPortalUserRole(user: PortalProfile, role: PortalRole): Promise<void> {
    this.portalBusy = true;
    this.portalError = '';
    this.portalStatus = '';
    try {
      await this.clinicalPortal.updateUserRole(user.id, role);
      await this.refreshPortalData();
      this.portalStatus = 'Rol actualizado.';
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo actualizar el rol.';
    } finally {
      this.portalBusy = false;
    }
  }

  async setPortalUserActive(user: PortalProfile, active: boolean): Promise<void> {
    this.portalBusy = true;
    this.portalError = '';
    this.portalStatus = '';
    try {
      await this.clinicalPortal.setUserActive(user.id, active);
      await this.refreshPortalData();
      this.portalStatus = active
        ? 'Cuenta reactivada. El usuario debe iniciar sesión nuevamente.'
        : 'Cuenta dada de baja. Se conserva su historial clínico y se bloqueó su acceso.';
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo actualizar el estado de la cuenta.';
    } finally {
      this.portalBusy = false;
    }
  }

  async createPortalTurn(): Promise<void> {
    this.portalBusy = true;
    this.portalError = '';
    this.portalStatus = '';
    try {
      await this.clinicalPortal.createClinicTurn(this.turnDraft);
      this.turnDraft = {
        ticket_code: '',
        patient_uid: '',
        service: 'Consulta general',
        room: 'Consultorio 1',
        priority: 'media',
        status: 'en_espera',
        eta_minutes: 0,
      };
      await this.refreshPortalData();
      await this.cargarTurnosTv();
      this.portalStatus = 'Turno guardado correctamente.';
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo guardar el turno.';
    } finally {
      this.portalBusy = false;
    }
  }

  async changePortalTurn(turn: ClinicTurn, status: ClinicTurn['status']): Promise<void> {
    this.portalBusy = true;
    try {
      await this.clinicalPortal.updateClinicTurn(turn.id, {
        status,
        eta_minutes: status === 'en_atencion' ? 0 : turn.eta_minutes,
      });
      await this.refreshPortalData();
      await this.cargarTurnosTv();
    } catch (error) {
      this.portalError = error instanceof Error ? error.message : 'No se pudo cambiar el turno.';
    } finally {
      this.portalBusy = false;
    }
  }

  get reportsForSelectedPatient(): Record<string, unknown>[] {
    return this.portalReports.filter(
      (report) => report['ownerUid'] === this.selectedPatientUid,
    );
  }

  reportPatientName(report: Record<string, unknown>): string {
    const ownerUid = report['ownerUid'];
    if (typeof ownerUid !== 'string') return 'Paciente';
    const profiles = this.portalProfile?.role === 'admin'
      ? this.portalUsers
      : this.portalPatients;
    const patient = profiles.find((profile) => profile.id === ownerUid);
    return patient ? `${patient.first_name} ${patient.last_name}` : 'Paciente';
  }

  async openReportChat(report: Record<string, unknown>): Promise<void> {
    if (this.portalProfile?.role !== 'doctor') return;
    const ownerUid = report['ownerUid'];
    const patient = typeof ownerUid === 'string'
      ? this.portalPatients.find((profile) => profile.id === ownerUid)
      : undefined;
    if (!patient) {
      this.portalError = 'El paciente ya no está entre tus asignaciones.';
      return;
    }
    await this.selectPatientForDoctor(patient);
    if (this.selectedConversationId) this.navegar('doctor-chats');
  }

  get measurementsForSelectedPatient(): Record<string, unknown>[] {
    return this.portalMeasurements.filter((measurement) =>
      measurement['owner_uid'] === this.selectedPatientUid,
    );
  }

  get doctorsForAssignment(): PortalProfile[] {
    return this.portalUsers.filter((user) => user.role === 'doctor' && user.is_active);
  }

  get patientsForAssignment(): PortalProfile[] {
    return this.portalUsers.filter((user) => user.role === 'patient' && user.is_active);
  }

  get currentDoctorCredentials(): DoctorCredentials | undefined {
    return this.doctorCredentials.find(
      (credentials) => credentials.doctor_uid === this.portalProfile?.id,
    );
  }

  get selectedDoctorPatient(): PortalProfile | undefined {
    return this.portalPatients.find((patient) => patient.id === this.selectedPatientUid);
  }

  isVerifiedDoctor(userId: string): boolean {
    return this.doctorCredentials.some(
      (credentials) => credentials.doctor_uid === userId
        && credentials.verification_status === 'verified',
    );
  }

  portalDoctorName(doctorUid: string): string {
    const doctor = this.portalDoctors.find((item) => item.id === doctorUid);
    return doctor ? `${doctor.first_name} ${doctor.last_name}` : 'Médico asignado';
  }

  formatPortalDate(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') return 'Fecha no disponible';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : date.toLocaleString();
  }

  async cargarSesionAdmin(): Promise<void> {
    this.adminToken = this.obtenerTokenGuardado();
    if (!this.adminToken) {
      return;
    }

    try {
      const data = await this.requestJson<{ session: SesionAdministrador }>('/api/admin/session', {
        headers: this.encabezadosAdmin(false),
      });
      this.adminSession = data.session;
      await this.cargarPanelAdmin(false);
    } catch {
      this.cerrarSesionAdmin();
    }
  }

  async iniciarSesionAdmin(): Promise<void> {
    this.adminBusy = true;
    this.adminMensaje = 'Validando credenciales y politicas de acceso...';

    try {
      const data = await this.requestJson<{ token: string; session: SesionAdministrador; message: string }>('/api/admin/login', {
        method: 'POST',
        headers: this.encabezadosAdmin(),
        body: JSON.stringify(this.adminLogin),
      });
      this.guardarTokenAdmin(data.token);
      this.adminSession = data.session;
      this.adminMensaje = data.message;
      this.adminLogin.password = '';
      await this.cargarPanelAdmin(false);
    } catch (error) {
      this.adminMensaje = error instanceof Error ? error.message : 'No fue posible iniciar sesion';
      this.cerrarSesionAdmin(false);
    } finally {
      this.adminBusy = false;
    }
  }

  cerrarSesionAdmin(resetMessage = true): void {
    this.limpiarTokenAdmin();
    this.adminSession = null;
    this.adminUsers = [];
    if (resetMessage) {
      this.adminMensaje = 'Sesion cerrada. Las rutas administrativas quedaron protegidas.';
    }
  }

  async cargarPanelAdmin(updateMessage = true): Promise<void> {
    if (!this.adminToken) {
      return;
    }

    try {
      const [usersData, appointmentsData] = await Promise.all([
        this.requestJson<{ users: UsuarioAdministrador[] }>('/api/admin/users', {
          headers: this.encabezadosAdmin(false),
        }),
        this.requestJson<{ appointments: TurnoAtencion[] }>('/api/admin/appointments', {
          headers: this.encabezadosAdmin(false),
        }),
      ]);

      this.adminUsers = usersData.users;
      this.turnosAtencion = appointmentsData.appointments;
      if (updateMessage) {
        this.adminMensaje = 'Panel sincronizado. Seguridad y gestion de usuarios activas.';
      }
    } catch (error) {
      this.adminMensaje = error instanceof Error ? error.message : 'No fue posible cargar el panel';
    }
  }

  async crearUsuarioAdministrador(): Promise<void> {
    if (!this.nuevoUsuario.displayName.trim() || !this.nuevoUsuario.username.trim() || !this.nuevoUsuario.password.trim()) {
      this.adminMensaje = 'Completa nombre, usuario y password del nuevo administrador.';
      return;
    }

    try {
      await this.requestJson<{ message: string }>('/api/admin/users', {
        method: 'POST',
        headers: this.encabezadosAdmin(),
        body: JSON.stringify(this.nuevoUsuario),
      });
      this.nuevoUsuario = { displayName: '', username: '', password: '', role: 'operador' };
      this.adminMensaje = 'Usuario administrativo creado correctamente.';
      await this.cargarPanelAdmin(false);
    } catch (error) {
      this.adminMensaje = error instanceof Error ? error.message : 'No fue posible crear el usuario';
    }
  }

  async alternarEstadoUsuario(user: UsuarioAdministrador): Promise<void> {
    const nextStatus: EstadoUsuario = user.status === 'activo' ? 'bloqueado' : 'activo';
    try {
      await this.requestJson<{ message: string }>(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: this.encabezadosAdmin(),
        body: JSON.stringify({ status: nextStatus }),
      });
      this.adminMensaje = `Usuario ${user.username} actualizado a ${nextStatus}.`;
      await this.cargarPanelAdmin(false);
    } catch (error) {
      this.adminMensaje = error instanceof Error ? error.message : 'No fue posible actualizar el usuario';
    }
  }

  async crearTurnoAtencion(): Promise<void> {
    if (!this.nuevoTurno.codigo.trim() || !this.nuevoTurno.paciente.trim()) {
      this.adminMensaje = 'Completa codigo y paciente para registrar el turno.';
      return;
    }

    try {
      await this.requestJson<{ message: string }>('/api/admin/appointments', {
        method: 'POST',
        headers: this.encabezadosAdmin(),
        body: JSON.stringify(this.nuevoTurno),
      });
      this.nuevoTurno = {
        codigo: '',
        paciente: '',
        servicio: 'Telemetria',
        sala: 'Modulo A',
        prioridad: 'media',
        etaMin: 8,
      };
      this.adminMensaje = 'Turno registrado en la pantalla Smart TV.';
      await this.cargarPanelAdmin(false);
      await this.cargarTurnosTv();
    } catch (error) {
      this.adminMensaje = error instanceof Error ? error.message : 'No fue posible crear el turno';
    }
  }

  async cambiarEstadoTurnoAdmin(turno: TurnoAtencion, estado: EstadoTurno): Promise<void> {
    try {
      await this.requestJson<{ message: string }>(`/api/admin/appointments/${turno.id}`, {
        method: 'PATCH',
        headers: this.encabezadosAdmin(),
        body: JSON.stringify({ estado }),
      });
      this.adminMensaje = `Turno ${turno.codigo} actualizado a ${this.etiquetaEstadoTurno(estado)}.`;
      await this.cargarPanelAdmin(false);
      await this.cargarTurnosTv();
    } catch (error) {
      this.adminMensaje = error instanceof Error ? error.message : 'No fue posible actualizar el turno';
    }
  }

  // Contact form
  contacto = { nombre: '', email: '', telefono: '', servicio: 'monitoreo', mensaje: '' };
  contactoEnviado = false;
  enviarContacto() {
    if (!this.contacto.nombre || !this.contacto.email || !this.contacto.mensaje) return;
    this.contactoEnviado = true;
    setTimeout(() => {
      this.contactoEnviado = false;
      this.contacto = { nombre: '', email: '', telefono: '', servicio: 'monitoreo', mensaje: '' };
    }, 4000);
  }

  // Dashboard tasks are fetched and scoped by the authenticated user's database policies.
  readonly taskColumns: { status: EstadoTarea; label: string; icon: string }[] = [
    { status: 'pendiente', label: 'Pendiente', icon: '⏳' },
    { status: 'en_progreso', label: 'En progreso', icon: '🔄' },
    { status: 'completada', label: 'Completada', icon: '✅' },
    { status: 'cancelada', label: 'Cancelada', icon: '✕' },
  ];
  modalVisible = false;
  taskBusy = false;
  tasksLoading = false;
  tasksError = '';
  taskNotice = '';
  taskActionError = '';
  nuevaTarea: Partial<Tarea> = {};
  tareas: Tarea[] = [];
  get totalTareas() { return this.tareas.length; }
  get tareasPendientes() { return this.tareas.filter((task) => task.estado === 'pendiente').length; }
  get tareasEnProgreso() { return this.tareas.filter((task) => task.estado === 'en_progreso').length; }
  get tareasCompletadas() { return this.tareas.filter((task) => task.estado === 'completada').length; }
  get tareasCanceladas() { return this.tareas.filter((task) => task.estado === 'cancelada').length; }
  get progresoGeneral() { return this.totalTareas === 0 ? 0 : Math.round((this.tareasCompletadas / this.totalTareas) * 100); }
  tareasPorEstado(estado: EstadoTarea): Tarea[] {
    return this.tareas.filter((task) => task.estado === estado);
  }
  private toTarea(task: DashboardTask): Tarea {
    const profile = this.portalProfile;
    const name = profile ? `${profile.first_name} ${profile.last_name}`.trim() : 'Usuario';
    return {
      id: task.id,
      titulo: task.title,
      descripcion: task.description,
      prioridad: task.priority,
      estado: task.status,
      fechaLimite: task.due_date ?? '',
      asignadoA: name,
      categoria: task.category,
    };
  }
  colorPrioridad(p: Prioridad): string {
    if (p === 'alta') return '#ef4444';
    if (p === 'media') return '#f97316';
    return '#22c55e';
  }
  colorEstado(e: EstadoTarea) { const m: Record<EstadoTarea,string> = { pendiente:'#6b7280', en_progreso:'#3b82f6', completada:'#16a34a', cancelada:'#f87171' }; return m[e]; }
  etiquetaEstado(e: EstadoTarea) { const m: Record<EstadoTarea,string> = { pendiente:'Pendiente', en_progreso:'En progreso', completada:'Completada', cancelada:'Cancelada' }; return m[e]; }
  estaVencida(t: Tarea) { return Boolean(t.fechaLimite) && new Date(`${t.fechaLimite}T23:59:59`) < new Date() && t.estado !== 'completada' && t.estado !== 'cancelada'; }
  async cambiarEstado(tarea: Tarea, estado: EstadoTarea): Promise<void> {
    if (this.taskBusy || tarea.estado === estado) return;
    this.taskBusy = true;
    this.taskNotice = '';
    this.taskActionError = '';
    try {
      const saved = await this.clinicalPortal.updateDashboardTaskStatus(tarea.id, estado);
      this.tareas = this.tareas.map((current) => current.id === saved.id ? this.toTarea(saved) : current);
      this.taskNotice = 'Tarea actualizada correctamente.';
    } catch (error) {
      this.taskActionError = error instanceof Error ? error.message : 'No se pudo actualizar la tarea.';
    } finally {
      this.taskBusy = false;
    }
  }
  async eliminarTarea(tarea: Tarea): Promise<void> {
    if (this.taskBusy || !window.confirm(`¿Eliminar la tarea "${tarea.titulo}"?`)) return;
    this.taskBusy = true;
    this.taskNotice = '';
    this.taskActionError = '';
    try {
      await this.clinicalPortal.deleteDashboardTask(tarea.id);
      this.tareas = this.tareas.filter((current) => current.id !== tarea.id);
      this.taskNotice = 'Tarea eliminada correctamente.';
    } catch (error) {
      this.taskActionError = error instanceof Error ? error.message : 'No se pudo eliminar la tarea.';
    } finally {
      this.taskBusy = false;
    }
  }
  abrirModal() {
    this.taskNotice = '';
    this.taskActionError = '';
    this.nuevaTarea = {
      prioridad: 'media',
      estado: 'pendiente',
      fechaLimite: this.dateOffset(7),
      categoria: 'Operación Clínica',
    };
    this.modalVisible = true;
  }
  cerrarModal() { this.modalVisible = false; }
  async guardarTarea(): Promise<void> {
    const title = this.nuevaTarea.titulo?.trim();
    if (!title || this.taskBusy) return;
    this.taskBusy = true;
    this.taskNotice = '';
    this.taskActionError = '';
    const input: DashboardTaskInput = {
      title,
      description: this.nuevaTarea.descripcion?.trim() ?? '',
      priority: this.nuevaTarea.prioridad ?? 'media',
      status: 'pendiente',
      due_date: this.nuevaTarea.fechaLimite || null,
      category: this.nuevaTarea.categoria?.trim() || 'Operación Clínica',
    };
    try {
      const created = await this.clinicalPortal.createDashboardTask(input);
      this.tareas = [...this.tareas, this.toTarea(created)];
      this.taskNotice = 'Tarea creada correctamente.';
      this.cerrarModal();
    } catch (error) {
      this.taskActionError = error instanceof Error ? error.message : 'No se pudo crear la tarea.';
    } finally {
      this.taskBusy = false;
    }
  }

  private actualizarGraficaMensual(): void {
    const metricMonths = new Map(
      (this.dashboardMetrics?.monthlyMeasurements ?? []).map((month) => [month.month, month.count]),
    );
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() - (5 - index));
      const label = date.toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' });
      return { label, year: date.getUTCFullYear(), month: date.getUTCMonth() };
    });
    const reportCounts = new Map<string, number>();
    for (const report of this.portalReports) {
      const date = this.reportDate(report);
      if (!date) continue;
      const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
      reportCounts.set(key, (reportCounts.get(key) ?? 0) + 1);
    }
    this.graficaMensual = months.map(({ label, year, month }) => {
      const metricLabel = label.replace(/\.$/, '').toLowerCase();
      const measurements = [...metricMonths.entries()].find(([name]) =>
        name.replace(/\.$/, '').toLowerCase() === metricLabel,
      )?.[1] ?? 0;
      return {
        mes: label,
        mediciones: measurements,
        reportes: reportCounts.get(`${year}-${month}`) ?? 0,
      };
    });
  }

  private reportDate(report: Record<string, unknown>): Date | null {
    const raw = report['createdAt'] ?? report['created_at'] ?? report['timestamp'];
    const value = typeof raw === 'object' && raw !== null && 'seconds' in raw
      ? Number((raw as { seconds: unknown }).seconds) * 1000
      : raw;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
