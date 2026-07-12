// Teste rápido dos detectores de padrões de IA (rode: node scripts/teste-humanizacao.js)
const { detectarCitacoesInventadas } = require('../src/services/deepseek.js');
const { detectarH2Genericos, FRASES_PROIBIDAS_IA } = require('../src/services/editorialGuidelines.js');

const conteudo = `<p>O questionamento, que viralizou nas redes sociais neste domingo (12), reacendeu o debate entre evangélicos.</p>
<p>\u201cA música não é neutra. Ela molda pensamentos e sentimentos\u201d, diz o pastor Marcos Freitas, da Igreja Batista da Lagoinha.</p>
<p>\u201cNão é o ritmo que afasta de Deus, mas a mensagem\u201d, pondera a cantora gospel Priscila Alcântara.</p>
<h2>O debate teológico</h2>
<p>\u201cOuço tanto Gabriela Rocha quanto Ed Sheeran\u201d, conta a universitária Larissa Mendes, de 22 anos.</p>
<h2>Repercussão nas igrejas</h2>
<p>A discussão deve continuar nas próximas semanas.</p>`;

const contexto = 'Reflexão publicada pelo portal A12 sobre música secular e fé cristã viralizou nas redes.';

const textoPlano = conteudo.replace(/<[^>]+>/g, ' ').toLowerCase();
const muletas = FRASES_PROIBIDAS_IA.filter((f) => textoPlano.includes(f));

console.log('Citações inventadas detectadas:', detectarCitacoesInventadas(conteudo, contexto));
console.log('H2 genéricos detectados:', detectarH2Genericos(conteudo));
console.log('Muletas detectadas:', muletas);
