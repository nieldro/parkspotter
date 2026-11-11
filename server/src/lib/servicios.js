// Servicios que un garaje puede ofrecer. En la base se guardan como lista separada por comas.
export const SERVICIOS = ['cubierto', 'vigilancia', 'camaras', 'porton_electrico', 'techo_alto', 'cargador_ev', 'abierto_24h'];

export const aLista = (texto) => (texto ? texto.split(',').filter((s) => SERVICIOS.includes(s)) : []);
export const aTexto = (lista) => (lista?.length ? [...new Set(lista)].filter((s) => SERVICIOS.includes(s)).join(',') : null);
