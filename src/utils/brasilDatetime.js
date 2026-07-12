const FUSO_BR = 'America/Sao_Paulo';
const OFFSET_BR = '-03:00';

function parseInicioFimBrasil(val) {
  if (!val) return null;
  const texto = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(texto)) {
    return new Date(`${texto}:00${OFFSET_BR}`);
  }
  const d = new Date(texto);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatarDataHoraBrasil(val) {
  const d = typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)
    ? parseInicioFimBrasil(val)
    : new Date(val);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    timeZone: FUSO_BR,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

module.exports = {
  FUSO_BR,
  OFFSET_BR,
  parseInicioFimBrasil,
  formatarDataHoraBrasil
};
