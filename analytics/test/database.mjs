import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

const migrations = new URL('../migrations/', import.meta.url);

export function createDatabase(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'));
  const db = {
    sqlite,
    prepare(sql) {
      const make = params => ({
        bind(...values) { return make(values); },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async run() { return sqlite.prepare(sql).run(...params); }
      });
      return make([]);
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  return db;
}
