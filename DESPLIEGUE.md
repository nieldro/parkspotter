# Poner ParkSpotter en internet con link fijo (sin tu PC)

Resultado: un link `https://parkspotter-xxxx.onrender.com` que **no cambia** y funciona con tu computador apagado.

| Pieza | Servicio gratis | Qué guarda |
| --- | --- | --- |
| Servidor + app | **Render** | La API y la app instalable |
| Datos y cuentas | **Supabase** (proyecto existente, esquema propio `parkspotter`) | Usuarios, garajes, reservas, chat |
| Fotos | **Supabase Storage** (bucket `parkspotter`, se crea solo) | Fotos de perfil y de garajes |
| Correo | **Gmail** (contraseña de aplicación) | Códigos de verificación y recuperación |

Todo el código ya está listo: solo falta crear las cuentas y pegar las claves.

## 1. Supabase (ya lo tienes)
En el proyecto → *Project Settings → API*: copia **URL**, clave **anon** y clave **service_role** (secreta).
En *Connect → Session pooler*: copia la cadena `postgresql://postgres.xxxx:CONTRASENA@aws-0-….pooler.supabase.com:5432/postgres`
(el **Session** pooler, no el Transaction). Si no recuerdas la contraseña de la base: *Project Settings → Database → Reset*.
Esto último afecta a las demás apps que usen ese proyecto (p. ej. Brío): revísalo antes.

## 2. Probar desde tu PC (recomendado antes de subir)
Pon esas claves en `ParkSpotter\.env` (formato en `.env.example`) y corre:

```
npm run supabase:probar     # valida URL, claves, conexión y esquema, sin imprimir secretos
npm start                   # arranca contra Supabase: crea las tablas solo
npm run db:seed             # (opcional) datos de demostración; sus fotos también van al Storage
```

## 3. Subir el código a GitHub
```
git init
git add .
git commit -m "ParkSpotter"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/parkspotter.git
git push -u origin main
```
`.env` y `server/data` están en `.gitignore`: tus claves **no se suben**. Usa un repositorio **privado**.

## 4. Render
1. <https://render.com> → entra con GitHub → **New → Blueprint** → elige el repositorio (lee `render.yaml`).
2. Pega las variables que pide: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `SMTP_USER`
   (tu Gmail) y `SMTP_PASS` (la contraseña de aplicación de 16 letras).
3. **Apply**. Tarda unos 5 min en construir. Al terminar tienes tu link fijo.
4. Abre el link desde el celular: aparece «Descargar e instalar».

## Cosas que debes saber
- **Se duerme:** en el plan gratis Render apaga el servicio tras ~15 min sin visitas; la primera visita tarda ~30 s. Para
  que no se duerma, crea un monitor gratis en <https://uptimerobot.com> que abra `https://TU-LINK/api/salud` cada 5 min.
- **Una sola instancia:** no subas el plan a más de una instancia sin revisar los límites de intentos (están en memoria).
- **Correo:** Gmail deja unos 500 envíos al día, de sobra para la práctica. Revoca la contraseña de aplicación en
  <https://myaccount.google.com/apppasswords> si alguna vez se filtra.
- **Link anterior (túnel):** `npm run demo:publico` ya no hace falta cuando el servicio está en Render.
- **Avisos automáticos:** el servidor revisa cada 5 min las solicitudes sin responder (avisa al propietario 3 h antes y
  cancela las vencidas avisando al conductor); no depende de que alguien abra la app.
- **Otros proveedores:** el `Dockerfile` sirve igual en Railway, Fly.io o cualquier sitio con Docker.
