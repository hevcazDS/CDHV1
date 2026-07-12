# Auditoría de seguridad: ¿un gerente puede crear/elevar usuarios a `prime`?

**Fecha:** 2026-07-12
**Alcance:** camino completo de creación/edición de usuarios y asignación de `rol`.
**Veredicto global:** el **backend (API) SÍ bloquea** los tres vectores. La brecha real
que ve el dueño es de **UI**: el panel *ofrece* la opción "Prime" a un gerente
(dropdown), aunque la API responde 403 al enviarla. Es fuga de superficie, no bypass —
pero conviene cerrarla igual (defensa en profundidad + no confundir al operador).

---

## Camino trazado (archivo:línea)

### 1. Endpoints de gestión de usuarios
`dashboard/routes/primeUsuariosPuntos.js` — RUTAS (líneas 181-189):

| Método | Ruta | Gate | Handler |
|---|---|---|---|
| POST   | `/api/prime/usuarios`      | `roles:['gerente']` | `usuariosPost` (L15) |
| PUT    | `/api/prime/usuarios/:id`  | `roles:['gerente']` | `usuariosPut` (L47) |
| DELETE | `/api/prime/usuarios/:id`  | `roles:['prime']`   | `usuariosDelete` (L97) |
| GET    | `/api/prime/usuarios` (lista) | `roles:['gerente']` | `primeCatalogo.js:402` |

Onboarding público que crea el primer prime: `dashboard/routes/negocioOnboarding.js:81-82`.

### 2. Semántica del gate `roles`
`dashboard/server.js:358-377` (`requireSession`): trata el array como **rango mínimo**
(`minRango = Math.min(...roles.map(rangoDe))`, `rangoDe(s.rol) >= minRango`).
Rangos en `dashboard/permisos.js:8-13`: `gerente=2`, `prime=3`.
Por tanto:
- `roles:['gerente']` deja pasar gerente **y** prime (rango ≥2). ✔ correcto para el alta.
- `roles:['prime']` exige rango ≥3 → un gerente (2 ≥ 3 = false) recibe **401**. ✔ prime-only real.

(Excepción auditor GET-only, L370, irrelevante aquí: solo lectura.)

### 3. Validación en el handler contra `rol='prime'`
La frontera NO la pone el gate de ruta (`gerente` puede entrar al POST/PUT), la pone
el handler contra `ROLES_CREABLES_POR_GERENTE` (`permisos.js:28`):
```js
ROLES_CREABLES_POR_GERENTE = ['cajero','operador','almacen','compras','rh','contabilidad']
// NO incluye 'prime', 'gerente' ni 'auditor'
```
- **POST** `primeUsuariosPuntos.js:21-23`:
  ```js
  if (ses.rol !== 'prime' && !ROLES_CREABLES_POR_GERENTE.includes(datos.rol))
      return json(res, {error:'Solo Prime puede crear usuarios administrador o prime'}, 403);
  ```
  gerente + `rol='prime'` → `true && !false` = **403**. ✔ bloqueado.
- **PUT** `primeUsuariosPuntos.js:65-67` valida el **rol NUEVO** (antiescalada):
  ```js
  if (ses.rol !== 'prime' && datos.rol && !ROLES_CREABLES_POR_GERENTE.includes(datos.rol))
      return json(res, {error:'Solo Prime puede asignar el rol "'+datos.rol+'"'}, 403);
  ```
  gerente subiendo a alguien (o a sí mismo) a `prime` → **403**. ✔ bloqueado.
- Además L50-55 valida el rol **actual** del objetivo (un gerente no puede tocar a un
  prime/gerente existente) y L70-72 protege al último prime al degradarlo.

El enum Zod (`bot/validators.js:257,267`) **sí admite** `'prime'` — a propósito: la
frontera es el handler, no el schema (comentario L261-264). Correcto mientras el
handler valide, y valida.

### 4. Onboarding (`negocioOnboarding.js`)
- POST público solo si `negocio_configurado != '1'`; ya configurado → **409** (L41).
- Crea al dueño como `prime` (L82) solo si el username no existe (L77-78).
- En Julio Cepeda la migración 0014 dejó `negocio_configurado='1'` (comentario L8-9),
  así que el alta ya está candada. ✔ No reabusable por un gerente (no puede resetear
  ese flag: no hay endpoint que ponga `negocio_configurado='0'`).

### 5. Modelo de permisos
`permisos.js` + `requireSession` coherentes (ver punto 2). No hay bug de rango.

---

## Veredicto por vector

| Vector | ¿Un gerente puede? | Evidencia (bloqueo) |
|---|---|---|
| **(a)** Crear usuario `rol='prime'` | **NO** | `primeUsuariosPuntos.js:21-23` → 403 |
| **(b)** Editar usuario existente a `prime` | **NO** | `primeUsuariosPuntos.js:65-67` → 403 |
| **(c)** Auto-promoverse a `prime` | **NO** | mismo guard `usuariosPut` L65-67 (valida `datos.rol` nuevo, sin excepción de "self") → 403 |

**La API está bien candada en los tres vectores.**

---

## La brecha real (UI) y por qué el dueño lo reporta

`dashboard-ui/src/pages/prime/UsuariosTab.jsx`:
- **L27 (en `Prime.jsx`)**: la tab "Usuarios" es `soloPrime: false` → **un gerente ve
  la tab completa**.
- **L11-21 `ROLES_OPCIONES`** incluye `{ value:'prime' }` (L20) y `{ value:'gerente' }`
  (L19) en el `<Select>` de alta (L113) sin filtrar por rol del usuario actual.
- **L138** el selector de cambio de rol inline también ofrece `gerente`/`prime`.

Resultado: un gerente **ve y puede elegir** "Prime", envía el POST/PUT, y recibe un 403
del backend. Percepción del dueño = "el panel deja crear prime". No hay escalada real,
pero la superficie miente.

---

## Fix mínimo y preciso

El backend ya bloquea; **el fix mínimo es cerrar la fuga de UI** para que gerente no vea
las opciones que no puede asignar. Defensa en profundidad opcional al final.

### Fix 1 (obligatorio, UI) — no ofrecer roles fuera del alcance del gerente
`dashboard-ui/src/pages/prime/UsuariosTab.jsx`, filtrar `ROLES_OPCIONES` por el rol de
sesión. Usar el `user.rol` del `AuthContext` (ya disponible en la app):

```jsx
// arriba del componente, tras obtener user del contexto:
const ROLES_ALTOS = ['gerente', 'prime', 'auditor'];  // solo prime los asigna
const opcionesRol = user.rol === 'prime'
  ? ROLES_OPCIONES
  : ROLES_OPCIONES.filter(o => !ROLES_ALTOS.includes(o.value));
```
- Usar `opcionesRol` en el `<Select>` de alta (L113, prop `data=`).
- Aplicar el mismo filtro en el selector inline de cambio de rol (L136-139).

(Espejo exacto de `ROLES_CREABLES_POR_GERENTE` de `permisos.js:28` — mantenerlos
idénticos como ya se hace con `dashboard-ui/src/lib/permisos.js`.)

### Fix 2 (recomendado, UI) — la tab Usuarios ya es visible a gerente por diseño
`Prime.jsx:27` deja `soloPrime:false` a propósito (un gerente gestiona cajeros/operadores).
**No cambiar** a `soloPrime:true` salvo que el negocio quiera que SOLO prime toque
usuarios. Si se decide eso: cambiar L27 a `soloPrime: true` y listo.

### Fix 3 (defensa en profundidad, backend — ya cubierto, NO urgente)
Los guards de `primeUsuariosPuntos.js:21` y `:65` ya rechazan `rol='prime'`. No requieren
cambio. La protección del último prime (L70-72 en PUT, L104-106 en DELETE) y contra
auto-borrado (L103) también están. **No tocar.**

**Cambio de código requerido para cerrar lo que ve el dueño: solo Fix 1 (un archivo,
front).** El backend no necesita cambios.
