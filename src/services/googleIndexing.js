const fs = require('fs');
const path = require('path');
const { Setting } = require('../models');

function carregarGoogleAuth() {
  try {
    return require('google-auth-library').GoogleAuth;
  } catch {
    return null;
  }
}

const SCOPES = ['https://www.googleapis.com/auth/indexing'];
const API_PUBLISH = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const API_METADATA = 'https://indexing.googleapis.com/v3/urlNotifications/metadata';
const QUOTA_DIARIA_PADRAO = 200;
const DELAY_MS = 600;

function obterCaminhoChave() {
  const env = (process.env.GOOGLE_INDEXING_KEY_FILE || '').trim();
  if (env) return path.resolve(env);
  const padrao = path.join(__dirname, '..', '..', 'config', 'google-indexing-key.json');
  return fs.existsSync(padrao) ? padrao : null;
}

function estaConfigurado() {
  if (!carregarGoogleAuth()) return false;
  const arquivo = obterCaminhoChave();
  return !!(arquivo && fs.existsSync(arquivo));
}

function obterEmailContaServico() {
  const arquivo = obterCaminhoChave();
  if (!arquivo) return null;
  try {
    const dados = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return dados.client_email || null;
  } catch {
    return null;
  }
}

async function obterClienteAuth() {
  const GoogleAuth = carregarGoogleAuth();
  if (!GoogleAuth) {
    throw new Error('Pacote google-auth-library não instalado. Rode: npm install');
  }
  const keyFile = obterCaminhoChave();
  if (!keyFile) {
    throw new Error('Arquivo JSON da conta de serviço não encontrado. Configure GOOGLE_INDEXING_KEY_FILE no .env.');
  }
  const auth = new GoogleAuth({ keyFile, scopes: SCOPES });
  return auth.getClient();
}

async function requisicaoApi(url, opcoes = {}) {
  const client = await obterClienteAuth();
  const res = await client.request({ url, ...opcoes });
  return res.data;
}

async function settingObter(chave) {
  const linha = await Setting.findOne({ where: { chave } });
  return linha?.valor ?? null;
}

async function obterQuotaHoje() {
  const hoje = new Date().toISOString().slice(0, 10);
  const dataSalva = await settingObter('google_indexing_enviados_data');
  const countSalvo = parseInt(await settingObter('google_indexing_enviados_count'), 10) || 0;
  if (dataSalva !== hoje) return { hoje, enviados: 0, restantes: QUOTA_DIARIA_PADRAO };
  return {
    hoje,
    enviados: countSalvo,
    restantes: Math.max(0, QUOTA_DIARIA_PADRAO - countSalvo)
  };
}

async function registrarEnvio(quantidade) {
  const hoje = new Date().toISOString().slice(0, 10);
  const quota = await obterQuotaHoje();
  const total = (quota.enviados || 0) + quantidade;
  await Setting.definir('google_indexing_enviados_data', hoje);
  await Setting.definir('google_indexing_enviados_count', String(total));
  return total;
}

async function enviarUrl(url, tipo = 'URL_UPDATED') {
  return requisicaoApi(API_PUBLISH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    data: { url, type: tipo }
  });
}

async function consultarUrl(url) {
  return requisicaoApi(`${API_METADATA}?url=${encodeURIComponent(url)}`);
}

function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enviarUrls(urls, opcoes = {}) {
  const lista = [...new Set(urls.filter(Boolean))];
  if (!lista.length) throw new Error('Nenhuma URL para enviar.');

  const quota = await obterQuotaHoje();
  const limite = Math.min(
    lista.length,
    opcoes.limite || lista.length,
    quota.restantes
  );

  if (limite <= 0) {
    throw new Error(`Cota diária esgotada (${QUOTA_DIARIA_PADRAO} URLs/dia). Tente amanhã.`);
  }

  const enviar = lista.slice(0, limite);
  const resultados = { ok: [], erros: [], ignorados: lista.length - limite };

  for (const url of enviar) {
    try {
      const resposta = await enviarUrl(url);
      resultados.ok.push({ url, resposta });
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.message;
      if (e.response?.status === 429) {
        resultados.erros.push({ url, erro: 'Cota excedida (429). Parando envios.' });
        break;
      }
      if (e.response?.status === 403) {
        throw new Error(
          'Acesso negado (403). Adicione a conta de serviço como PROPRIETÁRIO no Google Search Console: ' +
          (obterEmailContaServico() || 'e-mail da conta de serviço')
        );
      }
      resultados.erros.push({ url, erro: msg });
    }
    await aguardar(opcoes.delayMs ?? DELAY_MS);
  }

  if (resultados.ok.length) {
    await registrarEnvio(resultados.ok.length);
  }

  const quotaAtual = await obterQuotaHoje();
  return { ...resultados, quota: quotaAtual };
}

async function testarConexao() {
  if (!estaConfigurado()) {
    return {
      ok: false,
      erro: 'Arquivo JSON não encontrado. Coloque a chave em config/google-indexing-key.json ou defina GOOGLE_INDEXING_KEY_FILE no .env.'
    };
  }

  const email = obterEmailContaServico();
  try {
    const client = await obterClienteAuth();
    await client.getAccessToken();
    const quota = await obterQuotaHoje();
    return {
      ok: true,
      email,
      quota,
      mensagem: 'Conexão OK. Conta autenticada com sucesso.'
    };
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    if (e.response?.status === 403 || msg.includes('403')) {
      return {
        ok: false,
        email,
        erro: `Conta ${email} precisa ser PROPRIETÁRIA no Search Console de https://www.obuxixogospel.com.br/`
      };
    }
    if (msg.includes('API has not been used') || msg.includes('Indexing API')) {
      return {
        ok: false,
        email,
        erro: 'Ative a "Web Search Indexing API" no Google Cloud Console do projeto gen-lang-client-0972652469.'
      };
    }
    return { ok: false, email, erro: msg };
  }
}

async function notificarPost(config, slug, req = null) {
  if ((config.google_indexing_ativo || 'nao') !== 'sim') return null;
  if (!estaConfigurado()) return null;

  const { obterUrlBase } = require('../utils/requestUrl');
  const base = obterUrlBase(req, config);
  if (!base || !slug) return null;

  const quota = await obterQuotaHoje();
  if (quota.restantes <= 0) return null;

  const url = `${base}/post/${slug}`;
  try {
    await enviarUrl(url);
    await registrarEnvio(1);
    return url;
  } catch (e) {
    console.warn('Google Indexing API:', e.message);
    return null;
  }
}

module.exports = {
  estaConfigurado,
  obterEmailContaServico,
  obterQuotaHoje,
  enviarUrl,
  enviarUrls,
  testarConexao,
  notificarPost,
  QUOTA_DIARIA_PADRAO
};
