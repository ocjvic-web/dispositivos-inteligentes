# BioMedica Web + Smart TV

Aplicación Angular con bridge Node.js para:

- monitoreo clínico web
- pantalla Smart TV con turnos de atención y telemetría
- panel administrativo con autenticación y gestión de usuarios
- integración con smartwatch Flutter/Wear OS

## Ejecutar en local

Frontend Angular:

```bash
npm install
npm start
```

Bridge Node con APIs y build estático:

```bash
npm install
npm run build
npm run serve:prod
```

La web queda en:

- `http://localhost:4200` en desarrollo Angular
- `http://localhost:4300` cuando sirves el build desde Node

## Accesos y rutas importantes

- Web principal: `/`
- Vista wearables: `/wearable`
- Vista LG webOS: `/webos`
- Pantalla Smart TV: `/tv`
- Panel admin: `/admin`

Credenciales demo admin por defecto:

- usuario: `admin`
- contraseña: `AdminBio2026!`

En producción cambia esas credenciales con variables de entorno.

## Seguridad incluida

- autenticación admin con token firmado y expiración de sesión
- creación y bloqueo de usuarios administrativos
- validación mínima de contraseñas fuertes
- cabeceras HTTP de seguridad: CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`

Nota: esto es una base académica/demostrativa. Para un sistema real con datos de salud faltaría persistencia segura, hashing con sal y algoritmo resistente como bcrypt/argon2, auditoría, rate limiting y HTTPS estricto extremo a extremo.

## Despliegue gratuito recomendado

La opción gratuita más práctica para este proyecto es Render porque sirve bien una app Node con Angular compilado y te da subdominio público `onrender.com`.

Archivo incluido para despliegue: `render.yaml`

Variables de entorno recomendadas en Render:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
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
4. Define `ADMIN_PASSWORD` y `SESSION_SECRET` con valores propios.
5. Al desplegar tendrás una URL pública como `https://tu-app.onrender.com`.

## Smartwatch Flutter hacia dominio público

El bridge del reloj ahora acepta URL por `dart-define`.

Ejemplo para emulador o smartwatch:

```bash
flutter run --dart-define=TELEMETRY_BASE_URL=https://tu-app.onrender.com
```

En Android Emulator local sigue funcionando el valor por defecto `http://10.0.2.2:4300`.

## Validación realizada

- `npm run build` correcto
- `node --check server.js` correcto
- login admin y feed `/api/tv-feed` verificados localmente
