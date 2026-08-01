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
  username_set  boolean not null default false,
  avatar_kind   text not null default 'google',
  avatar_data   bytea,
  avatar_mime   text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

alter table users add column if not exists username_set boolean not null default false;
alter table users add column if not exists avatar_kind  text not null default 'google';
alter table users add column if not exists avatar_data  bytea;
alter table users add column if not exists avatar_mime  text;

-- Amistades: una fila por solicitud/relación, orientada de from_user a to_user.
-- El estado 'accepted' hace la relación bidireccional a efectos de consulta
-- (se busca por from_user o to_user indistintamente).
create table if not exists friendships (
  id          bigserial primary key,
  from_user   text not null references users (id) on delete cascade,
  to_user     text not null references users (id) on delete cascade,
  status      text not null default 'pending', -- pending | accepted
  created_at  timestamptz not null default now(),
  responded_at timestamptz,
  check (from_user <> to_user)
);

create unique index if not exists friendships_pair_idx
  on friendships (least(from_user, to_user), greatest(from_user, to_user));
create index if not exists friendships_to_user_idx on friendships (to_user, status);
create index if not exists friendships_from_user_idx on friendships (from_user, status);

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
   *
   * El `name` sólo se fija en el alta inicial (con el nombre de Google como
   * relleno provisional) y nunca se vuelve a pisar: en cuanto el jugador elige
   * su propio username, un login posterior de Google no debe machacarlo.
   */
  async upsertUser({ googleSub, name, avatarUrl = null }) {
    const id = `g_${googleSub}`;
    const { rows } = await this.pool.query(
      `insert into users (id, google_sub, name, avatar_url)
       values ($1, $2, $3, $4)
       on conflict (google_sub) do update
         set avatar_url = excluded.avatar_url,
             last_seen_at = now()
       returning id, name, avatar_url as "avatarUrl", username_set as "usernameSet", avatar_kind as "avatarKind"`,
      [id, googleSub, name, avatarUrl],
    );
    return {
      playerId: rows[0].id,
      name: rows[0].name,
      avatarUrl: rows[0].avatarUrl,
      usernameSet: rows[0].usernameSet,
      avatarKind: rows[0].avatarKind,
    };
  }

  /**
   * Fija el username elegido por el jugador. Único (sin distinguir mayúsculas)
   * para que no haya dos jugadores indistinguibles en la mesa o el ranking.
   */
  async setUsername(userId, username) {
    const { rows: clash } = await this.pool.query(
      'select id from users where lower(name) = lower($1) and id <> $2',
      [username, userId],
    );
    if (clash.length) {
      const err = new Error('Ese nombre ya está en uso');
      err.code = 'USERNAME_TAKEN';
      throw err;
    }
    const { rows } = await this.pool.query(
      `update users set name = $1, username_set = true
        where id = $2
      returning id, name, avatar_url as "avatarUrl", username_set as "usernameSet", avatar_kind as "avatarKind"`,
      [username, userId],
    );
    if (!rows.length) {
      const err = new Error('Usuario no encontrado');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return {
      playerId: rows[0].id,
      name: rows[0].name,
      avatarUrl: rows[0].avatarUrl,
      usernameSet: rows[0].usernameSet,
      avatarKind: rows[0].avatarKind,
    };
  }

  /**
   * Fija el avatar del jugador. Tres modalidades:
   *  - 'google': vuelve a usar la foto de su cuenta de Google (avatarUrl).
   *  - 'preset': un icono predefinido; sólo guarda el id, sin bytes (avatarUrl = 'preset:<id>').
   *  - 'custom': imagen subida por el jugador, guardada en la propia fila (bytea).
   *    Va aparte de avatar_url para no mandar binarios en cada consulta de lista/ranking.
   */
  async setAvatar(userId, { kind, url = null, data = null, mime = null }) {
    const { rows } = await this.pool.query(
      `update users set
         avatar_kind = $2,
         avatar_url  = $3,
         avatar_data = $4,
         avatar_mime = $5
       where id = $1
       returning id, name, avatar_url as "avatarUrl", avatar_kind as "avatarKind", username_set as "usernameSet"`,
      [userId, kind, url, data, mime],
    );
    if (!rows.length) {
      const err = new Error('Usuario no encontrado');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return {
      playerId: rows[0].id,
      name: rows[0].name,
      avatarUrl: rows[0].avatarUrl,
      avatarKind: rows[0].avatarKind,
      usernameSet: rows[0].usernameSet,
    };
  }

  /** Bytes del avatar subido por el jugador, para servir GET /api/avatar/:id. */
  async getAvatarBlob(userId) {
    const { rows } = await this.pool.query(
      'select avatar_data as data, avatar_mime as mime from users where id = $1 and avatar_kind = $2',
      [userId, 'custom'],
    );
    return rows[0] ?? null;
  }

  /**
   * Estadísticas propias del jugador: todo el histórico, sin ventana de
   * tiempo (a diferencia del ranking, que sí acota por días).
   */
  async playerStats(userId) {
    const { rows } = await this.pool.query(
      `select count(*)::int                                                        as hands,
              coalesce(sum(hp.delta), 0)::int                                       as points,
              coalesce(round(avg(hp.delta)::numeric, 2), 0)::float8                 as "pointsPerHand",
              coalesce(round(avg(hp.royalties)::numeric, 2), 0)::float8             as "royaltiesPerHand",
              coalesce(round(100 * avg(case when hp.foul then 1 else 0 end)::numeric, 1), 0)::float8        as "foulPct",
              coalesce(round(100 * avg(case when hp.fantasyland then 1 else 0 end)::numeric, 1), 0)::float8 as "fantasylandPct"
         from hand_players hp
        where hp.user_id = $1`,
      [userId],
    );
    return rows[0];
  }

  /**
   * Envía una solicitud de amistad por username exacto (sin distinguir
   * mayúsculas). El índice único sobre el par ordenado evita duplicados en
   * cualquier dirección: si ya existe una fila entre A y B, esto falla.
   */
  async sendFriendRequest(fromUserId, toUsername) {
    const { rows: target } = await this.pool.query(
      'select id from users where lower(name) = lower($1)',
      [toUsername],
    );
    if (!target.length) {
      const err = new Error('No existe ningún jugador con ese nombre');
      err.code = 'NOT_FOUND';
      throw err;
    }
    const toUserId = target[0].id;
    if (toUserId === fromUserId) {
      const err = new Error('No puedes enviarte una solicitud a ti mismo');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    try {
      const { rows } = await this.pool.query(
        `insert into friendships (from_user, to_user, status)
         values ($1, $2, 'pending')
         returning id`,
        [fromUserId, toUserId],
      );
      return rows[0].id;
    } catch (error) {
      if (error.code === '23505') { // unique_violation: ya existe la relación
        const err = new Error('Ya existe una solicitud o amistad con ese jugador');
        err.code = 'ALREADY_EXISTS';
        throw err;
      }
      throw error;
    }
  }

  /** Acepta o rechaza una solicitud recibida. Rechazar borra la fila: se puede volver a pedir. */
  async respondFriendRequest(requestId, userId, accept) {
    if (!accept) {
      await this.pool.query(
        'delete from friendships where id = $1 and to_user = $2 and status = $3',
        [requestId, userId, 'pending'],
      );
      return null;
    }
    const { rows } = await this.pool.query(
      `update friendships set status = 'accepted', responded_at = now()
        where id = $1 and to_user = $2 and status = 'pending'
      returning id`,
      [requestId, userId],
    );
    if (!rows.length) {
      const err = new Error('Solicitud no encontrada');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return rows[0].id;
  }

  /** Elimina una amistad ya aceptada, o cancela una solicitud propia pendiente. */
  async removeFriendship(requestId, userId) {
    await this.pool.query(
      'delete from friendships where id = $1 and (from_user = $2 or to_user = $2)',
      [requestId, userId],
    );
  }

  /** Amigos aceptados + solicitudes entrantes/salientes pendientes. */
  async listFriends(userId) {
    const { rows } = await this.pool.query(
      `select f.id, f.status, f.from_user as "fromUser", f.to_user as "toUser",
              case when f.from_user = $1 then f.to_user else f.from_user end as "otherId",
              u.name, u.avatar_url as "avatarUrl", u.avatar_kind as "avatarKind"
         from friendships f
         join users u on u.id = case when f.from_user = $1 then f.to_user else f.from_user end
        where f.from_user = $1 or f.to_user = $1
     order by f.created_at desc`,
      [userId],
    );
    return {
      friends: rows.filter((r) => r.status === 'accepted'),
      incoming: rows.filter((r) => r.status === 'pending' && r.toUser === userId),
      outgoing: rows.filter((r) => r.status === 'pending' && r.fromUser === userId),
    };
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
              u.avatar_kind                                           as "avatarKind",
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
     group by u.id, u.name, u.avatar_url, u.avatar_kind
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
