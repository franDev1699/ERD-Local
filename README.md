# ERD Designer (Collaborative)

Un diseñador de Diagramas de Entidad-Relación (ERD) en tiempo real, ligero, modular y enfocado en la usabilidad y colaboración. 

## 🚀 Características Principales

*   **Diseño Interactivo:** Lienzo con zoom infinito y *pan* para dibujar y mover tablas.
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
