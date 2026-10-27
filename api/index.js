// Ponto de entrada da Vercel (Serverless Function).
// Reaproveita o mesmo Express do `npm start`, sem duplicar rotas.
import { iniciar } from '../server/index.js';

export default async function handler(req, res) {
  const app = await iniciar();
  return app(req, res);
}
