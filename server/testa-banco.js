// Testa a conexão com o Postgres (Supabase) e cria as tabelas.
// Uso: copie docs/config.exemplo.env para config.env, preencha e rode
//   node --env-file=config.env server/testa-banco.js
// ou, com as variáveis já no ambiente:
//   MARCAZ_DB=postgres DATABASE_URL="..." node server/testa-banco.js
process.env.MARCAZ_DB = process.env.MARCAZ_DB || 'postgres';

const { conectar, db, MODO } = await import('./db.js');

console.log('Modo do banco:', MODO);
const url = process.env.DATABASE_URL || '';
console.log('Conectando em:', url.replace(/:[^:@/]*@/, ':••••••@'));

try {
  await conectar();
  const tabelas = await db
    .prepare(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`
    )
    .all();
  const empresas = await db.prepare('SELECT COUNT(*) AS n FROM empresas').get();
  console.log('\nConectado. Tabelas no schema public:');
  console.log(tabelas.map((t) => '  · ' + t.table_name).join('\n'));
  console.log('\nEmpresas no banco:', empresas.n);
  console.log('\nTudo certo — já podemos fazer o deploy na Vercel.');
  process.exit(0);
} catch (e) {
  console.error('\nFALHOU:', e.message);
  console.error('O que verificar:');
  console.error('  1) A string copiada é a do Connection pooling (porta 6543)?');
  console.error('  2) A senha do banco é a criada junto do projeto (não a do login do site)?');
  console.error('  3) O projeto está ativo (não pausado)? Em pausado, clique Resume project.');
  process.exit(1);
}
