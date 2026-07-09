const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'buscar_imagem.py');

function sanitizarUnicode(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[\uD800-\uDFFF]/g, '');
}

function sanitizarPayload(obj) {
  if (typeof obj === 'string') return sanitizarUnicode(obj);
  if (Array.isArray(obj)) return obj.map(sanitizarPayload);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, sanitizarPayload(v)])
    );
  }
  return obj;
}

function comandoPython() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * Fallback em Python: extrai imagem da fonte, Brave e DuckDuckGo.
 * @returns {Promise<{imagem: string, alt: string}|null>}
 */
async function buscarImagemPython(payload) {
  return new Promise((resolve) => {
    const py = comandoPython();
    const proc = spawn(py, [SCRIPT], {
      cwd: ROOT,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      console.warn('Python buscar_imagem indisponível:', err.message);
      resolve(null);
    });

    proc.on('close', (code) => {
      if (stderr.trim()) {
        console.warn('buscar_imagem.py:', stderr.trim().slice(0, 300));
      }
      try {
        const data = JSON.parse(stdout.trim() || '{}');
        if (data.ok && data.imagem) {
          resolve({ imagem: data.imagem, alt: data.alt || null });
        } else {
          if (data.erro) console.warn('Python imagem:', data.erro);
          resolve(null);
        }
      } catch (e) {
        console.warn('Python imagem JSON inválido:', e.message);
        resolve(null);
      }
    });

    proc.stdin.write(JSON.stringify(sanitizarPayload(payload)), 'utf8');
    proc.stdin.end();

    setTimeout(() => {
      try { proc.kill(); } catch { /* ignore */ }
    }, 120000);
  });
}

module.exports = { buscarImagemPython, comandoPython };
