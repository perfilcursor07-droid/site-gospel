const PAUSA_APOS_402_MS = 60 * 1000;

let avisoQuotaExibido = false;
let pausaAte = 0;

function marcarRespostaBrave(res, bodyText = '') {
  const texto = bodyText || '';
  if (res.status === 402 || texto.includes('Usage limit exceeded')) {
    pausaAte = Date.now() + PAUSA_APOS_402_MS;
    if (!avisoQuotaExibido) {
      avisoQuotaExibido = true;
      console.warn(
        'Brave Search: limite de uso atingido no painel da API. ' +
        'Se você aumentou o limite em brave.com/search/api, novas tentativas ocorrem automaticamente em ~1 min ' +
        'ou reinicie o servidor (npm run dev).'
      );
    }
    return true;
  }
  return false;
}

function marcarRespostaBraveOk() {
  pausaAte = 0;
  avisoQuotaExibido = false;
}

function braveDisponivel() {
  return !!process.env.BRAVE_SEARCH_API_KEY && Date.now() >= pausaAte;
}

function braveQuotaExcedida() {
  return Date.now() < pausaAte;
}

module.exports = {
  marcarRespostaBrave,
  marcarRespostaBraveOk,
  braveDisponivel,
  braveQuotaExcedida
};
