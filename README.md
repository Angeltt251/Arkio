# Arkio

Plataforma web de gestión ágil **Scrumban** (Scrum + Kanban) con una **bitácora histórica** que demuestra qué hizo cada integrante, cuándo lo hizo y cómo avanzó el proyecto.

> Basado en `Especificacion_Proyecto_Arqio_v1.pdf`. Nombre de trabajo: **Arkio** (pendiente revisar disponibilidad en INAPI y dominios).

## Stack

| Capa | Tecnología | Hosting |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite | Cloudflare Pages |
| Backend | Python + FastAPI + WebSockets | Render |
| Base de datos y Auth | PostgreSQL + Supabase Auth | Supabase |
| Correo (invitaciones) | SMTP (local/Mailpit) o API Resend | — |
| Desarrollo local | Docker Compose | — |

```
Navegador ──► Frontend (Cloudflare Pages)
                 │  login con Supabase Auth → access_token
                 ▼
             API FastAPI (Render) ──► PostgreSQL (Supabase)
                 ▲                        │ trigger log_activity → NOTIFY
                 └──── WebSocket /ws ◄────┘ (actualizaciones en vivo)
```

## Estructura

```
Arkio/
├── frontend/                 React + TS + Vite
│   ├── public/_redirects     rutas SPA en Cloudflare Pages
│   └── src/
│       ├── components/
│       │   ├── layout/       Sidebar, Topbar, AppLayout
│       │   ├── dashboard/    StatCard, ProjectCard, CurrentSprintCard, ActivityFeed, BurndownChart
│       │   └── ui/           Icon, Logo, Avatar
│       ├── config/           navegación (módulos e iteración en que se construyen)
│       ├── context/          AuthContext (Supabase / modo demo), ThemeContext (claro/oscuro)
│       ├── hooks/            useDashboard (API + WebSocket)
│       ├── lib/              supabase, api, realtime, format
│       ├── pages/            Dashboard, auth/(Login, Registro, Recuperar), Invitación, módulos
│       └── styles/global.css
├── backend/                  FastAPI
│   ├── app/
│   │   ├── api/routes/       me+dashboard, workspaces (proyectos, miembros, invitaciones),
│   │   │                     invitations (aceptar/rechazar), projects (bitácora), realtime (/ws)
│   │   ├── core/             config (variables de entorno), security (validación JWT Supabase)
│   │   ├── db/               session (registra el actor en cada transacción), models
│   │   ├── schemas/          modelos Pydantic (JSON en camelCase)
│   │   └── services/         dashboard, permissions, email (SMTP/Resend), realtime (hub + LISTEN)
│   └── tests/
├── supabase/migrations/      esquema completo + RLS + bitácora inmutable
├── docker-compose.yml        backend + frontend + Mailpit
└── render.yaml               blueprint del backend en Render
```

## Qué está listo (Iteración 0 + base de la 1)

- **Login, registro y recuperación de contraseña** con Supabase Auth. Sin variables de Supabase la app corre en **modo demo** (entra con cualquier correo).
- **Dashboard** según el diseño: tarjetas de resumen con tendencia, Mis Proyectos, Sprint actual con Sprint Goal y avance, Actividad reciente y Burndown (ideal vs real). Tema claro/oscuro, responsive y atajo `Ctrl + K`.
- **Base de datos completa del PDF** (sección 9): espacios, miembros, proyectos, invitaciones, backlog/PBIs, sprints, tablero/columnas/tareas, etiquetas, checklist, eventos Scrum, retrospectivas, comentarios, adjuntos, notificaciones.
- **Bitácora automática e inmutable**: cada cambio queda registrado por trigger con actor, fecha, entidad y valores antes/después. Nadie puede editarla ni borrarla (ni un admin); los Sprints no se borran, se cierran con motivo.
- **Seguridad**: RLS por espacio/proyecto, rol observador (profesor) de solo lectura, permisos validados también en FastAPI.
- **API**: perfil, dashboard, espacios, proyectos (con tablero por defecto: Por hacer → En progreso → En revisión → Testing → Terminado), miembros, invitaciones por correo con token y vencimiento, consulta de bitácora con filtros.
- **WebSocket** `/ws`: los cambios en la base de datos llegan en vivo al dashboard.
- **Product Backlog**: Product Goal, PBIs con código (SAL-12), historias "Como / quiero / para", criterios de aceptación, prioridad, estimación en puntos y estado. Refinamiento: reordenar arrastrando, dividir un PBI en partes, archivar y restaurar.
- **Sprint Planning**: duración de 1 a 4 semanas (o fechas libres, máx. un mes), selección de PBIs con avisos de capacidad (velocidad de los últimos Sprints), PBIs sin estimar/refinar y dependencias; Sprint Goal, plan y participantes. Al confirmar crea el Sprint numerado, una tarjeta por PBI en el tablero y el acta de la Planning. Iniciar, cerrar o cancelar con motivo (los PBIs sin terminar vuelven al backlog).
- **Eventos Scrum**: actas de Planning, Daily (15 min), Review y Retrospective con asistentes, acuerdos y acciones de mejora con responsable, fecha y estado.
- **Tablero**: además de columnas y WIP, las tarjetas tienen etiquetas (con texto, no solo color), checklist con progreso y PBI/Sprint asociado.

Las demás secciones del menú muestran una página que indica en qué iteración se construyen.

## Puesta en marcha

### 1. Supabase
1. Crea un proyecto en [supabase.com](https://supabase.com).
2. **SQL Editor** → pega y ejecuta `supabase/migrations/20261113000000_esquema_inicial.sql`.
3. **Project Settings → API**: copia la *Project URL* y la *anon/publishable key* (frontend).
4. **Project Settings → Database → Connect**: copia la cadena del **Session pooler** (backend).

### 2. Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env        # completa DATABASE_URL y SUPABASE_URL
uvicorn app.main:app --reload
```
Documentación interactiva: http://localhost:8000/docs · Pruebas: `pytest`

### 3. Frontend
```bash
cd frontend
npm install
cp .env.example .env.local  # completa VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL
npm run dev
```
Abre http://localhost:5173. Si dejas el `.env.local` vacío, verás el modo demo.

### Con Docker
Con `backend/.env` y `frontend/.env.local` creados:
```bash
docker compose up --build
```
Frontend :5173 · API :8000 · correos de invitación en Mailpit: http://localhost:8025

## Despliegue

**Backend en Render**: New → Blueprint → este repo (usa `render.yaml`) y completa las variables.
⚠️ El plan gratis de Render **bloquea los puertos SMTP 25, 465 y 587**. Para enviar invitaciones ahí usa `EMAIL_PROVIDER=resend` (API HTTPS, tiene plan gratis) o un plan pagado con SMTP.

**Frontend en Cloudflare Pages**: conecta el repo con
- Directorio raíz: `frontend` · Comando: `npm run build` · Salida: `dist`
- Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` (URL de Render)

Luego agrega la URL de Pages a `CORS_ORIGINS` y `FRONTEND_URL` en Render, y en Supabase → Authentication → URL Configuration.

> Nunca pongas la `service_role` key ni contraseñas en variables `VITE_` (llegan al navegador).

## Próximas iteraciones (plan del PDF)

| # | Iteración | Resultado demostrable |
|---|---|---|
| 1 | Acceso y espacios | Pantallas de espacios, proyectos, miembros e invitaciones (API lista) |
| 2 | Backlog | Product Goal, PBIs, historias y criterios de aceptación |
| 3 | Sprint Planning | Crear Sprint, seleccionar PBIs, definir Sprint Goal |
| 4 | Tablero | Kanban con arrastrar y soltar, WIP, responsables, etiquetas y checklist |
| 5 | Trazabilidad | Página de bitácora con filtros, comentarios y eventos Scrum |
| 6 | Cierre e informes | Retrospectiva, métricas y exportación PDF/CSV |
