// Senha (scrypt), token de sessão (HMAC) e middlewares de acesso.
import crypto from 'node:crypto';
import { db } from './db.js';

const SEGREDO = process.env.MARCAZ_SEGREDO || 'marcaz-dev-segredo-troque-em-producao';
const DIAS_SESSAO = 7;

export function hashSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

export function verificaSenha(senha, guardado) {
  if (!guardado || !guardado.includes(':')) return false;
  const [sal, hash] = guardado.split(':');
  const calc = crypto.scryptSync(String(senha), sal, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(calc, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assina(payload) {
  return crypto.createHmac('sha256', SEGREDO).update(payload).digest('hex');
}

export async function criaToken(usuarioId) {
  // Formato 'AAAA-MM-DD HH:MM:SS' em UTC — compara corretamente em SQLite e Postgres
  const expira = new Date(Date.now() + DIAS_SESSAO * 864e5)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  const payload = Buffer.from(JSON.stringify({ uid: usuarioId, exp: expira })).toString('base64url');
  const token = `${payload}.${assina(payload)}`;
  await db.prepare('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?,?,?)').run(token, usuarioId, expira);
  return token;
}

export async function usuarioDoToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (assina(payload) !== sig) return null;
  let dados;
  try {
    dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (new Date(dados.exp) < new Date()) return null;
  const sessao = await db.prepare('SELECT * FROM sessoes WHERE token = ?').get(token);
  if (!sessao) return null;
  const u = await db.prepare('SELECT * FROM usuarios WHERE id = ? AND ativo = 1').get(dados.uid);
  if (!u) return null;
  return { ...u, permissoes: (u.permissoes || '').split(',').filter(Boolean) };
}

export async function encerraToken(token) {
  if (token) await db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
}

export async function limpaSessoesVencidas() {
  await db.prepare("DELETE FROM sessoes WHERE expira_em < datetime('now')").run();
}

// ---- middlewares -----------------------------------------------------------

// Bloqueia /:id com lixo ('undefined', 'abc') antes de chegar ao SQL:
// no PostgreSQL isso derruba a consulta inteira.
export function exigeIdNumerico(req, res, next) {
  const alvo = req.params.id;
  if (alvo === undefined) return next();
  if (!/^\d+$/.test(String(alvo))) {
    return res.status(400).json({ erro: 'Registro inválido.' });
  }
  req.params.id = Number(alvo);
  next();
}

export function leCookie(req, nome) {
  const raw = req.headers.cookie || '';
  for (const par of raw.split(';')) {
    const [k, ...v] = par.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function sessao(req, _res, next) {
  try {
    req.usuario = await usuarioDoToken(leCookie(req, 'marcaz_sessao'));
  } catch (e) {
    req.usuario = null;
  }
  next();
}

export function exigeLogin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
  next();
}

export function exigePapel(...papeis) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ erro: 'Faça login para continuar.' });
    if (!papeis.includes(req.usuario.papel)) {
      return res.status(403).json({ erro: 'Seu perfil não tem acesso a esta área.' });
    }
    next();
  };
}

// Dono tem todas as permissões; funcionário só as liberadas pelo dono.
export function exigePermissao(chave) {
  return (req, res, next) => {
    const u = req.usuario;
    if (!u) return res.status(401).json({ erro: 'Faça login para continuar.' });
    if (u.papel === 'dono' || u.papel === 'master') return next();
    if (u.papel === 'funcionario' && u.permissoes.includes(chave)) return next();
    return res.status(403).json({ erro: 'Sem permissão para esta função.' });
  };
}
