// Debe reflejar exactamente los 8 swatches gratuitos de
// Mi-Vaquita-FE/src/components/group/ColorSwatchPicker.jsx
// (GROUP_COLORS). Cualquier otro color es una función Pro — se valida
// acá, no solo en el frontend, para que no baste con llamar a la API
// directo para saltarse el límite.
export const FREE_GROUP_COLORS = [
  '#ED1651', // magenta
  '#FAA918', // ámbar
  '#23B24A', // verde
  '#9FCB3B', // lima
  '#6D236A', // ciruela
  '#2E7DD1', // azul
  '#FF6F91', // coral
  '#7C4DFF', // violeta
];

export const isFreeGroupColor = (hex) => FREE_GROUP_COLORS.includes(String(hex || '').toUpperCase());
