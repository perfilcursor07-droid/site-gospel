const perguntasBase = [
  { pergunta: 'Quanto é {a} + {b}?', calc: (a, b) => a + b },
  { pergunta: 'Quanto é {a} − {b}?', calc: (a, b) => a - b },
  { pergunta: 'Quanto é {a} × {b}?', calc: (a, b) => a * b }
];

function numeroAleatorio(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function gerarCaptcha() {
  const tipo = perguntasBase[numeroAleatorio(0, perguntasBase.length - 1)];
  let a = numeroAleatorio(2, 12);
  let b = numeroAleatorio(1, 9);

  if (tipo.calc === perguntasBase[1].calc) {
    if (b > a) [a, b] = [b, a];
  }

  if (tipo.calc === perguntasBase[2].calc) {
    a = numeroAleatorio(2, 9);
    b = numeroAleatorio(2, 9);
  }

  const resposta = tipo.calc(a, b);
  const pergunta = tipo.pergunta.replace('{a}', String(a)).replace('{b}', String(b));

  return { pergunta, resposta: String(resposta) };
}

function validarCaptcha(sessao, postId, respostaInformada) {
  if (!sessao || !postId || respostaInformada === undefined || respostaInformada === null) return false;
  const informada = String(respostaInformada).trim();
  if (!informada || !/^\d+$/.test(informada)) return false;
  return String(sessao.postId) === String(postId) && String(sessao.resposta) === informada;
}

module.exports = { gerarCaptcha, validarCaptcha };
