const { chatCompletion, parsearJson } = require('./deepseek');

const SECOES = {
  identidade: ['site_nome', 'site_slogan', 'site_descricao', 'cor_primaria'],
  seo: ['seo_titulo', 'seo_descricao', 'seo_palavras_chave'],
  rodape: ['footer_copyright', 'footer_links']
};

function normalizarSugestoes(raw) {
  const dados = typeof raw === 'string' ? parsearJson(raw) : raw;
  const identidade = dados.identidade || {};
  const seo = dados.seo || {};
  const rodape = dados.rodape || {};

  return {
    identidade: {
      site_nome: String(identidade.site_nome || '').trim().slice(0, 80),
      site_slogan: String(identidade.site_slogan || '').trim().slice(0, 120),
      site_descricao: String(identidade.site_descricao || '').trim().slice(0, 300),
      cor_primaria: /^#[0-9a-fA-F]{6}$/.test(identidade.cor_primaria || '')
        ? identidade.cor_primaria
        : '#ea580c'
    },
    seo: {
      seo_titulo: String(seo.seo_titulo || '').trim().slice(0, 60),
      seo_descricao: String(seo.seo_descricao || '').trim().slice(0, 160),
      seo_palavras_chave: String(seo.seo_palavras_chave || '').trim().slice(0, 200)
    },
    rodape: {
      footer_copyright: String(rodape.footer_copyright || '').trim().slice(0, 160),
      footer_links: String(rodape.footer_links || '').trim().slice(0, 1000)
    }
  };
}

function filtrarPorSecao(sugestoes, secao) {
  if (!secao || secao === 'todas') return sugestoes;
  const campos = SECOES[secao];
  if (!campos) return sugestoes;

  const resultado = { identidade: {}, seo: {}, rodape: {} };
  if (secao === 'identidade') resultado.identidade = sugestoes.identidade;
  if (secao === 'seo') resultado.seo = sugestoes.seo;
  if (secao === 'rodape') resultado.rodape = sugestoes.rodape;
  return resultado;
}

async function sugerirConfiguracaoSite({ descricao, secao = 'todas', configAtual = {} }) {
  const texto = (descricao || '').trim();
  if (texto.length < 10) {
    throw new Error('Descreva o site com pelo menos 10 caracteres.');
  }

  const ano = new Date().getFullYear();
  const contextoAtual = [
    configAtual.site_nome ? `Nome atual: ${configAtual.site_nome}` : null,
    configAtual.site_slogan ? `Slogan atual: ${configAtual.site_slogan}` : null
  ].filter(Boolean).join('\n');

  const focoSecao = secao === 'todas'
    ? 'identidade, SEO e rodapé'
    : `apenas a seção "${secao}"`;

  const prompt = `Você é especialista em branding e SEO para portais de notícias gospel brasileiros.

O administrador descreveu o site assim:
"""
${texto}
"""

${contextoAtual ? `Contexto já cadastrado:\n${contextoAtual}\n` : ''}

Gere sugestões profissionais em português do Brasil para preencher ${focoSecao} do painel administrativo.

REGRAS:
- Tom jornalístico gospel, moderno e confiável
- seo_titulo: máximo 60 caracteres, atrativo para Google
- seo_descricao: máximo 160 caracteres, com chamada clara
- seo_palavras_chave: 5 a 10 termos separados por vírgula
- cor_primaria: cor hex adequada ao nicho gospel (ex: laranja #ea580c, azul #1d4ed8, roxo #7c3aed)
- footer_links: 3 a 5 linhas no formato Texto|/caminho (use /pagina/sobre, /busca e caminhos plausíveis)
- footer_copyright: inclua © ${ano} e nome do site
- Não invente URLs externas nos links do rodapé
- Se o site mencionar polêmicas/notícias, reflita isso no slogan e SEO sem sensacionalismo excessivo

Retorne SOMENTE JSON válido neste formato:
{
  "identidade": {
    "site_nome": "",
    "site_slogan": "",
    "site_descricao": "",
    "cor_primaria": "#ea580c"
  },
  "seo": {
    "seo_titulo": "",
    "seo_descricao": "",
    "seo_palavras_chave": ""
  },
  "rodape": {
    "footer_copyright": "",
    "footer_links": "Sobre|/pagina/sobre\\nBusca|/busca"
  }
}`;

  const resposta = await chatCompletion(
    [
      {
        role: 'system',
        content: 'Você cria textos de configuração para sites gospel. Retorne somente JSON válido, sem markdown.'
      },
      { role: 'user', content: prompt }
    ],
    { json: true, temperature: 0.75, maxTokens: 1200 }
  );

  const sugestoes = normalizarSugestoes(resposta);
  return filtrarPorSecao(sugestoes, secao);
}

module.exports = {
  sugerirConfiguracaoSite,
  normalizarSugestoes
};
