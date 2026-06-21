// intentDetector.js — Detección de intención de compra en mensajes de MENU.
// Extraído de bot/index.js para tener un contrato estable (detectarIntento)
// que se pueda reemplazar más adelante por un clasificador entrenado sin
// tocar el pipeline del bot — hoy es 100% regex/listas, sin scoring real.
'use strict';

// Palabras que indican intención de molestar, no de comprar.
const TROLL_WORDS = new Set([
    'tonto','idiota','imbecil','estupido','robot','bot','chatgpt','ia','inteligencia',
    'hackear','hack','virus','spam','gratis','free','regalo','winner','ganador',
    'codigo','password','contrasena','admin','root','sql','javascript','python',
    'test','prueba','hola bot','eres un bot','eres ia','eres robot',
]);

// Verbos y frases de búsqueda en todos sus tiempos y personas gramaticales.
const INTENT_RE = new RegExp('^(?:^(?:quiero|queria|queriamos|quisiera|quisieramos|quisieras|querria|querriamos|quisiste|quise|kiero|keria|qiero|qisiera|qero|qeria|gustaria|gustara|me\s+gustaria|me\s+gustara|me\s+agradaria|me\s+late|me\s+pinta|tengo\s+ganas\s+de|traigo\s+ganas\s+de|le\s+traigo\s+ganas|ando\s+queriendo|busco|busca|buscas|buscaba|buscabas|buscamos|buscar|buscaria|ando\s+buscando|andabamos\s+buscando|vengo\s+buscando|vengo\s+a\s+ver|venia\s+por|venimos\s+por|vengo\s+por|vengo\s+a\s+preguntar\s+por|ando\s+viendo|ando\s+cotizando|vengo\s+a\s+cotizar|ando\s+sobre|ando\s+cazando|ando\s+correteando|le\s+ando\s+echando\s+el\s+ojo|tienes|tiene|tienen|tenias|tenas|tines|tnes|tendras|tendra|tendran|tendrian|por\s+ahi\s+tendras|vendes|vende|venden|venderias|venderas|vendera|venderan|vends|consigues|consigue|consigo|conseguimos|surten|surtes|surte|surtiras|sacan|sacas|saca|sacaras|manejas|maneja|manejan|manejaran|necesito|necesita|necesitas|necesitamos|necesitaba|necesitabamos|necesitaria|ando\s+necesitando|nesesito|nesecito|necito|ocupo|ocupa|ocupas|ocupamos|ocupaba|ocuparia|ando\s+ocupando|okupo|requiero|requiere|requieres|requerimos|requeriria|rekiere|urge|nos\s+urge|me\s+falta|nos\s+hace\s+falta|me\s+hace\s+falta|me\s+es\s+necesario|ando\s+corto\s+de|le\s+falta\s+a|hay|habia|habra|habria|no\s+hay|me\s+interesa|me\s+interesaria|me\s+interesa\s+comprar|me\s+quieres\s+vender|me\s+quisieras\s+vender|andamos\s+tras|ando\s+tras|venimos\s+por|donde\s+tienes|donde\s+dejas|donde\s+hay|donde\s+encuentro|donde\s+consigo|dónde\s+tienes|dónde\s+dejas|dónde\s+hay|dónde\s+encuentro|dónde\s+consigo|dame|me\s+das|me\s+mandas|me\s+traes)\s*)', 'i');

const STOP_PRODUCTO = new Set(['las','los','una','uno','unos','unas','para','por','con','sin','que','del','les','sus','hay','tiene','tienes','tendras','quiero','quieres','busco','busca','me','te','le','nos','ver','veo','esta','este','estos','estas','ese','eso','ahi','alla','aqui','donde','algo','algun','favor','porfavor','please','gracias']);
const STOP_VERIFICAR = new Set(['las','los','una','uno','unos','unas','para','por','con','sin','que','del','les','sus','me','te','le','nos','ver','esta','este','ese','eso','ahi','donde','algo','al','el','la']);

function _normTroll(texto) {
    return texto.toLowerCase().replace(/[áéíóúñ]/g, c => ({á:'a',é:'e',í:'i',ó:'o',ú:'u',ñ:'n'}[c]||c));
}

// Contrato: { esTroll, intencion: null|'busqueda_producto'|'busqueda_sin_producto', query, fraseDetectada }
// intencion=null y esTroll=false significa "no se detectó intención de compra".
function detectarIntento(texto) {
    const t = (texto || '').trim();
    if (!t) return { esTroll: false, intencion: null, query: null, fraseDetectada: null };

    if (_normTroll(t).split(/\s+/).some(w => TROLL_WORDS.has(w))) {
        return { esTroll: true, intencion: null, query: null, fraseDetectada: null };
    }

    const m = t.match(INTENT_RE);
    if (!m) return { esTroll: false, intencion: null, query: null, fraseDetectada: null };

    const queryExtraido = t.slice(m[0].length).trim();
    const palabrasVerificar = (queryExtraido || t).toLowerCase().split(/\s+/).filter(w => w.length > 1 && !STOP_VERIFICAR.has(w));
    if (palabrasVerificar.length === 0) {
        return { esTroll: false, intencion: 'busqueda_sin_producto', query: null, fraseDetectada: m[0].trim() };
    }

    return {
        esTroll: false,
        intencion: 'busqueda_producto',
        query: queryExtraido || t,
        fraseDetectada: m[0].trim(),
        palabrasProducto: queryExtraido.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !STOP_PRODUCTO.has(w)),
    };
}

module.exports = { detectarIntento, TROLL_WORDS, INTENT_RE };
