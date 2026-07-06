# ERD Designer (Collaborative)

Un diseñador de Diagramas de Entidad-Relación (ERD) en tiempo real, ligero, modular y enfocado en la usabilidad y colaboración. 

## 🚀 Características Principales

*   **Diseño Interactivo:** Lienzo con zoom infinito y *pan* para dibujar y mover tablas.
*   **Asistente de IA (Generación, Edición y Auto-Organizado):** Permite generar diagramas completos, añadir tablas o modificar las existentes usando prompts en lenguaje natural con soporte para Gemini, OpenAI, Ollama (local) y otros proveedores. Incluye auto-layout asistido por IA.
*   **Gestor de Consultas SQL con IA:** Biblioteca para crear y simular consultas SQL en motores PostgreSQL, MySQL, SQLite y SQL Server, además de explicarlas y generarlas usando Inteligencia Artificial.
*   **Documentación en Markdown con IA:** Genera documentación descriptiva detallada en formato Markdown (.md) del esquema de base de datos actual con un solo clic.
*   **Colaboración en Tiempo Real:** Varias personas pueden editar el mismo diagrama simultáneamente mediante WebSockets. El servidor envía una URL para compartir.
*   **Ingeniería Inversa (Importador SQL):** Pega un código DDL (`CREATE TABLE ...`) y el sistema generará el diagrama visual automáticamente, detectando relaciones (Foreign Keys) y restricciones.
*   **Exportador Multi-Dialecto:** Exporta tu modelo visual a código SQL limpio para PostgreSQL, MySQL o SQLite.
*   **Opciones Avanzadas de Columnas:** Soporte profundo para `Auto Increment` (A.I.), `Not Null` (N.N.), `Unique` (U.Q.) y valores por defecto (`Default`).
*   **Deshacer y Rehacer (Undo/Redo):** Historial de estado seguro para que nunca pierdas tu trabajo por un clic accidental.
*   **Exportación Visual:** Descarga tu diagrama como imagen (PNG/JPG).
*   **Proyectos Locales:** Guarda el diagrama como archivo `.json` y cárgalo después sin depender de una base de datos externa.
*   **Buscador Inteligente:** Encuentra tablas rápidamente por su nombre en diagramas masivos.

## 🛠 Arquitectura

El proyecto es **100% Vanilla JS** en el frontend (sin React, Vue o Angular) utilizando módulos ES6, y un backend ultraligero en **Node.js** puro (sin dependencias externas pesadas como Express o Socket.io).

*   `src/models/`: Estructuras de datos (Tablas, Campos).
*   `src/core/`: Gestión del estado (`StateManager.js`) y el historial (`HistoryManager.js`).
*   `src/services/`: Exportación, Importación, persistencia local y WebSockets.
*   `src/ui/`: Componentes gráficos y renderizado.
*   `src/controllers/`: Orquestación de toda la lógica.

## 💻 ¿Cómo arrancar el proyecto?

### Requisitos
Necesitas tener **Node.js** instalado en tu computadora (cualquier versión reciente de LTS funciona).

### Pasos

1.  **Abre una terminal** en la carpeta raíz del proyecto.
2.  **Inicia el servidor** ejecutando el siguiente comando:
    ```bash
    node server.js
    ```
3.  **Abre el proyecto en tu navegador:**
    *   Para uso local, ingresa a: `http://localhost:3000`
    *   Para uso **colaborativo** (que alguien en tu red local o VPN se conecte), mira la consola de tu terminal, te mostrará la dirección IP de red. Entra a `http://<TU-IP-LOCAL>:3000`.

### Notas sobre la Colaboración
*   El servidor utiliza el archivo `shared_state.json` para guardar en disco el estado colaborativo en tiempo real. 
*   Además, cuenta con un sistema de **Backups Automáticos** que guarda copias de seguridad del estado a lo largo de los días en la carpeta `/backups`.

## 👥 Sistema de Usuarios y Permisos (SQLite)

El diseñador incluye un sistema robusto de autenticación, control de accesos y permisos por proyecto respaldado por **SQLite** nativo (mediante `node:sqlite`).

### Roles de Colaboradores
*   **Creador (Propietario):** El usuario que crea un proyecto tiene permisos de administración total sobre el mismo. Puede invitar a otros colaboradores y asignarles roles.
*   **Editor:** Puede realizar modificaciones en tiempo real sobre el lienzo y guardar cambios.
*   **Lector:** Modo de solo lectura. El lienzo se sincroniza con los cambios del equipo, pero los botones de edición y la transmisión de cambios por WebSockets están deshabilitados.

### Gestión de Usuarios y Permisos
*   **Registro e Inicio de Sesión:** Los usuarios pueden registrarse por sí mismos directamente desde el portal de acceso.
*   **Panel de Administración (Solo Administradores):** Los administradores tienen acceso a un panel exclusivo en el Dashboard desde el cual pueden listar a todos los usuarios, crear nuevos, cambiar su nivel de privilegios (Usuario/Administrador) y eliminar cuentas.
*   **Administración de Colaboradores:** El creador del proyecto o un administrador puede hacer clic en el botón **Miembros** dentro del lienzo para invitar a otros usuarios usando el selector desplegable.

### Comandos de Administración CLI

Si necesitas realizar configuraciones manuales desde la consola del servidor:

*   **Restablecer privilegios y contraseña del usuario `admin`**:
    ```bash
    node scripts/reset-admin.js <nueva_contraseña>
    ```
*   **Crear un nuevo usuario manualmente**:
    ```bash
    node scripts/create-user.js <usuario> "<Nombre Visible>" [color_hex] [admin|true]
    ```
