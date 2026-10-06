// Paleta Sidonia y pares que deben cumplir contraste (WCAG 2.2 AA). Fuente única para tools/contrast.mjs
// y para la tabla de docs/03-sistema-de-diseno.md. Si cambias un color aquí, cámbialo también en
// kit/assets/sidonia-base.css (:root) y en kit/config/settings_schema.sidonia.json (valores por defecto).
export const PALETTE = {
  fondo: '#F5F3EE',
  superficie: '#FAF8F4',
  alterno: '#EAE6DE',
  texto: '#252723',
  secundario: '#62635C',
  borde: '#D7D2C8',
  control: '#8A857B',
  error: '#9B2C22',
  correcto: '#2F6A4C',
  coches: '#B63F38',
  barcos: '#28638E',
  casas: '#347455'
};

// [primer plano, fondo, mínimo, uso]
export const PAIRS = [
  ['texto', 'fondo', 4.5, 'Texto principal'],
  ['texto', 'superficie', 4.5, 'Texto sobre tarjetas y formularios'],
  ['texto', 'alterno', 4.5, 'Texto sobre bandas alternas'],
  ['secundario', 'fondo', 4.5, 'Texto secundario (metadatos, ayudas)'],
  ['secundario', 'superficie', 4.5, 'Texto secundario sobre superficie'],
  ['secundario', 'alterno', 4.5, 'Texto secundario sobre banda alterna'],
  ['superficie', 'texto', 4.5, 'Texto de botón principal (oscuro)'],
  ['error', 'fondo', 4.5, 'Mensajes de error'],
  ['error', 'superficie', 4.5, 'Mensajes de error en formularios'],
  ['correcto', 'superficie', 4.5, 'Confirmación de envío'],
  ['control', 'fondo', 3, 'Borde de campos y controles (componente de interfaz)'],
  ['control', 'superficie', 3, 'Borde de campos sobre superficie'],
  ['coches', 'fondo', 3, 'Punto rojo «Coches» (gráfico; el nombre lleva el significado)'],
  ['barcos', 'fondo', 3, 'Punto azul «Barcos»'],
  ['casas', 'fondo', 3, 'Punto verde «Casas»'],
  ['coches', 'alterno', 3, 'Punto rojo sobre banda alterna'],
  ['barcos', 'alterno', 3, 'Punto azul sobre banda alterna'],
  ['casas', 'alterno', 3, 'Punto verde sobre banda alterna'],
  ['borde', 'fondo', 1, 'Separadores DECORATIVOS (no transmiten información; los controles usan «control»)']
];
