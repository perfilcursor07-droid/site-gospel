/**
 * Datas/horas sempre em horário de Brasília (America/Sao_Paulo, UTC-3).
 * Campos datetime-local são interpretados como BRT, não como fuso do navegador/UTC.
 */
(function (global) {
  const FUSO_BR = 'America/Sao_Paulo';
  const OFFSET_BR = '-03:00';

  function partesBrasil(date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO_BR,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
  }

  function pegarParte(parts, tipo) {
    return parts.find((p) => p.type === tipo)?.value || '';
  }

  function paraDatetimeLocal(date) {
    const parts = partesBrasil(date);
    return (
      pegarParte(parts, 'year') + '-' +
      pegarParte(parts, 'month') + '-' +
      pegarParte(parts, 'day') + 'T' +
      pegarParte(parts, 'hour') + ':' +
      pegarParte(parts, 'minute')
    );
  }

  function datetimeLocalParaIso(val) {
    if (!val) return null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)) return val + ':00' + OFFSET_BR;
    return val;
  }

  function datetimeLocalParaDate(val) {
    const iso = datetimeLocalParaIso(val);
    return iso ? new Date(iso) : null;
  }

  function formatar(val) {
    if (!val) return '';
    let date;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)) {
      date = datetimeLocalParaDate(val);
    } else {
      date = new Date(val);
    }
    if (!date || Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('pt-BR', {
      timeZone: FUSO_BR,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function padraoArredondado5min(offsetHoras) {
    const instante = Date.now() + (offsetHoras || 0) * 60 * 60 * 1000;
    const cincoMin = 5 * 60 * 1000;
    const arredondado = new Date(Math.ceil(instante / cincoMin) * cincoMin);
    return paraDatetimeLocal(arredondado);
  }

  function preencherInput(input, offsetHoras) {
    if (!input || input.value) return;
    input.value = padraoArredondado5min(offsetHoras);
  }

  global.BrasilDatetime = {
    FUSO_BR,
    paraDatetimeLocal,
    datetimeLocalParaIso,
    datetimeLocalParaDate,
    formatar,
    padraoArredondado5min,
    preencherInput
  };
})(typeof window !== 'undefined' ? window : global);
