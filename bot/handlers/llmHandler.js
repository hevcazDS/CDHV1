// llmHandler.js — HUECO de integración para un LLM (Claude).
// ═══════════════════════════════════════════════════════════════
// Hoy el bot es 100% basado en reglas (regex + menús numerados). Este módulo
// es el ÚNICO punto donde, más adelante, se enchufa un LLM — sin reescribir
// los flujos. Se llama desde bot/actionHandler.js JUSTO ANTES del fallback
// (cuando ningún flujo entendió el mensaje), así el LLM solo atiende el texto
// libre que las reglas no resuelven, dejando intacto todo lo que ya funciona.
//
// Estado actual: DESACTIVADO por defecto (configuracion.llm_activo, default
// off) y sin proveedor configurado → handle() devuelve null (passthrough):
// el bot se comporta exactamente como hoy. Cuando se active y haya credencial,
// aquí se hace la llamada al modelo.
//
// ── Cómo se completaría (referencia, NO ejecutar todavía) ──────────────────
//   1. npm i @anthropic-ai/sdk  (SDK oficial de Anthropic para Node).
//   2. ANTHROPIC_API_KEY en el .env (cada instancia su credencial).
//   3. Modelo por defecto: 'claude-opus-4-8' (el más capaz); 'claude-haiku-4-5'
//      para clasificación de intención barata/rápida.
//   4. El LLM NO responde texto libre directo: usa TOOL USE para llamar las
//      acciones que ya existen (buscar producto, agregar al carrito, crear
//      pedido, escalar a asesor). Cada herramienta mapea a un helper de
//      bot/flows/_shared.js. Así el LLM "conversa" pero ejecuta el mismo
//      flujo seguro y auditable de siempre.
//   Ejemplo de definición de tool (input_schema JSON):
//     { name: 'buscar_producto',
//       description: 'Busca productos en el catálogo por nombre/descripción.',
//       input_schema: { type:'object',
//         properties:{ query:{type:'string'} }, required:['query'] } }
//   El loop: messages.create({ model:'claude-opus-4-8', tools, messages }),
//   se ejecuta la tool pedida (stop_reason 'tool_use'), se devuelve el
//   tool_result, y se repite hasta stop_reason 'end_turn'. La respuesta final
//   se manda al cliente y la intención clasificada se guarda en
//   mensajes.intencion (ver migrations/0019) para enriquecer el dataset.
'use strict';

const log = require('../logger')('llmHandler');
const moduloActivo = (() => {
    try { return require('../flows/_config').moduloActivo; }
    catch (_) { return () => false; }
})();

// ¿Hay un proveedor de LLM configurado en este despliegue?
function _proveedorConfigurado() {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

function llmActivo() {
    // Doble compuerta: el flag de módulo Y una credencial real. Falla cerrado.
    return moduloActivo('llm_activo') && _proveedorConfigurado();
}

// handle(raw, ctx) — devuelve string (respuesta para el cliente) si el LLM
// manejó el mensaje, o null para que el bot siga con su fallback de reglas.
// Hoy SIEMPRE null (sin proveedor / desactivado): passthrough total.
async function handle(/* raw, ctx */) {
    if (!llmActivo()) return null;
    // ── Punto de integración futuro ──
    // const Anthropic = require('@anthropic-ai/sdk');
    // const client = new Anthropic();
    // const resp = await client.messages.create({ model: 'claude-opus-4-8',
    //     max_tokens: 1024, tools: TOOLS, messages: [...] });
    // ...ejecutar tools (stop_reason 'tool_use') hasta 'end_turn'...
    // return textoFinal;
    log.debug('llm_activo encendido pero la integración aún no está implementada; passthrough.');
    return null;
}

module.exports = { handle, llmActivo };
