'use strict';
// Catálogo mínimo por giro para el modo DEMO. Cada giro define el nombre del
// negocio y ~12 productos (name, cat, price, costo) representativos, más el
// vocabulario ya vive en bot/flows/_giros.js. 'jugueteria' es especial: NO se
// siembra catálogo (conserva los datos reales de Julio Cepeda).
//
// Se usa desde scripts/demo/seed.js. Ampliar un giro = agregar filas aquí.

const P = (name, cat, price, costo) => ({ name, cat, price, costo });

const CATALOGOS = {
  restaurante: {
    negocio: 'Cocina Doña Mago', corto: 'Doña Mago',
    productos: [
      P('Tacos al pastor (orden)', 'Tacos', 89, 32), P('Quesadilla de flor', 'Antojitos', 65, 22),
      P('Torta ahogada', 'Tortas', 95, 38), P('Pozole rojo', 'Caldos', 120, 45),
      P('Enchiladas verdes', 'Platos fuertes', 135, 52), P('Agua de horchata 1L', 'Bebidas', 45, 12),
      P('Refresco 600ml', 'Bebidas', 30, 14), P('Flan napolitano', 'Postres', 55, 18),
      P('Chilaquiles con huevo', 'Desayunos', 110, 40), P('Café de olla', 'Bebidas', 35, 8),
      P('Sopa azteca', 'Caldos', 95, 34), P('Guacamole con totopos', 'Antojitos', 85, 30),
    ],
  },
  abarrotes: {
    negocio: 'Abarrotes La Esquina', corto: 'La Esquina',
    productos: [
      P('Coca-Cola 2L', 'Bebidas', 38, 30), P('Leche entera 1L', 'Lácteos', 28, 22),
      P('Huevo kilo', 'Básicos', 42, 34), P('Frijol bayo kilo', 'Granos', 38, 28),
      P('Arroz kilo', 'Granos', 32, 24), P('Aceite 1L', 'Básicos', 45, 36),
      P('Pan de caja grande', 'Panadería', 48, 35), P('Sabritas grande', 'Botanas', 25, 18),
      P('Jabón de baño', 'Higiene', 18, 11), P('Papel higiénico 4 rollos', 'Higiene', 40, 30),
      P('Detergente 1kg', 'Limpieza', 55, 42), P('Atún lata', 'Enlatados', 22, 16),
    ],
  },
  carniceria: {
    negocio: 'Carnicería El Buen Corte', corto: 'El Buen Corte',
    productos: [
      P('Bistec de res kilo', 'Res', 180, 130), P('Molida especial kilo', 'Res', 145, 100),
      P('Arrachera kilo', 'Res', 320, 240), P('Costilla de cerdo kilo', 'Cerdo', 130, 92),
      P('Chuleta ahumada kilo', 'Cerdo', 150, 110), P('Pechuga de pollo kilo', 'Pollo', 110, 78),
      P('Pierna y muslo kilo', 'Pollo', 85, 58), P('Chorizo kilo', 'Embutidos', 120, 80),
      P('Carne para asar kilo', 'Res', 210, 155), P('Milanesa de res kilo', 'Res', 195, 140),
      P('Alitas kilo', 'Pollo', 95, 62), P('Tocino 250g', 'Embutidos', 70, 48),
    ],
  },
  ferreteria: {
    negocio: 'Ferretería El Tornillo', corto: 'El Tornillo',
    productos: [
      P('Bulto de cemento 50kg', 'Construcción', 220, 185), P('Bote pintura vinílica 4L', 'Pinturas', 385, 300),
      P('Martillo carpintero', 'Herramienta', 180, 120), P('Caja tornillos 100pz', 'Fijación', 95, 60),
      P('Cinta métrica 5m', 'Herramienta', 85, 52), P('Foco LED 9W', 'Eléctrico', 45, 28),
      P('Metro de cable calibre 12', 'Eléctrico', 22, 14), P('Llave ajustable 10"', 'Herramienta', 150, 98),
      P('Silicón transparente', 'Adhesivos', 65, 40), P('Candado 40mm', 'Cerrajería', 110, 72),
      P('Brocha 3"', 'Pinturas', 55, 32), P('Taladro 1/2"', 'Herramienta eléctrica', 890, 640),
    ],
  },
  barberia: {
    negocio: 'Barbería Don Rafa', corto: 'Don Rafa',
    productos: [
      P('Corte de cabello', 'Servicios', 150, 0), P('Corte + barba', 'Servicios', 220, 0),
      P('Arreglo de barba', 'Servicios', 100, 0), P('Corte niño', 'Servicios', 120, 0),
      P('Delineado / perfilado', 'Servicios', 80, 0), P('Mascarilla facial', 'Servicios', 130, 0),
      P('Cera para peinar', 'Productos', 180, 95), P('Shampoo anticaspa', 'Productos', 160, 88),
      P('Aceite para barba', 'Productos', 220, 120), P('Tinte para barba', 'Servicios', 250, 60),
      P('Paquete premium', 'Servicios', 350, 0), P('Gel fijador', 'Productos', 95, 48),
    ],
  },
  estetica: {
    negocio: 'Estética Bella Vida', corto: 'Bella Vida',
    productos: [
      P('Corte de dama', 'Servicios', 250, 0), P('Tinte completo', 'Servicios', 650, 180),
      P('Rayitos / mechas', 'Servicios', 850, 250), P('Peinado de evento', 'Servicios', 450, 0),
      P('Manicure', 'Servicios', 180, 30), P('Pedicure', 'Servicios', 220, 40),
      P('Uñas acrílicas', 'Servicios', 400, 90), P('Depilación ceja', 'Servicios', 90, 0),
      P('Tratamiento capilar', 'Servicios', 380, 110), P('Maquillaje social', 'Servicios', 350, 40),
      P('Alaciado keratina', 'Servicios', 1200, 350), P('Shampoo profesional', 'Productos', 280, 150),
    ],
  },
  servicios: {
    negocio: 'Servicios Hidalgo', corto: 'Servicios Hidalgo',
    productos: [
      P('Diagnóstico a domicilio', 'Servicios', 250, 0), P('Instalación básica', 'Servicios', 550, 80),
      P('Mantenimiento preventivo', 'Servicios', 480, 60), P('Reparación menor', 'Servicios', 350, 40),
      P('Reparación mayor', 'Servicios', 950, 200), P('Revisión eléctrica', 'Servicios', 400, 0),
      P('Cambio de refacción', 'Servicios', 620, 250), P('Servicio urgente', 'Servicios', 780, 100),
      P('Cotización en sitio', 'Servicios', 150, 0), P('Póliza mensual', 'Planes', 1200, 300),
      P('Kit de refacciones', 'Productos', 480, 320), P('Garantía extendida', 'Planes', 350, 0),
    ],
  },
};

// Giros sin catálogo propio reutilizan uno cercano (retail/isp/mantenimiento/
// tatuajes/unas/custom) para que el demo siempre tenga productos que vender.
const ALIAS = { retail: 'abarrotes', isp: 'servicios', mantenimiento: 'servicios', tatuajes: 'estetica', unas: 'estetica', custom: 'abarrotes' };

function catalogoDe(giro) {
  if (giro === 'jugueteria') return null; // conserva datos reales
  return CATALOGOS[giro] || CATALOGOS[ALIAS[giro]] || CATALOGOS.abarrotes;
}

module.exports = { CATALOGOS, ALIAS, catalogoDe };
