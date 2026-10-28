// Ponto de entrada da Vercel (Serverless Function).
// Reaproveita o mesmo Express do `npm start`, sem duplicar rotas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Diagnóstico: o que a Vercel realmente entregou dentro da função?
function inventario() {
  const dirs = [];
  const andar = (p, nivel = 0) => {
    if (nivel > 3) return;
    let itens;
    try {
      itens = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return;
    }
    dirs.push(
      '  '.repeat(nivel) +
        path.basename(p) +
        '/ → ' +
        itens.filter((i) => i.isFile()).map((i) => i.name).slice(0, 8).join(', ')
    );
    for (const i of itens.filter((x) => x.isDirectory()).slice(0, 6)) andar(path.join(p, i.name), nivel + 1);
  };
  andar(process.cwd(), 0);
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  return { cwd: process.cwd(), modulo: aqui, arvore: dirs.slice(0, 60) };
}

export default async function handler(req, res) {
  if (req.url === '/__inv') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(inventario(), null, 2));
  }
  try {
    const app = await iniciar();
    return app(req, res);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    return res.end('Falha ao iniciar o Marcaz: ' + e.message + '\n' + JSON.stringify(inventario()));
  }
}
