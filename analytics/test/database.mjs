import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function createDatabase(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec(readFileSync(new URL('../migrations/0001_aggregate_metrics.sql', import.meta.url), 'utf8'));
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
