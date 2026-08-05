import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { environment } from '../environments/environment';

export type EstadoTarea = 'pendiente' | 'en_progreso' | 'completada' | 'cancelada';
export type Prioridad = 'alta' | 'media' | 'baja';
type VistaActiva = 'inicio' | 'dashboard' | 'wearable' | 'webos' | 'tvwall' | 'admin' | 'contacto' | 'estadisticas';
type RolAdministrador = 'superadmin' | 'operador' | 'visor';
type EstadoUsuario = 'activo' | 'bloqueado';
type EstadoTurno = 'en_espera' | 'en_atencion' | 'finalizado';

export interface Tarea {
  id: number;
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
  estado: 'Disponible' | 'Emparejado';
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

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {
  private readonly adminTokenStorageKey = 'biomedica.admin.token';
  private readonly routeMap: Record<VistaActiva, string> = {
    inicio: '/',
    dashboard: '/dashboard',
    wearable: '/wearable',
    webos: '/webos',
    tvwall: '/tv',
    admin: '/admin',
    contacto: '/contacto',
    estadisticas: '/estadisticas',
  };

  vistaActiva: VistaActiva = 'inicio';
  menuAbierto = false;
  puenteActivo = false;
  puenteMensaje = 'Puente local desconectado. Inicia el servidor para ver datos en vivo.';
  wearableSeleccionadoId = 'wear-01';
  tvSeleccionadaId = 'tv-lg-01';
  tvEmparejada = false;
  tvMensaje = 'LG webOS listo para emparejar la telemetría desde el wearable.';
  tvWallUrl = '/tv';
  lastTelemetry: TelemetrySnapshot = {
    wearableId: 'wear-01',
    heartRate: 72,
    spo2: 98,
    temperature: 36.6,
    battery: 84,
    steps: 8430,
    stress: 22,
    respiratoryRate: 14,
    hrv: 64,
    signalQuality: 96,
    perfusionIndex: 5.2,
    sequence: 0,
    source: 'bridge-seed',
  };

  private bridgeInterval: ReturnType<typeof setInterval> | null = null;
  adminToken = '';
  adminBusy = false;
  adminMensaje = 'Acceso restringido a administradores autorizados.';
  adminLogin = { username: 'admin', password: '' };
  adminSession: SesionAdministrador | null = null;
  adminUsers: UsuarioAdministrador[] = [];
  turnosAtencion: TurnoAtencion[] = [];
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
    this.vistaActiva = vista;
    this.menuAbierto = false;
    this.sincronizarRuta();
    if (vista !== 'tvwall') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
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
    await this.cargarSesionAdmin();
    await Promise.all([this.cargarEstadoPuente(), this.cargarTurnosTv()]);
    this.bridgeInterval = setInterval(() => {
      void this.cargarEstadoPuente();
      void this.cargarTurnosTv();
      if (this.adminToken) {
        void this.cargarPanelAdmin(false);
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

  wearables = [
    {
      id: 'wear-01',
      nombre: 'Wear OS XL Round',
      modelo: 'Emulador biomédico',
      estado: 'Conectado',
      bateria: 84,
      ritmoCardiaco: 72,
      spo2: 98,
      temperatura: 36.6,
      ubicacion: 'Pulsera clínica principal',
    },
    {
      id: 'wear-02',
      nombre: 'CardioBand Pro',
      modelo: 'Smartband ECG',
      estado: 'En espera',
      bateria: 66,
      ritmoCardiaco: 79,
      spo2: 97,
      temperatura: 36.4,
      ubicacion: 'Paciente en reposo',
    },
    {
      id: 'wear-03',
      nombre: 'Vital Watch Lite',
      modelo: 'Reloj biométrico',
      estado: 'Sincronizando',
      bateria: 58,
      ritmoCardiaco: 68,
      spo2: 99,
      temperatura: 36.2,
      ubicacion: 'Sala de observación',
    },
  ] satisfies WearableDevice[];

  tvs = [
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
      estado: 'Emparejado',
      appActiva: 'Dashboard de signos vitales',
    },
  ] satisfies TvDevice[];

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

  private async cargarEstadoPuente(): Promise<void> {
    try {
      const data = await this.requestJson<{
        wearable?: Partial<WearableDevice>;
        tv?: Partial<TvDevice>;
        tvPaired?: boolean;
        lastTelemetry?: Partial<TelemetrySnapshot>;
      }>('/api/status');

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
      this.puenteActivo = true;
      this.puenteMensaje = `Puente activo · wearable ${data.wearable?.nombre ?? 'N/A'} · TV ${data.tv?.nombre ?? 'N/A'} · seq ${this.lastTelemetry.sequence ?? 0}`;
      this.tvMensaje = this.tvEmparejada
        ? `Conexión real activa: ${data.wearable?.nombre ?? 'Wearable'} → ${data.tv?.nombre ?? 'LG webOS'}.`
        : 'Puente listo. Selecciona wearable y TV para emparejar.';
    } catch {
      this.puenteActivo = false;
      this.puenteMensaje = 'Puente local no disponible. Ejecuta node server.js en pagina-web.';
    }
  }

  async cargarTurnosTv(): Promise<void> {
    try {
      const data = await this.requestJson<{
        queue: TurnoAtencion[];
        currentTurn: TurnoAtencion | null;
      }>('/api/tv-feed');

      const cola = [...data.queue];
      if (data.currentTurn) {
        cola.unshift(data.currentTurn);
      }
      this.turnosAtencion = cola;
    } catch {
      if (this.turnosAtencion.length === 0) {
        this.turnosAtencion = [
          {
            id: 'fallback-1',
            codigo: 'A-001',
            paciente: 'Paciente de demostracion',
            servicio: 'Cardiologia',
            sala: 'Modulo A',
            prioridad: 'alta',
            estado: 'en_atencion',
            etaMin: 0,
            updatedAt: new Date().toISOString(),
          },
        ];
      }
    }
  }

  statsHome = [
    { valor: '12,847', label: 'Pacientes Monitoreados', icon: '🏥', color: '#001ef8' },
    { valor: '384', label: 'Dispositivos Conectados', icon: '📡', color: '#f80000' },
    { valor: '2,931', label: 'Alertas Resueltas', icon: '🔔', color: '#10b981' },
    { valor: '99.7%', label: 'Uptime Garantizado', icon: '⚡', color: '#f59e0b' },
  ];

  servicios = [
    { titulo: 'Telemetría Hospitalaria', desc: 'Monitoreo 24/7 de signos vitales con alertas automáticas y tableros clínicos en tiempo real.', icon: '📊' },
    { titulo: 'Integración HL7/FHIR', desc: 'Interoperabilidad total con sistemas HIS, LIS y EHR mediante estándares internacionales.', icon: '🔗' },
    { titulo: 'IA Biomédica', desc: 'Algoritmos de análisis predictivo sobre señales cardiacas, respiratorias y metabólicas.', icon: '🤖' },
    { titulo: 'Wearables Clínicos', desc: 'Compatibilidad con más de 200 dispositivos médicos certificados para uso hospitalario.', icon: '⌚' },
    { titulo: 'Seguridad Regulatoria', desc: 'Cumplimiento HIPAA, ISO 27001 y normativas locales para datos de salud.', icon: '🔒' },
    { titulo: 'Soporte 24/7', desc: 'Equipo de ingenieros biomédicos disponibles en todo momento para soporte técnico.', icon: '🛟' },
  ];

  // Estadísticas view
  graficaMensual = [
    { mes: 'Ene', pacientes: 820, alertas: 198 },
    { mes: 'Feb', pacientes: 950, alertas: 231 },
    { mes: 'Mar', pacientes: 1100, alertas: 267 },
    { mes: 'Abr', pacientes: 1040, alertas: 244 },
    { mes: 'May', pacientes: 1280, alertas: 310 },
    { mes: 'Jun', pacientes: 1430, alertas: 352 },
  ];
  maxPacientes = 1430;

  dispositivosTipo = [
    { tipo: 'Monitores ECG', cantidad: 142, color: '#001ef8' },
    { tipo: 'Pulsioxímetros', cantidad: 98, color: '#f80000' },
    { tipo: 'Glucómetros', cantidad: 64, color: '#10b981' },
    { tipo: 'Holters', cantidad: 48, color: '#f59e0b' },
    { tipo: 'Otros', cantidad: 32, color: '#8b5cf6' },
  ];
  totalDispositivos = 384;
  porcentaje(n: number) { return Math.round((n / this.totalDispositivos) * 100); }

  get wearableSeleccionado(): WearableDevice {
    return this.wearables.find((w) => w.id === this.wearableSeleccionadoId) ?? this.wearables[0];
  }

  get tvSeleccionada(): TvDevice {
    return this.tvs.find((tv) => tv.id === this.tvSeleccionadaId) ?? this.tvs[0];
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
    this.tvMensaje = `Wearable ${this.wearableSeleccionado.nombre} listo para enviar datos a LG webOS.`;
  }

  seleccionarTv(id: string) {
    this.tvSeleccionadaId = id;
    this.tvMensaje = `${this.tvSeleccionada.nombre} seleccionada para visualización en LG webOS.`;
  }

  conectarWebOS() {
    void fetch(this.api('/api/pair'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wearableId: this.wearableSeleccionadoId, tvId: this.tvSeleccionadaId }),
    }).finally(() => void this.cargarEstadoPuente());
  }

  desconectarWebOS() {
    void fetch(this.api('/api/unpair'), { method: 'POST' })
      .finally(() => void this.cargarEstadoPuente());
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

  // Dashboard
  filtroEstado: EstadoTarea | 'todos' = 'todos';
  modalVisible = false;
  nuevaTarea: Partial<Tarea> = {};
  nextId = 9;
  tareas: Tarea[] = [
    { id: 1, titulo: 'Validar dashboard de signos vitales', descripcion: 'Verificar visualización de ECG, SpO2 y presión arterial.', prioridad: 'alta', estado: 'completada', fechaLimite: '2026-06-10', asignadoA: 'Dra. Ana García', categoria: 'Monitoreo Clínico' },
    { id: 2, titulo: 'Implementar API HL7/FHIR de pacientes', descripcion: 'Endpoints para interoperabilidad clínica y trazabilidad de historiales.', prioridad: 'alta', estado: 'en_progreso', fechaLimite: '2026-06-25', asignadoA: 'Ing. Carlos López', categoria: 'Integración Clínica' },
    { id: 3, titulo: 'Pruebas de calidad de señal biomédica', descripcion: 'Cobertura de pruebas sobre ruido, latencia y estabilidad de sensores.', prioridad: 'media', estado: 'pendiente', fechaLimite: '2026-07-01', asignadoA: 'Laura Martínez', categoria: 'QA Biomédica' },
    { id: 4, titulo: 'Configurar despliegue seguro hospitalario', descripcion: 'Pipeline con validaciones regulatorias y auditoría de eventos.', prioridad: 'media', estado: 'en_progreso', fechaLimite: '2026-06-30', asignadoA: 'Víctor Orozco', categoria: 'DevOps Clínico' },
    { id: 5, titulo: 'Documentar protocolos de alarmas médicas', descripcion: 'Guías para umbrales y notificaciones de eventos críticos.', prioridad: 'baja', estado: 'completada', fechaLimite: '2026-06-18', asignadoA: 'Víctor Orozco', categoria: 'Documentación Clínica' },
    { id: 6, titulo: 'Optimizar consultas de biomarcadores', descripcion: 'Acelerar paneles de laboratorio con índices y caché clínico.', prioridad: 'alta', estado: 'pendiente', fechaLimite: '2026-06-12', asignadoA: 'Ing. Carlos López', categoria: 'Datos Biomédicos' },
    { id: 7, titulo: 'Actualizar firmware de dispositivos legacy', descripcion: 'Sincronizar versiones para monitores antiguos de planta.', prioridad: 'baja', estado: 'cancelada', fechaLimite: '2026-05-30', asignadoA: 'Dra. Ana García', categoria: 'Mantenimiento Biomédico' },
    { id: 8, titulo: 'Integrar panel Flutter de telemetría', descripcion: 'Embebido de vista clínica Flutter dentro del portal Angular.', prioridad: 'media', estado: 'en_progreso', fechaLimite: '2026-06-28', asignadoA: 'Víctor Orozco', categoria: 'Frontend Clínico' },
  ];
  get totalTareas() { return this.tareas.length; }
  get tareasPendientes() { return this.tareas.filter(t => t.estado === 'pendiente').length; }
  get tareasEnProgreso() { return this.tareas.filter(t => t.estado === 'en_progreso').length; }
  get tareasCompletadas() { return this.tareas.filter(t => t.estado === 'completada').length; }
  get tareasCanceladas() { return this.tareas.filter(t => t.estado === 'cancelada').length; }
  get progresoGeneral() { return this.totalTareas === 0 ? 0 : Math.round((this.tareasCompletadas / this.totalTareas) * 100); }
  get tareasFiltradas() { return this.filtroEstado === 'todos' ? this.tareas : this.tareas.filter(t => t.estado === this.filtroEstado); }
  colorPrioridad(p: Prioridad): string {
    if (p === 'alta') return '#ef4444';
    if (p === 'media') return '#f97316';
    return '#22c55e';
  }
  colorEstado(e: EstadoTarea) { const m: Record<EstadoTarea,string> = { pendiente:'#6b7280', en_progreso:'#3b82f6', completada:'#16a34a', cancelada:'#f87171' }; return m[e]; }
  etiquetaEstado(e: EstadoTarea) { const m: Record<EstadoTarea,string> = { pendiente:'Pendiente', en_progreso:'En Progreso', completada:'Completada', cancelada:'Cancelada' }; return m[e]; }
  estaVencida(t: Tarea) { return new Date(t.fechaLimite) < new Date() && t.estado !== 'completada' && t.estado !== 'cancelada'; }
  cambiarEstado(tarea: Tarea, estado: EstadoTarea) { tarea.estado = estado; }
  abrirModal() { this.nuevaTarea = { prioridad: 'media', estado: 'pendiente', categoria: 'Operación Clínica' }; this.modalVisible = true; }
  cerrarModal() { this.modalVisible = false; }
  guardarTarea() {
    if (!this.nuevaTarea.titulo?.trim()) return;
    this.tareas.push({ id: this.nextId++, titulo: this.nuevaTarea.titulo ?? '', descripcion: this.nuevaTarea.descripcion || '', prioridad: this.nuevaTarea.prioridad || 'media', estado: 'pendiente', fechaLimite: this.nuevaTarea.fechaLimite || new Date(Date.now() + 7*86400000).toISOString().slice(0,10), asignadoA: this.nuevaTarea.asignadoA || 'Sin asignar', categoria: this.nuevaTarea.categoria || 'Operación Clínica' });
    this.cerrarModal();
  }
}
