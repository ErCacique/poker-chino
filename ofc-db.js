/**
 * ofc-db.js — Historial y ranking en PostgreSQL.
 *
 * Aquí sólo entra lo terminado: manos ya liquidadas. Las partidas en curso
 * viven en Redis (ofc-store.js), que es donde tiene sentido un dato volátil y
 * de alta frecuencia de escritura.
 *
 * Sin ORM a propósito: son cuatro consultas y una migración. Un ORM añadiría
 * dependencia, capa de traducción y una forma más de escribir SQL peor.
 *
 * Node.js >= 18, ESM. Dependencia: pg (v8).
 */

import pg from 'pg';

const SCHEMA = `
create table if not exists users (
  id            text primary key,
  google_sub    text unique not null,
  name          text not null,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create table if not exists hands (
  id          bigserial primary key,
  table_id    text not null,
  hand_number integer not null,
  seats       smallint not null,
  played_at   timestamptz not null default now()
);

create index if not exists hands_played_at_idx on hands (played_at desc);
create index if not exists hands_table_idx     on hands (table_id, played_at desc);

create table if not exists hand_players (
  hand_id          bigint not null references hands (id) on delete cascade,
  user_id          text   not null references users (id),
  seat             smallint not null,
  delta            integer not null,
  royalties        integer not null,
  foul             boolean not null,
  forfeited        boolean not null,
  fantasyland      boolean not null,
  fantasyland_next boolean not null,
  top_hand         text,
  middle_hand      text,
  bottom_hand      text,
  primary key (hand_id, user_id)
);

create index if not exists hand_players_user_idx on hand_players (user_id);

create table if not exists devices (
  token        text primary key,
  user_id      text not null references users (id) on delete cascade,
  platform     text not null,
  updated_at   timestamptz not null default now()
);

create index if not exists devices_user_idx on devices (user_id);
`;

export class Database {
  /**
   * @param {object} [options]
   * @param {string} [options.url=process.env.DATABASE_URL]
   * @param {pg.Pool} [options.pool] pool ya creado (tests, o pool compartido)
   */
  constructor({ url = process.env.DATABASE_URL, pool = null } = {}) {
    this.pool = pool ?? new pg.Pool({ connectionString: url, max: 10 });
    this.ownsPool = !pool;
  }

  /** Crea el esquema si falta. Idempotente: se puede llamar en cada arranque. */
  async migrate() {
    await this.pool.query(SCHEMA);
  }

  /**
   * Alta o actualización del usuario tras validar el token de Google.
   * El identificador interno deriva del `sub`, que es el único dato de Google
   * que no cambia: el correo y el nombre sí pueden cambiar.
   */
  async upsertUser({ googleSub, name, avatarUrl = null }) {
    const id = `g_${googleSub}`;
    const { rows } = await this.pool.query(
      `insert into users (id, google_sub, name, avatar_url)
       values ($1, $2, $3, $4)
       on conflict (google_sub) do update
         set name = excluded.name,
             avatar_url = excluded.avatar_url,
             last_seen_at = now()
       returning id, name, avatar_url`,
      [id, googleSub, name, avatarUrl],
    );
    return { playerId: rows[0].id, name: rows[0].name, avatarUrl: rows[0].avatar_url };
  }

  /**
   * Guarda una mano liquidada. Va en transacción porque la cabecera y las
   * filas de jugador sin la otra parte no significan nada.
   * @param {{tableId:string, handNumber:number, players:Array}} hand
   */
  async recordHand({ tableId, handNumber, players }) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query(
        'insert into hands (table_id, hand_number, seats) values ($1, $2, $3) returning id',
        [tableId, handNumber, players.length],
      );
      const handId = rows[0].id;

      for (const player of players) {
        await client.query(
          `insert into hand_players (
             hand_id, user_id, seat, delta, royalties, foul, forfeited,
             fantasyland, fantasyland_next, top_hand, middle_hand, bottom_hand)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           on conflict do nothing`,
          [
            handId, player.userId, player.seat, player.delta, player.royalties,
            player.foul, player.forfeited, player.fantasyland, player.fantasylandNext,
            player.hands?.top ?? null, player.hands?.middle ?? null, player.hands?.bottom ?? null,
          ],
        );
      }
      await client.query('commit');
      return handId;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Clasificación por puntos por mano, no por puntos totales: el total premia
   * el volumen y deja el primer puesto en manos de quien más juega. El mínimo
   * de manos evita que una racha de tres manos encabece la tabla.
   */
  async leaderboard({ days = 30, minHands = 10, limit = 50 } = {}) {
    const { rows } = await this.pool.query(
      `select u.id,
              u.name,
              u.avatar_url                                            as "avatarUrl",
              count(*)::int                                           as hands,
              sum(hp.delta)::int                                      as points,
              round(avg(hp.delta)::numeric, 2)::float8                as "pointsPerHand",
              round(avg(hp.royalties)::numeric, 2)::float8            as "royaltiesPerHand",
              round(100 * avg(case when hp.foul then 1 else 0 end)::numeric, 1)::float8        as "foulPct",
              round(100 * avg(case when hp.fantasyland then 1 else 0 end)::numeric, 1)::float8 as "fantasylandPct"
         from hand_players hp
         join hands h on h.id = hp.hand_id
         join users u on u.id = hp.user_id
        where h.played_at >= now() - ($1 || ' days')::interval
     group by u.id, u.name, u.avatar_url
       having count(*) >= $2
     order by "pointsPerHand" desc, hands desc
        limit $3`,
      [days, minHands, limit],
    );
    return rows;
  }

  /** Historial reciente de un jugador. */
  async playerHistory(userId, { limit = 20 } = {}) {
    const { rows } = await this.pool.query(
      `select h.table_id as "tableId", h.hand_number as "handNumber", h.played_at as "playedAt",
              hp.delta, hp.royalties, hp.foul, hp.forfeited,
              hp.top_hand as "top", hp.middle_hand as "middle", hp.bottom_hand as "bottom"
         from hand_players hp
         join hands h on h.id = hp.hand_id
        where hp.user_id = $1
     order by h.played_at desc
        limit $2`,
      [userId, limit],
    );
    return rows;
  }

  /**
   * Registra el dispositivo para avisos push. La clave es el token, no el
   * usuario: un mismo móvil puede cambiar de cuenta y el token debe seguir al
   * último que entró, no duplicarse.
   */
  async saveDevice({ userId, token, platform }) {
    await this.pool.query(
      `insert into devices (token, user_id, platform)
       values ($1, $2, $3)
       on conflict (token) do update
         set user_id = excluded.user_id,
             platform = excluded.platform,
             updated_at = now()`,
      [token, userId, platform],
    );
  }

  async devicesFor(userId) {
    const { rows } = await this.pool.query(
      'select token, platform from devices where user_id = $1',
      [userId],
    );
    return rows;
  }

  async deleteDevice(token) {
    await this.pool.query('delete from devices where token = $1', [token]);
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }
}
