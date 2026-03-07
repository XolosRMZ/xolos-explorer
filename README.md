# Xolos Explorer

Explorador web para la infraestructura de **xolosArmy Network**, construido con **React + Vite**, orientado a visualizar información pública de la red eCash/Chronik con una experiencia clara, rápida y expandible.

## Visión

**Xolos Explorer** no busca ser solo un explorador técnico más.  
La meta es construir una interfaz pública que permita consultar y navegar datos de la red de forma sencilla, con una identidad propia alineada a la visión de **xolosArmy Network**.

Este proyecto servirá como base para:

- Exploración de bloques
- Exploración de transacciones
- Exploración de direcciones
- Búsqueda por hash o altura
- Integración con Chronik
- Visualización narrativa y cultural para proyectos futuros de registro público e identidad digital

---

## Stack

- **React**
- **Vite**
- **JavaScript**
- **CSS**
- **Chronik API** (objetivo de integración principal)

---

## Estado actual

Proyecto en fase inicial.

Actualmente este repositorio funciona como la base del frontend y evolucionará hacia un explorador completo con rutas navegables y conexión a la infraestructura soberana de xolosArmy Network.

Próximas etapas:

- [ ] Integrar `react-router-dom`
- [ ] Crear página principal del explorador
- [ ] Vista de bloque
- [ ] Vista de transacción
- [ ] Vista de dirección
- [ ] Barra de búsqueda global
- [ ] Manejo de errores y estados de carga
- [ ] Integración directa con Chronik
- [ ] Mejorar identidad visual xolosArmy Network

---

## Estructura del proyecto

```bash
xolos-explorer/
├── public/
├── src/
│   ├── assets/
│   ├── App.jsx
│   ├── App.css
│   ├── index.css
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.js
└── README.md
