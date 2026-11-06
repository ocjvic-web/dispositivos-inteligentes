# BioMedica Web + Smart TV

Aplicación Angular con bridge Node.js para:

- monitoreo clínico web
- pantalla Smart TV con turnos de atención y telemetría
- portal autenticado por rol: paciente, médico y administrador
- chat clínico privado entre pacientes y médicos asignados
- reportes Firebase consultados a través de la API BioMedica
- perfiles, asignaciones, mediciones y turnos compartidos en Supabase
- integración con smartwatch Flutter/Wear OS

## Ejecutar en local

Para ejecutar el portal con los endpoints de configuración y proxy, inicia el bridge Node. En PowerShell:

```bash
npm ci
npm run build
$env:SUPABASE_URL = "https://<tu-proyecto>.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY = "<publishable-key>"
$env:BIOMEDICA_CORE_API_URL = "https://app-biomedica-web.onrender.com"
npm run serve:prod
```

La aplicación queda en `http://localhost:4300`. Para desarrollar el Angular por separado, ejecuta `npm start`; el bridge debe seguir activo en el puerto 4300 y tener las variables anteriores configuradas.

## Accesos y rutas importantes

- Web principal: `/`
- Vista wearables: `/wearable`
- Vista LG webOS: `/webos`
- Pantalla Smart TV: `/tv`
- Portal clínico: `/admin`

## Seguridad incluida

- La web y la app móvil autentican contra el mismo proyecto Supabase. El registro web de pacientes conserva los datos y la aceptación de términos de la app; el registro médico solicita credenciales profesionales para revisión.
- Las solicitudes médicas se guardan como pendientes y mantienen el rol paciente hasta que un administrador revise y apruebe las credenciales. La revisión es administrativa y no consulta automáticamente una fuente oficial.
- El primer administrador debe habilitarse manualmente en Supabase. No hay registro público de administradores.
- Un médico solo consulta pacientes asignados; la habilitación requiere revisión administrativa de credenciales.
- La navegación web cambia según la sesión: visitante, paciente, médico y administrador tienen módulos distintos. Los módulos protegidos también se validan al navegar directamente a una URL.
- El administrador puede asignar pacientes a médicos aprobados, gestionar roles y dar de baja cuentas sin borrar el historial. Las cuentas inactivas quedan bloqueadas por políticas RLS; la reactivación es administrativa.
- El chat de soporte está separado del chat clínico y limita cada conversación al cliente propietario y al equipo administrador.
- El chat y sus imágenes usan tablas y almacenamiento privados con RLS; imágenes JPEG/PNG de hasta 10 MB.
- El proxy de reportes envía el token Supabase a la API de BioMedica; los administradores no reciben acceso al contenido clínico.
- Los endpoints administrativos locales heredados `/api/admin/*` responden `410 Gone`.

La verificación interna de credenciales no equivale a comprobar una cédula ante fuentes oficiales ni certifica cumplimiento regulatorio. No usar con información clínica real hasta completar revisión de seguridad, legal y operativa.

## Despliegue gratuito recomendado

La opción gratuita más práctica para este proyecto es Render porque sirve bien una app Node con Angular compilado y te da subdominio público `onrender.com`.

Archivo incluido para despliegue: `render.yaml`

Variables de entorno recomendadas en Render:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (nunca usar `service_role` en el navegador)
- `BIOMEDICA_CORE_API_URL` (URL de la API móvil)
- `PORT` (Render la inyecta normalmente)

Pasos:

```bash
git add .
git commit -m "Preparar despliegue BioMedica"
git push
```

Luego en Render:

1. Conecta tu repositorio.
2. Crea un `Web Service`.
3. Usa el `render.yaml` del proyecto o configura:
	- Build Command: `npm install && npm run build`
	- Start Command: `npm run serve:prod`
4. Define las variables de Supabase y API en el servicio web, sin subirlas al repositorio.
5. Al desplegar tendrás una URL pública como `https://tu-app.onrender.com`.

La migración `../biomedica_app/supabase/migrations/20261105000000_clinical_chat_and_turns.sql` debe revisarse y aplicarse en el mismo proyecto Supabase que utiliza la app móvil antes de habilitar chat, asignaciones y turnos compartidos.
La migración `../biomedica_app/supabase/migrations/20261106000000_doctor_registration_application.sql` también debe aplicarse antes de habilitar el registro web de médicos; registra de forma segura cada solicitud como pendiente sin otorgar privilegios clínicos.
La migración `../biomedica_app/supabase/migrations/20261106010000_user_management_and_support.sql` añade el estado de cuenta, las restricciones RLS para usuarios inactivos y las tablas privadas del chat de soporte. Debe aplicarse en el mismo proyecto Supabase de la aplicación móvil antes de usar esas funciones.

## Smartwatch Flutter hacia dominio público

El bridge del reloj ahora acepta URL por `dart-define`.

Ejemplo para emulador o smartwatch:

```bash
flutter run --dart-define=TELEMETRY_BASE_URL=https://tu-app.onrender.com
```

En Android Emulator local sigue funcionando el valor por defecto `http://10.0.2.2:4300`.

## Validación realizada

- `npm run build` y `npm test -- --watch=false` se ejecutan localmente.
- `node --check server.js` valida la sintaxis del bridge.
- Las funciones clínicas requieren variables de entorno y la migración Supabase indicada.
- No afirmar transferencia real autenticada hasta verificar una cuenta de prueba y el estado de la migración.
