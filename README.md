# ParkSpotter

Aplicación web instalable (PWA) para **alquilar garajes en desuso como parqueadero en Bogotá**.
Proyecto de la Práctica de Ingeniería III. Conecta a **conductores** que buscan parqueadero con **propietarios**
que ofrecen su garaje por horas.

> Los pagos son **simulados**: no se cobra dinero ni se piden datos de tarjeta.

## Tecnologías

| Capa | Tecnología |
| --- | --- |
| Interfaz (PWA instalable) | React 19 + TypeScript + Vite, `vite-plugin-pwa` (service worker + manifiesto) |
| Mapas | Leaflet + OpenStreetMap; direcciones con Nominatim (sin claves) |
| API (lógica de negocio) | Node.js + Express 5, validación con Zod, sesión propia con JWT |
| Cuentas (login) | **Supabase Auth**: guarda y verifica correos y contraseñas. Sin Supabase, cuentas locales con bcrypt |
| Datos | **PostgreSQL en Supabase** (esquema propio `parkspotter`). Sin conexión, **PGlite**: un Postgres embebido en `server/data/pglite` |
| Pruebas | `node:test` (API real contra PGlite + un Supabase Auth simulado) |

Arquitectura de tres capas, como en el documento: **app móvil → servidor/API → datos**.
En producción es **un solo servicio**: Express sirve la API y la app compilada.

### Cómo se reparten las responsabilidades

- **Supabase Auth** es quien sabe si el correo y la contraseña son correctos (y guarda la contraseña: la base de la
  app solo conserva un marcador). Al registrarse, el servidor crea la cuenta con la clave de servicio, ya confirmada
  (no depende de los correos del plan gratis). Al entrar, Supabase verifica la contraseña y **la app emite su propia
  sesión** (JWT de 7 días): así cada petición se valida sin llamar a Supabase.
- **PostgreSQL** guarda todo lo demás. Las reservas simultáneas del mismo cupo se serializan bloqueando la fila del
  garaje (`SELECT … FOR UPDATE`).
- Las tablas viven en el esquema `parkspotter`, con RLS activado y sin permisos para los roles de la API pública
  (`anon`, `authenticated`): aunque alguien tenga la clave pública del proyecto no puede leerlas.
- Las **cuentas de demostración** (`npm run db:seed`) son locales (su contraseña está en la base de la app) para no
  llenar Supabase Auth de usuarios de prueba.
- El proyecto de Supabase puede compartirse con otra app: si alguien ya tiene cuenta con ese correo en el proyecto,
  al registrarse en ParkSpotter con **la misma contraseña** se enlaza a esa cuenta; con otra contraseña se rechaza.

### Verificación del correo y recuperar la contraseña

Con un servidor de correo configurado (variables `SMTP_*` en `.env`, ver `.env.example`):

- Al registrarse se envía un **código de 6 dígitos** al correo. Hasta escribirlo no hay sesión; al completar los 6 dígitos
  la app confirma sola. Si alguien intenta ingresar sin haber confirmado, la app abre esa misma pantalla.
- **«¿Olvidaste tu contraseña?»** en el ingreso: se pide el correo, llega un código y se crea una contraseña nueva
  (también levanta el bloqueo por intentos fallidos).
- Los códigos vencen a los 15 minutos, se anulan tras 5 intentos fallidos y solo se puede pedir uno por minuto. En la
  base solo queda un hash (HMAC) del código. Las respuestas no revelan qué correos tienen cuenta.
- Si el correo no puede salir (clave mala, buzón inexistente), el registro se deshace para poder reintentar.
- **Sin `SMTP_HOST`** no se envía nada: las cuentas entran directo y «olvidé mi contraseña» no se muestra.

Con Gmail: activa la verificación en 2 pasos, crea una «contraseña de aplicación» en
<https://myaccount.google.com/apppasswords> y ponla en `SMTP_PASS` (con `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`,
`SMTP_USER=tucorreo@gmail.com`). Gmail permite unos 500 correos al día. También sirve Brevo, Mailgun u otro SMTP.

### Conectar Supabase

1. En el proyecto de Supabase: *Project Settings → API* → copia la **URL**, la clave **anon** y la clave **service_role**
   (esta es secreta: solo va en el servidor, nunca en el cliente ni en el chat).
2. *Connect → Session pooler* → copia la cadena de conexión (`postgresql://postgres.xxxx:…@aws-0-….pooler.supabase.com:5432/postgres`).
   Usa el **Session pooler** (o la conexión directa): el *Transaction pooler* no conserva el esquema de la sesión.
3. Pégalo en `.env` (ver `.env.example`): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`.
4. `npm run supabase:probar` comprueba cada pieza (URL, claves, conexión, esquema) sin imprimir ningún secreto y dice qué corregir.
   Si todo sale ✔, reinicia el servidor: crea las tablas solo. `npm run db:seed` agrega los datos de demostración (opcional).

Sin esas variables todo funciona igual en local (PGlite + cuentas locales), solo que los datos quedan en tu computador.

## Ejecutar en tu computador

Requisitos: Node.js 20 o superior.

```bash
npm install
npm run build        # compila la interfaz (client/web)
npm run db:seed      # opcional: datos de demostración
npm start            # http://localhost:3000
```

Para desarrollar con recarga en vivo: `npm run dev:server` y, en otra terminal, `npm run dev:client` (http://localhost:5173).

Cuentas de demostración (`npm run db:seed`), clave **Demo2026!**:

| Rol | Correo |
| --- | --- |
| Conductor | conductor@parkspotter.test |
| Propietaria | propietario@parkspotter.test |
| Propietario | camilo@parkspotter.test |
| Administrador | admin@parkspotter.test (clave `Admin2026!`, o la de `ADMIN_PASSWORD`) |

Pruebas: `npm test` (73 pruebas: cuentas, verificación por correo con SMTP simulado, Supabase Auth simulado, bloqueo de intentos, búsqueda, reservas simultáneas, permisos, calificaciones, moderación, fotos, chat, asistente, servicios, favoritos, estadísticas, calendario, días bloqueados, respuestas a opiniones, código de llegada y reportes). La primera vez que PGlite crea una base tarda unos segundos.

## Instalarla en el celular (por link)

Una PWA solo se puede instalar desde una dirección **HTTPS**, así que hay que publicarla (ver abajo).
Con el link:

- **Android (Chrome):** abre el link → botón «Instalar» en la app (Perfil o banner) o menú ⋮ → *Instalar app*.
- **iPhone (Safari):** abre el link → Compartir → *Agregar a la pantalla de inicio*.

Queda con su ícono, a pantalla completa y se actualiza sola.

## Publicarla en internet (gratis)

1. **Supabase:** conecta el proyecto como se explica arriba (*Conectar Supabase*).
2. **Código:** sube esta carpeta a un repositorio de GitHub.
3. **Servidor (Render):** *New → Blueprint* y elige el repositorio (usa `render.yaml`). Pega `DATABASE_URL`,
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_KEY`. `JWT_SECRET` se genera solo. Al primer arranque se
   crean las tablas.
4. **Datos de demostración (opcional)**, desde tu computador (con las mismas variables en `.env`):
   ```powershell
   $env:ADMIN_PASSWORD="una-clave-fuerte"; npm run db:seed
   ```
5. Render te da el link `https://parkspotter-xxxx.onrender.com`. En el plan gratuito el servicio se «duerme»
   tras unos minutos sin uso y la primera visita tarda ~30 s.

Sirve igual en cualquier sitio que corra Docker (hay un `Dockerfile`).

## Funciones de la app

- **Cuenta:** registro en dos pasos (correo y clave; luego nombre, fecha de nacimiento —mayores de 18—, celular, documento si ofrece garaje, vehículo opcional y aceptación de términos/habeas data), ingreso con bloqueo temporal tras 8 intentos fallidos, cambio de correo (pide la clave) y de contraseña.
- **Ubicar el garaje:** «Ubicar la dirección» normaliza abreviaturas (Cra., Cl., Av.), prueba varias combinaciones con el buscador de OpenStreetMap y dice qué tan precisa fue (exacta, solo la calle o solo la zona) para que el arrendador confirme o corrija el pin tocando el mapa. Las direcciones de Bogotá están poco mapeadas, así que casi siempre hay que afinar el pin a mano.
- **Primer garaje:** el panel del arrendador sin garajes muestra la guía de pasos (datos y ubicación, fotos, servicios/tarifa/horarios, cómo entrar) y el botón «Publicar mi garaje».
- **Perfil:** foto (cámara o galería; también se puede elegir al registrarse; se reduce en el celular y se re-codifica en el servidor, que además le quita datos como el GPS), datos personales y vehículo guardado que rellena la reserva.
- **Garajes:** hasta 6 fotos por garaje (la primera es la portada; se puede cambiar), galería deslizable en el detalle y foto en listas.
- **Chat por reserva:** conductor y propietario conversan dentro de la reserva (se actualiza solo cada 4 s, avisa en la campana y marca mensajes sin leer). Está abierto mientras la reserva esté pendiente o confirmada y hasta 24 h después de terminar; el administrador no lo lee.
- **Asistente:** escribe o dicta «moto en Chapinero mañana de 8 a 12 por menos de 5 mil» y busca garajes disponibles reales (recuerda la conversación: «y solo hasta 3 mil»), muestra tus reservas y responde preguntas frecuentes. Funciona **sin claves** con un intérprete en español. Para que lo haga un modelo de lenguaje, define `AI_BASE_URL`, `AI_API_KEY` y `AI_MODEL` (cualquier API compatible con *chat/completions*: OpenAI, DeepSeek, OpenRouter, Ollama…); si falla, vuelve solo al intérprete local. El modelo solo interpreta la frase; los garajes y precios siempre salen de la base.
- **Servicios del garaje:** cubierto, vigilancia, cámaras, portón eléctrico, techo alto, cargador eléctrico y acceso 24 h. El propietario los marca al publicar, se ven como chips y los conductores filtran con ellos (deben cumplirse todos los elegidos); el asistente también los entiende («garaje cubierto con vigilancia»).
- **Favoritos:** corazón en listas y detalle (cambio instantáneo), página «Favoritos» (los garajes pausados se conservan, marcados como no disponibles).
- **Estadísticas del propietario:** ingresos realizados y por recibir, horas reservadas, tasa de aceptación, gráfico de 8 semanas, ranking de garajes y estado de las solicitudes.
- **Calendario:** cada reserva activa se descarga como `.ics` (con alarma 1 h antes; las instrucciones de acceso solo van si está confirmada). También: compartir un garaje con el menú del celular, «Reservar de nuevo» y tema Automático / Claro / Oscuro.
- **Código de llegada:** cuando el propietario confirma, el conductor ve un código de 6 caracteres. Al llegar se lo muestra y el propietario lo digita en «Registrar llegada» (disponible desde 30 min antes de la entrada hasta la salida): así queda constancia de que llegó quien reservó y el conductor recibe el aviso. El propietario nunca ve el código; tras 5 intentos fallidos se bloquea el intento por 10 minutos.
- **Días sin servicio:** el propietario bloquea fechas (vacaciones, arreglos…) desde la edición del garaje. Ese día no aparece en la búsqueda, no se puede reservar y el detalle lo explica con el motivo. No se bloquea un día con reservas pendientes o confirmadas.
- **Opiniones con respuesta:** pestaña «Opiniones» del propietario (con contador de las que faltan por responder). La respuesta es pública, avisa a quien calificó y se puede corregir o quitar.
- **Reportes:** cualquier usuario reporta una publicación (información falsa, no existe, inseguro, cobro distinto u otro). El administrador los revisa en la pestaña «Reportes»: resolver sin sanción o suspender el garaje (cierra de una vez los reportes abiertos de esa publicación y avisa al dueño).
- **Solicitudes por vencer:** cada 5 minutos el servidor avisa al propietario de las solicitudes sin responder que empiezan en menos de 3 horas, y cancela las vencidas avisando al conductor.
- **Mensajes rápidos del chat:** «Voy en camino», «Ya llegué», «¿Me abren el portón?»… (y los equivalentes del propietario) con un toque.
- **Demostración:** `DEMO=1` muestra en el ingreso los botones «Conductor» y «Propietario». `npm run db:demo` agrega ilustraciones de garajes, avatares y datos personales a una base que ya tiene el seed.

> **Fotos:** con Supabase configurado van a **Supabase Storage** (bucket público `parkspotter`, se crea solo), así sobreviven a reinicios y no dependen de ningún computador. Sin Supabase se guardan en `server/data/uploads` (o `UPLOADS_DIR`).
> **Despliegue con link fijo y sin tu PC:** ver [DESPLIEGUE.md](DESPLIEGUE.md).

## Reglas de negocio implementadas

- **Estados de reserva:** pendiente → confirmada / rechazada / cancelada (y «finalizada» al terminar el horario).
- **Sin reservas superpuestas:** se cuenta la concurrencia real contra la capacidad del garaje, dentro de una
  transacción; probado con peticiones simultáneas. Una solicitud **pendiente también bloquea** el horario.
- Si el propietario no responde antes de la hora de entrada, la solicitud **se cancela sola**.
- Reservas en bloques de 30 minutos, dentro de los horarios que ofrece el garaje, hasta 60 días adelante.
- Un vehículo (placa) no puede tener dos reservas a la vez. Nadie puede reservar su propio garaje.
- Cancelar (conductor o propietario) solo antes del inicio; el pago simulado pasa a «reembolsado».
- **Privacidad:** las instrucciones de acceso y el teléfono de la contraparte solo se ven con la reserva **confirmada**.
- Calificaciones: solo del conductor, una por reserva, cuando la reserva confirmada ya terminó.
- Administrador: ve cifras, desactiva usuarios y suspende publicaciones.
- Horas y días en **hora de Bogotá (UTC-5)**; en la base se guardan en UTC.

## Cambios respecto al modelo de datos del documento (Figura 2)

El modelo sigue las 7 tablas del documento; estos ajustes salieron de implementarlo y conviene reflejarlos en el
documento final:

| Cambio | Motivo |
| --- | --- |
| `reserva.id_pago` eliminado (queda `pago.id_reserva`, único) | La relación circular reserva↔pago rompía la 3FN. |
| `reserva`: + `tipo_vehiculo`, `placa`, `motivo` | Validar compatibilidad del vehículo, evitar doble uso y mostrar el motivo de rechazo. |
| `garaje`: + `tipo_vehiculo`, `instrucciones_acceso` | El documento pide tipo de vehículo e instrucciones de ingreso (actividades 1 y 4). |
| `disponibilidad.dia_semana` numérico 1–7 (lunes–domingo) | Más simple de validar que un ENUM; las horas son de Bogotá. |
| `calificacion`: + `id_reserva` único | Garantiza que solo califica quien usó el garaje y una vez. |
| Nueva tabla `notificacion` | El flujo del documento notifica al propietario y al conductor. |
| `usuario.tipo_usuario`: un conductor puede volverse propietario | El documento pide modelar el rol sin duplicar al usuario. |
| `garaje.estado`: + `suspendido` | Moderación del administrador. |

Alcance real: los **pagos son simulados** y no hay chat ni notificaciones push; el documento los deja como
funciones opcionales fuera del alcance académico.

## Estructura

```
client/   interfaz React (PWA)
server/   API Express + esquema (server/sql/schema.sql) + pruebas (server/test)
hoja/     Archivo de la opción anterior (Hoja de Google + Apps Script); ya no se usa
Dockerfile · render.yaml · .env.example
```
