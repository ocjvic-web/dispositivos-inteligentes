import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type PortalRole = 'patient' | 'doctor' | 'admin';
export type ClinicalMessageType = 'chat' | 'clinical_note' | 'prescription_info';

export interface PortalProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: PortalRole;
  is_active: boolean;
  date_of_birth?: string;
  chronic_conditions?: string[];
  doctor_application_status?: DoctorCredentials['verification_status'];
  doctor_application_notes?: string | null;
}

export interface SupportConversation {
  id: string;
  customer_uid: string;
  subject: string;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface SupportMessage {
  id: string;
  conversation_id: string;
  sender_uid: string;
  body: string;
  created_at: string;
}

export interface DoctorCredentials {
  doctor_uid: string;
  professional_license: string;
  specialty: string | null;
  specialty_license: string | null;
  institution: string | null;
  contact_phone: string | null;
  verification_status: 'pending' | 'verified' | 'rejected';
  verification_notes: string | null;
}

export interface PortalRegistration {
  role: 'patient' | 'doctor';
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  chronicConditions: string[];
  otherChronicCondition: string;
  email: string;
  password: string;
  professionalLicense?: string;
  specialty?: string;
  specialtyLicense?: string;
  institution?: string;
  contactPhone?: string;
}

export interface ClinicalMessage {
  id: string;
  conversation_id: string;
  sender_uid: string;
  message_type: ClinicalMessageType;
  body: string;
  attachment_path: string | null;
  created_at: string;
  read_at: string | null;
}

export interface ClinicalConversation {
  id: string;
  doctor_uid: string;
  patient_uid: string;
  updated_at: string;
}

export interface ClinicTurn {
  id: string;
  ticket_code: string;
  patient_uid: string;
  service: string;
  room: string;
  priority: 'alta' | 'media' | 'baja';
  status: 'en_espera' | 'en_atencion' | 'finalizado' | 'cancelado';
  eta_minutes: number;
  created_at: string;
}

export type DashboardTaskStatus = 'pendiente' | 'en_progreso' | 'completada' | 'cancelada';
export type DashboardTaskPriority = 'alta' | 'media' | 'baja';

export interface DashboardTask {
  id: string;
  owner_uid: string;
  title: string;
  description: string;
  priority: DashboardTaskPriority;
  status: DashboardTaskStatus;
  due_date: string | null;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardTaskInput {
  title: string;
  description: string;
  priority: DashboardTaskPriority;
  status: DashboardTaskStatus;
  due_date: string | null;
  category: string;
}

export interface DashboardMetrics {
  patientCount: number;
  measurementCount: number;
  monthlyMeasurements: { month: string; count: number }[];
}

interface RuntimeConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export class ClinicalPortalService {
  private client: SupabaseClient | null = null;
  private initialized = false;

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly configPath = '/config.json',
    private readonly reportsPath = '/api/core/reports',
  ) {}

  get supabase(): SupabaseClient {
    if (!this.client) {
      throw new Error('La configuración de Supabase todavía no está disponible.');
    }
    return this.client;
  }

  async initialize(): Promise<PortalProfile | null> {
    if (!this.initialized) {
      const response = await this.fetcher(this.configPath, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`No se pudo cargar la configuración de Supabase (HTTP ${response.status}).`);
      }
      const config = await response.json() as Partial<RuntimeConfig>;
      if (!config.supabaseUrl || !config.supabasePublishableKey) {
        throw new Error('Falta configurar Supabase para el portal web.');
      }
      this.client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        global: { fetch: this.fetcher },
      });
      this.initialized = true;
    }

    const { data: { session }, error } = await this.supabase.auth.getSession();
    if (error) throw new Error(error.message);
    if (!session) return null;
    const profile = await this.loadProfile(session.user.id);
    if (!profile.is_active) {
      await this.signOut();
      throw new Error('Tu cuenta está dada de baja. Contacta al administrador si necesitas ayuda.');
    }
    return profile;
  }

  async signIn(email: string, password: string): Promise<PortalProfile> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes('email not confirmed')) {
        throw new Error('Confirma tu correo desde el enlace que te enviamos antes de iniciar sesión.');
      }
      if (message.includes('invalid login credentials')) {
        throw new Error('Correo o contraseña incorrectos.');
      }
      throw new Error(error.message);
    }
    if (!data.user.email_confirmed_at) {
      throw new Error('Confirma tu correo desde el enlace que te enviamos antes de iniciar sesión.');
    }
    const profile = await this.loadProfile(data.user.id);
    if (!profile.is_active) {
      await this.signOut();
      throw new Error('Tu cuenta está dada de baja. Contacta al administrador si necesitas ayuda.');
    }
    return profile;
  }

  async register(input: PortalRegistration): Promise<PortalProfile | null> {
    const options = {
      data: {
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        date_of_birth: input.dateOfBirth,
        chronic_conditions: input.role === 'patient' ? input.chronicConditions : [],
        other_chronic_condition: input.role === 'patient'
          ? input.otherChronicCondition.trim() || null
          : null,
        terms_accepted: true,
        terms_version: '1.0',
        registration_role: input.role,
        professional_license: input.role === 'doctor' ? input.professionalLicense?.trim() : null,
        specialty: input.role === 'doctor' ? input.specialty?.trim() : null,
        specialty_license: input.role === 'doctor' ? input.specialtyLicense?.trim() || null : null,
        institution: input.role === 'doctor' ? input.institution?.trim() || null : null,
        contact_phone: input.role === 'doctor' ? input.contactPhone?.trim() || null : null,
      },
      emailRedirectTo: typeof window === 'undefined' ? undefined : window.location.origin,
    };
    const { data, error } = await this.supabase.auth.signUp({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      options,
    });
    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes('already registered') || message.includes('already been registered')) {
        throw new Error('Ya existe una cuenta con ese correo.');
      }
      throw new Error(error.message);
    }
    if (!data.user) throw new Error('No se pudo crear la cuenta. Inténtalo nuevamente.');
    if (!data.session) return null;

    const profile = await this.loadProfile(data.user.id);
    if (input.role === 'doctor' && !profile.doctor_application_status) {
      throw new Error(
        'La cuenta se creó, pero no se registró la solicitud médica. Contacta al administrador antes de iniciar sesión.',
      );
    }
    return profile;
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: typeof window === 'undefined' ? undefined : window.location.origin },
    );
    if (error) throw new Error(error.message);
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }

  async loadProfile(userId: string): Promise<PortalProfile> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, email, first_name, last_name, role, is_active, date_of_birth, chronic_conditions')
      .eq('id', userId)
      .single();
    if (error) throw new Error(`No se pudo cargar el perfil: ${error.message}`);
    const profile = data as PortalProfile;
    if (!profile.is_active) return profile;
    if (profile.role === 'patient') {
      const { data: application, error: applicationError } = await this.supabase
        .from('doctor_credentials')
        .select('verification_status, verification_notes')
        .eq('doctor_uid', userId)
        .maybeSingle();
      if (applicationError) {
        throw new Error(`No se pudo consultar la solicitud médica: ${applicationError.message}`);
      }
      if (application) {
        profile.doctor_application_status = application.verification_status;
        profile.doctor_application_notes = application.verification_notes;
      }
    }
    return profile;
  }

  async loadDoctorPatients(doctorUid: string): Promise<PortalProfile[]> {
    const { data: assignments, error: assignmentError } = await this.supabase
      .from('doctor_patient_assignments')
      .select('patient_uid')
      .eq('doctor_uid', doctorUid);
    if (assignmentError) throw new Error(assignmentError.message);
    const patientUids = [...new Set((assignments ?? []).map((row) => row.patient_uid as string))];
    if (patientUids.length === 0) return [];

    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, email, first_name, last_name, date_of_birth, chronic_conditions, role, is_active')
      .in('id', patientUids)
      .eq('role', 'patient')
      .eq('is_active', true)
      .order('first_name');
    if (error) throw new Error(error.message);
    return data as PortalProfile[];
  }

  async loadPatientMeasurements(patientUids: string[]): Promise<Record<string, unknown>[]> {
    if (patientUids.length === 0) return [];
    const { data, error } = await this.supabase
      .from('measurements')
      .select('id, owner_uid, reading_at, device_name, heart_rate_bpm, oxygen_saturation_percent, body_temperature_celsius')
      .in('owner_uid', patientUids)
      .order('reading_at', { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async loadAssignedReports(): Promise<Record<string, unknown>[]> {
    const { data: { session }, error: sessionError } = await this.supabase.auth.getSession();
    if (sessionError) throw new Error(sessionError.message);
    if (!session?.access_token) throw new Error('Inicia sesión para consultar los reportes.');
    const response = await this.fetcher(this.reportsPath, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    });
    const payload = await response.json() as {
      reports?: Record<string, unknown>[];
      message?: string;
    };
    if (!response.ok) {
      throw new Error(payload.message ?? `No se pudieron cargar los reportes (HTTP ${response.status}).`);
    }
    if (!Array.isArray(payload.reports)) {
      throw new Error('La API devolvió una respuesta de reportes no válida.');
    }
    return payload.reports;
  }

  async loadDoctorConversations(doctorUid: string): Promise<ClinicalConversation[]> {
    const { data, error } = await this.supabase
      .from('clinical_conversations')
      .select('id, doctor_uid, patient_uid, updated_at')
      .eq('doctor_uid', doctorUid)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data as ClinicalConversation[];
  }

  async loadPatientConversations(patientUid: string): Promise<ClinicalConversation[]> {
    const { data, error } = await this.supabase
      .from('clinical_conversations')
      .select('id, doctor_uid, patient_uid, updated_at')
      .eq('patient_uid', patientUid)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data as ClinicalConversation[];
  }

  async loadAssignedDoctors(patientUid: string): Promise<PortalProfile[]> {
    const { data: assignments, error: assignmentError } = await this.supabase
      .from('doctor_patient_assignments')
      .select('doctor_uid')
      .eq('patient_uid', patientUid);
    if (assignmentError) throw new Error(assignmentError.message);
    const doctorUids = [...new Set((assignments ?? []).map((row) => row.doctor_uid as string))];
    if (doctorUids.length === 0) return [];

    const { data, error } = await this.supabase
      .from('profiles')
      .select('id, email, first_name, last_name, role, is_active')
      .eq('role', 'doctor')
      .eq('is_active', true)
      .in('id', doctorUids)
      .order('first_name');
    if (error) throw new Error(error.message);
    return data as PortalProfile[];
  }

  async startPatientConversation(doctorUid: string): Promise<string> {
    const { data, error } = await this.supabase.rpc('create_clinical_conversation', {
      target_doctor_uid: doctorUid,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async getOrCreateConversation(patientUid: string): Promise<ClinicalConversation> {
    const doctorUid = await this.authenticatedUserId();
    const { data: existing, error: lookupError } = await this.supabase
      .from('clinical_conversations')
      .select('id, doctor_uid, patient_uid, updated_at')
      .eq('doctor_uid', doctorUid)
      .eq('patient_uid', patientUid)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (existing) return existing as ClinicalConversation;

    const { data, error } = await this.supabase
      .from('clinical_conversations')
      .insert({ doctor_uid: doctorUid, patient_uid: patientUid })
      .select('id, doctor_uid, patient_uid, updated_at')
      .single();
    if (error) {
      if (error.code === '23505') {
        return this.getOrCreateConversation(patientUid);
      }
      throw new Error(error.message);
    }
    return data as ClinicalConversation;
  }

  async loadMessages(conversationId: string): Promise<ClinicalMessage[]> {
    const { data, error } = await this.supabase
      .from('clinical_messages')
      .select('id, conversation_id, sender_uid, message_type, body, attachment_path, created_at, read_at')
      .eq('conversation_id', conversationId)
      .order('created_at');
    if (error) throw new Error(error.message);
    return data as ClinicalMessage[];
  }

  async sendMessage(
    conversationId: string,
    body: string,
    type: ClinicalMessageType,
    attachmentPath: string | null = null,
  ): Promise<void> {
    const normalizedBody = body.trim();
    if (!normalizedBody || normalizedBody.length > 4000) {
      throw new Error('El mensaje debe tener entre 1 y 4000 caracteres.');
    }
    const senderUid = await this.authenticatedUserId();
    const { error } = await this.supabase.from('clinical_messages').insert({
      conversation_id: conversationId,
      sender_uid: senderUid,
      message_type: type,
      body: normalizedBody,
      attachment_path: attachmentPath,
    });
    if (error) throw new Error(error.message);
  }

  async uploadImage(conversationId: string, file: File): Promise<string> {
    const allowedTypes = new Set(['image/jpeg', 'image/png']);
    if (!allowedTypes.has(file.type)) {
      throw new Error('Solo se aceptan imágenes JPEG o PNG.');
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      throw new Error('La imagen debe medir como máximo 10 MB.');
    }
    const userId = await this.authenticatedUserId();
    const extension = file.type === 'image/png' ? 'png' : 'jpg';
    const path = `${conversationId}/${userId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await this.supabase.storage
      .from('clinical-attachments')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(error.message);
    return path;
  }

  async signedImageUrl(path: string): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from('clinical-attachments')
      .createSignedUrl(path, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }

  async removeImage(path: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from('clinical-attachments')
      .remove([path]);
    if (error) throw new Error(error.message);
  }

  async loadAdminUsers(): Promise<{
    profiles: PortalProfile[];
    credentials: DoctorCredentials[];
    assignments: { doctor_uid: string; patient_uid: string }[];
  }> {
    const [profiles, credentials, assignments] = await Promise.all([
      this.supabase
        .from('profiles')
        .select('id, email, first_name, last_name, role, is_active')
        .order('first_name'),
      this.supabase
        .from('doctor_credentials')
        .select('doctor_uid, professional_license, specialty, specialty_license, institution, contact_phone, verification_status, verification_notes'),
      this.supabase
        .from('doctor_patient_assignments')
        .select('doctor_uid, patient_uid'),
    ]);
    const failed = [profiles.error, credentials.error, assignments.error].find(Boolean);
    if (failed) throw new Error(failed.message);
    return {
      profiles: profiles.data as PortalProfile[],
      credentials: credentials.data as DoctorCredentials[],
      assignments: assignments.data ?? [],
    };
  }

  async submitDoctorCredentials(input: {
    professionalLicense: string;
    specialty: string;
    specialtyLicense: string;
    institution: string;
    contactPhone: string;
  }): Promise<void> {
    const userId = await this.authenticatedUserId();
    const { error } = await this.supabase.from('doctor_credentials').insert({
      doctor_uid: userId,
      professional_license: input.professionalLicense.trim(),
      specialty: input.specialty.trim() || null,
      specialty_license: input.specialtyLicense.trim() || null,
      institution: input.institution.trim() || null,
      contact_phone: input.contactPhone.trim() || null,
    });
    if (error) throw new Error(error.message);
  }

  async reviewDoctorCredentials(
    doctorUid: string,
    status: 'verified' | 'rejected',
    notes: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('doctor_credentials')
      .update({ verification_status: status, verification_notes: notes.trim() || null })
      .eq('doctor_uid', doctorUid);
    if (error) throw new Error(error.message);
    if (status === 'verified') {
      const { error: roleError } = await this.supabase
        .from('profiles')
        .update({ role: 'doctor' })
        .eq('id', doctorUid);
      if (roleError) throw new Error(roleError.message);
    }
  }

  async updateUserRole(userUid: string, role: PortalRole): Promise<void> {
    const { error } = await this.supabase
      .from('profiles')
      .update({ role })
      .eq('id', userUid);
    if (error) throw new Error(error.message);
  }

  async setUserActive(userUid: string, active: boolean): Promise<void> {
    const { error } = await this.supabase.rpc('set_user_active', {
      target_user_uid: userUid,
      target_is_active: active,
    });
    if (error) throw new Error(error.message);
  }

  async loadSupportConversations(): Promise<SupportConversation[]> {
    const { data, error } = await this.supabase
      .from('support_conversations')
      .select('id, customer_uid, subject, status, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data as SupportConversation[];
  }

  async createSupportConversation(subject = 'Soporte general'): Promise<SupportConversation> {
    const customerUid = await this.authenticatedUserId();
    const { data, error } = await this.supabase
      .from('support_conversations')
      .insert({ customer_uid: customerUid, subject: subject.trim() })
      .select('id, customer_uid, subject, status, created_at, updated_at')
      .single();
    if (error) throw new Error(error.message);
    return data as SupportConversation;
  }

  async loadSupportMessages(conversationId: string): Promise<SupportMessage[]> {
    const { data, error } = await this.supabase
      .from('support_messages')
      .select('id, conversation_id, sender_uid, body, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at');
    if (error) throw new Error(error.message);
    return data as SupportMessage[];
  }

  async sendSupportMessage(conversationId: string, body: string): Promise<void> {
    const normalizedBody = body.trim();
    if (!normalizedBody || normalizedBody.length > 4000) {
      throw new Error('El mensaje debe tener entre 1 y 4000 caracteres.');
    }
    const senderUid = await this.authenticatedUserId();
    const { error } = await this.supabase.from('support_messages').insert({
      conversation_id: conversationId,
      sender_uid: senderUid,
      body: normalizedBody,
    });
    if (error) throw new Error(error.message);
  }

  async updateSupportConversationStatus(
    conversationId: string,
    status: SupportConversation['status'],
  ): Promise<void> {
    const { error } = await this.supabase
      .from('support_conversations')
      .update({ status })
      .eq('id', conversationId);
    if (error) throw new Error(error.message);
  }

  async assignPatients(doctorUid: string, patientUids: string[]): Promise<void> {
    const { error } = await this.supabase.rpc('replace_doctor_assignments', {
      target_doctor_uid: doctorUid,
      target_patient_uids: patientUids,
    });
    if (error) throw new Error(error.message);
  }

  async loadClinicTurns(): Promise<ClinicTurn[]> {
    const { data, error } = await this.supabase
      .from('clinic_turns')
      .select('id, ticket_code, patient_uid, service, room, priority, status, eta_minutes, created_at')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data as ClinicTurn[];
  }

  async loadDashboardTasks(): Promise<DashboardTask[]> {
    const { data, error } = await this.supabase
      .from('dashboard_tasks')
      .select('id, owner_uid, title, description, priority, status, due_date, category, created_at, updated_at')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data as DashboardTask[];
  }

  async createDashboardTask(input: DashboardTaskInput): Promise<DashboardTask> {
    const { data, error } = await this.supabase
      .from('dashboard_tasks')
      .insert(input)
      .select('id, owner_uid, title, description, priority, status, due_date, category, created_at, updated_at')
      .single();
    if (error) throw new Error(error.message);
    return data as DashboardTask;
  }

  async updateDashboardTaskStatus(
    taskId: string,
    status: DashboardTaskStatus,
  ): Promise<DashboardTask> {
    const { data, error } = await this.supabase
      .from('dashboard_tasks')
      .update({ status })
      .eq('id', taskId)
      .select('id, owner_uid, title, description, priority, status, due_date, category, created_at, updated_at')
      .single();
    if (error) throw new Error(error.message);
    return data as DashboardTask;
  }

  async deleteDashboardTask(taskId: string): Promise<void> {
    const { error } = await this.supabase
      .from('dashboard_tasks')
      .delete()
      .eq('id', taskId);
    if (error) throw new Error(error.message);
  }

  async loadDashboardMetrics(): Promise<DashboardMetrics> {
    const monthStarts = Array.from({ length: 6 }, (_, index) => {
      const current = new Date();
      return new Date(Date.UTC(
        current.getUTCFullYear(),
        current.getUTCMonth() - (5 - index),
        1,
      ));
    });
    const monthlyQueries = monthStarts.map(async (start) => {
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const { count, error } = await this.supabase
        .from('measurements')
        .select('id', { count: 'exact', head: true })
        .gte('reading_at', start.toISOString())
        .lt('reading_at', end.toISOString());
      if (error) throw new Error(error.message);
      return {
        month: start.toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' }),
        count: count ?? 0,
      };
    });

    const [patients, measurements, monthlyMeasurements] = await Promise.all([
      this.supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'patient'),
      this.supabase
        .from('measurements')
        .select('id', { count: 'exact', head: true }),
      Promise.all(monthlyQueries),
    ]);

    const failed = [patients.error, measurements.error].find(Boolean);
    if (failed) throw new Error(failed.message);
    return {
      patientCount: patients.count ?? 0,
      measurementCount: measurements.count ?? 0,
      monthlyMeasurements,
    };
  }

  async createClinicTurn(input: Omit<ClinicTurn, 'id' | 'created_at'>): Promise<void> {
    const createdBy = await this.authenticatedUserId();
    const { error } = await this.supabase
      .from('clinic_turns')
      .insert({ ...input, created_by: createdBy });
    if (error) throw new Error(error.message);
  }

  async updateClinicTurn(
    id: string,
    changes: Pick<ClinicTurn, 'status' | 'eta_minutes'>,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('clinic_turns')
      .update(changes)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  private async authenticatedUserId(): Promise<string> {
    const { data: { user }, error } = await this.supabase.auth.getUser();
    if (error) throw new Error(error.message);
    if (!user) throw new Error('Inicia sesión para continuar.');
    return user.id;
  }
}
