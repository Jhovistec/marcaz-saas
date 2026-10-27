// Dados de demonstração (idempotente): 3 empresas com catálogo, equipe e agenda.
import { db, conectar } from './db.js';
import { hashSenha } from './auth.js';
import { hojeISO } from './lib/agenda.js';

const dias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const EMPRESAS = [
  {
    slug: 'barbearia-noel',
    nome: 'Barbearia Noel',
    razao_social: 'Noel Barbearia LTDA',
    cnpj: '12.345.678/0001-90',
    segmento: 'barbearia',
    telefone: '(38) 99999-1111',
    endereco: 'Rua das Tesouras, 120 — Centro, Montes Claros/MG',
    instagram: 'https://instagram.com/barbearianoel',
    whatsapp: '5538999991111',
    tema: 'gold',
    aberto_hora: '09:00',
    fecha_hora: '20:00',
    dias_semana: '1,2,3,4,5,6',
    dono: { nome: 'Noel Ferreira', telefone: '38999991111', email: 'noel@barbearianoel.com', senha: 'dono123' },
    equipe: [
      { nome: 'Sena', cargo: 'Master Barber', telefone: '38999992222', senha: 'sena123', permissoes: ['agenda'] },
      { nome: 'Ana', cargo: 'Styling', telefone: '38999993333', senha: 'ana123', permissoes: ['agenda'] },
    ],
    servicos: [
      { nome: 'Corte masculino', duracao_min: 30, preco_cent: 4000 },
      { nome: 'Barba completa', duracao_min: 30, preco_cent: 3500 },
      { nome: 'Corte + Barba', duracao_min: 60, preco_cent: 6500 },
      { nome: 'Pigmentação', duracao_min: 45, preco_cent: 5500 },
    ],
    cliente: { nome: 'Jonathan Sena', telefone: '38999994444', cpf: '12345678900', senha: 'cliente123' },
  },
  {
    slug: 'salao-divas',
    nome: 'Salão Divas',
    razao_social: 'Divas Beleza LTDA',
    cnpj: '98.765.432/0001-10',
    segmento: 'salao',
    telefone: '(38) 99888-2222',
    endereco: 'Av. da Beleza, 45 — Jardim América, Montes Claros/MG',
    instagram: 'https://instagram.com/salaodivas',
    whatsapp: '5538998882222',
    tema: 'rose',
    aberto_hora: '08:00',
    fecha_hora: '19:00',
    dias_semana: '1,2,3,4,5,6',
    dono: { nome: 'Divina Souza', telefone: '38998882222', email: 'divina@salaodivas.com', senha: 'dono123' },
    equipe: [{ nome: 'Carla', cargo: 'Cabeleireira', telefone: '38998883333', senha: 'carla123', permissoes: ['agenda'] }],
    servicos: [
      { nome: 'Escova', duracao_min: 45, preco_cent: 6000 },
      { nome: 'Coloração', duracao_min: 120, preco_cent: 18000 },
      { nome: 'Mechas', duracao_min: 150, preco_cent: 25000 },
      { nome: 'Corte feminino', duracao_min: 45, preco_cent: 7000 },
    ],
    cliente: { nome: 'Maria Clara', telefone: '38998884444', cpf: '98765432100', senha: 'cliente123' },
  },
  {
    slug: 'studio-plena',
    nome: 'Studio Plena',
    razao_social: 'Plena Estética LTDA',
    cnpj: '11.222.333/0001-44',
    segmento: 'estetica',
    telefone: '(38) 99777-3333',
    endereco: 'Rua do Bem-Estar, 300 — Ibituruna, Montes Claros/MG',
    instagram: 'https://instagram.com/studioplena',
    whatsapp: '5538997773333',
    tema: 'emerald',
    aberto_hora: '08:00',
    fecha_hora: '18:00',
    dias_semana: '1,2,3,4,5',
    dono: { nome: 'Plena Almeida', telefone: '38997773333', email: 'plena@studioplena.com', senha: 'dono123' },
    equipe: [{ nome: 'Bia', cargo: 'Esteticista', telefone: '38997774444', senha: 'bia123', permissoes: ['agenda'] }],
    servicos: [
      { nome: 'Limpeza de pele', duracao_min: 60, preco_cent: 12000 },
      { nome: 'Depilação completa', duracao_min: 60, preco_cent: 9000 },
      { nome: 'Massagem relaxante', duracao_min: 60, preco_cent: 14000 },
      { nome: 'Drenagem linfática', duracao_min: 60, preco_cent: 13000 },
    ],
    cliente: { nome: 'Ana Beatriz', telefone: '38997775555', cpf: '11122233344', senha: 'cliente123' },
  },
];

export async function seed({ silencioso = false } = {}) {
  const jaTem = (await db.prepare('SELECT COUNT(*) AS n FROM empresas').get()).n;
  if (jaTem > 0) {
    if (!silencioso) console.log('Banco já tem empresas — seed ignorado.');
    return;
  }

  for (const cfg of EMPRESAS) {
    const emp = await db
      .prepare(
        `INSERT INTO empresas (slug, nome, razao_social, cnpj, segmento, telefone, endereco, logo_url,
           instagram, whatsapp, tema, plano, vence_em, aberto_hora, fecha_hora, dias_semana, intervalo_min, dias_agenda)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'mensal', date('now','+30 day'), ?,?,?,15,15)`
      )
      .run(cfg.slug, cfg.nome, cfg.razao_social, cfg.cnpj, cfg.segmento, cfg.telefone, cfg.endereco,
        null, // logo: sem URL externa; a PWA mostra a inicial até o gestor enviar a dele
        cfg.instagram, cfg.whatsapp, cfg.tema, cfg.aberto_hora, cfg.fecha_hora, cfg.dias_semana);
    const empresaId = emp.lastInsertRowid;

    await db.prepare(
      `INSERT INTO usuarios (empresa_id, nome, telefone, email, senha_hash, papel, cargo)
       VALUES (?,?,?,?,?, 'dono', 'Proprietário')`
    ).run(empresaId, cfg.dono.nome, cfg.dono.telefone, cfg.dono.email, hashSenha(cfg.dono.senha));

    for (const p of cfg.equipe) {
      await db.prepare(
        `INSERT INTO usuarios (empresa_id, nome, telefone, senha_hash, papel, cargo, permissoes)
         VALUES (?,?,?,?, 'funcionario', ?, ?)`
      ).run(empresaId, p.nome, p.telefone, hashSenha(p.senha), p.cargo, p.permissoes.join(','));
    }

    for (const s of cfg.servicos) {
      await db.prepare('INSERT INTO servicos (empresa_id, nome, duracao_min, preco_cent) VALUES (?,?,?,?)').run(
        empresaId, s.nome, s.duracao_min, s.preco_cent
      );
    }

    const c = cfg.cliente;
    await db.prepare(
      `INSERT INTO usuarios (empresa_id, nome, telefone, cpf, senha_hash, papel)
       VALUES (?,?,?,?,?, 'cliente')`
    ).run(empresaId, c.nome, c.telefone, c.cpf, hashSenha(c.senha));

    // Promoção de demonstração: 20% no primeiro serviço, válida por 7 dias
    const primeiro = await db
      .prepare('SELECT id FROM servicos WHERE empresa_id = ? ORDER BY id LIMIT 1')
      .get(empresaId);
    const promo = await db
      .prepare('INSERT INTO promocoes (empresa_id, titulo, desconto_pct, inicio, fim) VALUES (?,?,?,?,?)')
      .run(empresaId, 'Semana da casa — 20% OFF', 20, hojeISO(), dias(7));
    await db.prepare('INSERT INTO promocao_itens (promocao_id, servico_id) VALUES (?,?)').run(
      promo.lastInsertRowid, primeiro.id
    );

    // Dois agendamentos de exemplo para o painel não abrir vazio
    const profs = await db
      .prepare(`SELECT id FROM usuarios WHERE empresa_id = ? AND papel IN ('dono','funcionario') ORDER BY id`)
      .all(empresaId);
    const servs = await db.prepare('SELECT * FROM servicos WHERE empresa_id = ? ORDER BY id').all(empresaId);
    const cli = await db.prepare(`SELECT id FROM usuarios WHERE empresa_id = ? AND papel='cliente'`).get(empresaId);

    await db.prepare(
      `INSERT INTO agendamentos (empresa_id, cliente_id, profissional_id, servico_id, data, hora, duracao_min, preco_cent)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(empresaId, cli.id, profs[0].id, servs[0].id, hojeISO(), '14:00', servs[0].duracao_min, servs[0].preco_cent);

    await db.prepare(
      `INSERT INTO agendamentos (empresa_id, profissional_id, servico_id, data, hora, duracao_min, preco_cent, avulso, avulso_nome)
       VALUES (?,?,?,?,?,?,?, 1, ?)`
    ).run(empresaId, profs[profs.length - 1].id, servs[1].id, hojeISO(), '16:00', servs[1].duracao_min,
      servs[1].preco_cent, `Cliente AV - Balcão (${cfg.dono.nome})`);
  }

  // Equipe Jhovis (master)
  const master = {
    nome: 'Jonathan Sena',
    telefone: '38999990000',
    email: 'master@jhovis.com.br',
    senha: 'master123',
  };
  await db.prepare(
    `INSERT INTO usuarios (nome, telefone, email, senha_hash, papel, cargo, permissoes)
     VALUES (?,?,?,?, 'master', 'Master', 'empresas,equipe,licencas')`
  ).run(master.nome, master.telefone, master.email, hashSenha(master.senha));

  if (!silencioso) console.log('Seed concluído.');
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  await conectar();
  await seed();
  console.log(`
  Acessos de demonstração
  ─────────────────────────────────────────────────────────
  Control ......... http://localhost:3000/control
                    master@jhovis.com.br / master123
  Cliente ......... http://localhost:3000/barbearia-noel
                    (38) 99999-4444 / cliente123
  Gestor .......... http://localhost:3000/gestor
                    Barbearia Noel → (38) 99999-1111 / dono123
                    Funcionário   → (38) 99999-2222 / sena123
  Outras empresas . /salao-divas  /studio-plena
  ─────────────────────────────────────────────────────────`);
}
