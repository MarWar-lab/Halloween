/**
 * Apply every migration to a real Postgres and play a round against it.
 *
 * PGlite is Postgres compiled to WASM, so this catches what review cannot: a
 * function that does not compile, an ambiguous column, a policy that refers to
 * something that is not there yet. Those are exactly the errors that otherwise
 * surface as a red box in the Supabase SQL editor after the migration has
 * already half-applied.
 *
 * It is not a substitute for verify-live.py. This proves the SQL is correct;
 * that proves the live project is actually in this state.
 *
 *   node scripts/check-migrations.mjs
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = await new PGlite();

let pass = 0;
const fail = [];
const check = (label, ok, detail = '') => {
  if (ok) pass++;
  else fail.push(label);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

/**
 * The parts of Supabase the migrations lean on. Everything here is a stub of
 * something the hosted project provides; if a migration needs more than this,
 * that itself is worth knowing.
 */
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create publication supabase_realtime;
  create schema if not exists auth;
  -- Supabase's user table. Only its primary key matters here: the schema
  -- references it, nothing in these migrations reads a column from it.
  create table auth.users (id uuid primary key);

  -- Whoever we are pretending to be for the next statement.
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('campfire.uid', true), '')::uuid;
  $$;
`);

/**
 * Become this user for everything that follows.
 *
 * The role switch is the point: a table's owner bypasses row-level security
 * entirely, so reads made as the superuser would prove nothing at all about
 * the policies. `authenticated` is the role Supabase's anonymous sign-in
 * hands out.
 */
const be = async (uid) => {
  await db.exec('reset role;');
  if (uid) await db.query(`insert into auth.users (id) values ($1) on conflict (id) do nothing`, [uid]);
  await db.exec(`select set_config('campfire.uid', '${uid ?? ''}', false);`);
  await db.exec('set role authenticated;');
};

const files = readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();

const load = (file) =>
  readFileSync(join(root, 'supabase/migrations', file), 'utf8')
    // PostgREST is not running here and there is nothing to tell.
    .replace(/notify pgrst[^;]*;/g, '')
    // Supabase ships pgcrypto; PGlite does not bundle it. The only thing the
    // migrations want from it is gen_random_uuid(), which has been in core
    // Postgres since 13, so dropping the extension changes nothing tested.
    .replace(/create extension[^;]*;/gi, '');

console.log('\n=== applying migrations ===');
for (const file of files) {
  const sql = load(file);
  try {
    await db.exec(sql);
    check(`${file} applies`, true);
  } catch (err) {
    check(`${file} applies`, false, String(err.message).split('\n')[0]);
    console.log('\nStopping: later migrations assume this one worked.\n');
    process.exit(1);
  }
}

console.log('\n=== applying twice is safe ===');
// A half-finished paste gets re-run. It must not explode the second time.
for (const file of files) {
  try {
    await db.exec(load(file));
    check(`${file} is idempotent`, true);
  } catch (err) {
    check(`${file} is idempotent`, false, String(err.message).split('\n')[0]);
  }
}

console.log('\n=== there is exactly one cast_vote ===');
const overloads = await db.query(
  `select pg_get_function_identity_arguments(p.oid) as args
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'cast_vote'`,
);
check('no leftover overload', overloads.rows.length === 1,
  overloads.rows.map((r) => r.args).join(' | '));

console.log('\n=== a real round ===');
const HOST = '11111111-1111-1111-1111-111111111111';
const ANA = '22222222-2222-2222-2222-222222222222';
const BEN = '33333333-3333-3333-3333-333333333333';

await be(HOST);
const game = (await db.query(`select * from create_game('halloween','halloween')`)).rows[0];
check('create_game', !!game.code, `code ${game.code}`);

const seat = async (uid, name) => {
  await be(uid);
  return (await db.query(`select * from join_game($1,$2,'{}'::jsonb)`, [game.code, name])).rows[0];
};
const ph = await seat(HOST, 'Hana');
const pa = await seat(ANA, 'Ana');
const pb = await seat(BEN, 'Ben');
check('three players joined', new Set([ph.id, pa.id, pb.id]).size === 3);

await be(HOST);
const proxy = (await db.query(`select * from add_proxy($1,'Dev','{}'::jsonb)`, [game.id])).rows[0];
check('proxy added', proxy.is_proxy === true);

const round = (await db.query(
  `select * from start_round($1,'ghost-writer','allplay','say',null,null,'submitting',90)`,
  [game.id])).rows[0];
check('start_round sets a server deadline', !!round.deadline_at);

for (const [uid, text] of [[ANA, 'ANA_ANSWER'], [BEN, 'BEN_ANSWER']]) {
  await be(uid);
  await db.query(`select submit_answer($1,$2,null)`, [round.id, text]);
}
await be(HOST);
await db.query(`select submit_answer($1,'HOST_ANSWER',null)`, [round.id]);
await db.query(`select submit_answer($1,'PROXY_ANSWER',$2)`, [round.id, proxy.id]);

console.log('\n--- the host can count answers without reading them ---');
await be(HOST);
const prog = (await db.query(`select * from round_progress($1)`, [round.id])).rows[0];
check('round_progress counts everyone', prog.submitted.length === 4, `${prog.submitted.length} of 4`);

await be(BEN);
const sealed = await db.query(`select text from submissions where round_id = $1`, [round.id]);
check('Ben cannot read a sealed answer', sealed.rows.length === 1,
  sealed.rows.map((r) => r.text).join(','));

console.log('\n--- the reveal does not name the author ---');
await be(HOST);
await db.query(`select advance_round($1,'revealing',null)`, [round.id]);
await be(BEN);
const revealed = (await db.query(`select * from round_submissions($1)`, [round.id])).rows;
check('Ben now sees every answer', revealed.length === 4, `${revealed.length} of 4`);
const notBens = revealed.filter((r) => r.text !== 'BEN_ANSWER');
check('and none of them is attributed', notBens.every((r) => r.player_id === null));
check('but Ben can still find his own',
  revealed.find((r) => r.text === 'BEN_ANSWER')?.player_id === pb.id);

await be(HOST);
const hostView = (await db.query(`select * from round_submissions($1)`, [round.id])).rows;
check('the host sees the answer they typed for their proxy',
  hostView.find((r) => r.text === 'PROXY_ANSWER')?.player_id === proxy.id);
check('and still cannot see who wrote the rest',
  hostView.find((r) => r.text === 'ANA_ANSWER')?.player_id === null);

console.log('\n--- voting ---');
await be(HOST);
await db.query(`select advance_round($1,'voting',null)`, [round.id]);
const anaRow = hostView.find((r) => r.text === 'ANA_ANSWER');
const benRow = hostView.find((r) => r.text === 'BEN_ANSWER');

await be(BEN);
await db.query(`select cast_vote($1,null,null,null,null,$2)`, [round.id, anaRow.id]);
const resolved = (await db.query(
  `select target_player_id from votes where round_id=$1 and voter_id=$2`, [round.id, pb.id])).rows[0];
check('the server resolved the author from the answer', resolved.target_player_id === pa.id);

let refused = null;
try {
  await db.query(`select cast_vote($1,null,null,null,null,$2)`, [round.id, benRow.id]);
} catch (e) { refused = e.message; }
check('voting for your own answer is refused', !!refused, (refused ?? '').split('\n')[0]);

await db.query(`select cast_vote($1,null,null,null,null,$2)`, [round.id, anaRow.id]);
const mine = await db.query(`select id from votes where round_id=$1 and voter_id=$2`, [round.id, pb.id]);
check('changing your vote replaces it', mine.rows.length === 1, `${mine.rows.length} rows`);

await be(ANA);
await db.query(`select cast_vote($1,null,null,null,null,$2)`, [round.id, benRow.id]);
await be(HOST);
await db.query(`select cast_vote($1,null,null,null,null,$2)`, [round.id, anaRow.id]);
await db.query(`select cast_vote($1,null,null,null,$2,$3)`, [round.id, proxy.id, anaRow.id]);

const results = (await db.query(`select score_round($1) as r`, [round.id])).rows[0].r;
check('score_round returns points', !!results.points);
const scores = (await db.query(
  `select name, score from players where game_id=$1 order by score desc`, [game.id])).rows;
// Ana: 1 for answering + 3 votes x 2. Ben: 1 + 1 vote x 2.
check('a vote is worth two and answering is worth one',
  scores.find((s) => s.name === 'Ana').score === 7 && scores.find((s) => s.name === 'Ben').score === 3,
  JSON.stringify(scores));

console.log('\n--- guess-who counts every guess, not just the first ---');
await be(HOST);
const gw = (await db.query(
  `select * from start_round($1,'first-costume','guesswho','say',null,null,'submitting',90)`,
  [game.id])).rows[0];
for (const [uid, text] of [[ANA, 'ANA_FACT'], [BEN, 'BEN_FACT'], [HOST, 'HOST_FACT']]) {
  await be(uid);
  await db.query(`select submit_answer($1,$2,null)`, [gw.id, text]);
}
await be(HOST);
await db.query(`select advance_round($1,'revealing',null)`, [gw.id]);
await db.query(`select advance_round($1,'voting',null)`, [gw.id]);
const gwRows = (await db.query(`select * from round_submissions($1)`, [gw.id])).rows;
const byText = Object.fromEntries(gwRows.map((r) => [r.text, r.id]));

await be(BEN);
const benBefore = (await db.query(`select score from players where id=$1`, [pb.id])).rows[0].score;
await db.query(`select cast_vote($1,null,null,$2,null,$3)`, [gw.id, pa.id, byText['ANA_FACT']]);
await db.query(`select cast_vote($1,null,null,$2,null,$3)`, [gw.id, ph.id, byText['HOST_FACT']]);
const benVotes = await db.query(`select id from votes where round_id=$1 and voter_id=$2`, [gw.id, pb.id]);
check('a guess-who voter may guess once per answer', benVotes.rows.length === 2,
  `${benVotes.rows.length} guesses kept`);

await be(HOST);
await db.query(`select score_round($1)`, [gw.id]);
const benAfter = (await db.query(`select score from players where id=$1`, [pb.id])).rows[0].score;
check('both correct guesses scored two each', benAfter - benBefore === 4,
  `+${benAfter - benBefore}`);

console.log('\n--- the Pass ---');
await be(HOST);
const solo = (await db.query(
  `select * from start_round($1,'the-sound','solo','say',$2,null,'choosing',null)`,
  [game.id, pb.id])).rows[0];
const before = (await db.query(`select score from players where id=$1`, [pb.id])).rows[0].score;
await be(BEN);
await db.query(`select spend_pass($1,null)`, [game.id]);
const after = (await db.query(`select score, pass_spent from players where id=$1`, [pb.id])).rows[0];
const closed = (await db.query(`select phase from rounds where id=$1`, [solo.id])).rows[0];
check('the Pass costs exactly zero', after.score === before, `${before} -> ${after.score}`);
check('the Pass is recorded', after.pass_spent === true);
check('the Pass closes the card', closed.phase === 'scored', closed.phase);

console.log('\n=== the one-tap card ===');
await be(HOST);
const sp = (await db.query(
  `select * from start_round($1,'split-hero','split','say',null,null,'voting',30)`,
  [game.id])).rows[0];
check('a split is dealt straight into the vote', sp.phase === 'voting', sp.phase);

// Three one way, one the other.
for (const [uid, side] of [[HOST, 0], [ANA, 0], [BEN, 1]]) {
  await be(uid);
  await db.query(`select cast_vote($1,null,null,null,null,null,$2)`, [sp.id, side]);
}
await be(HOST);
await db.query(`select cast_vote($1,null,null,null,$2,null,0)`, [sp.id, proxy.id]);

let noSide = null;
try {
  await be(BEN);
  await db.query(`select cast_vote($1,null,null,null,null,null,null)`, [sp.id]);
} catch (e) { noSide = e.message; }
check('a split vote must name a side', !!noSide, (noSide ?? '').split('\n')[0]);

await be(HOST);
const beforeSplit = Object.fromEntries(
  (await db.query(`select id, score from players where game_id=$1`, [game.id])).rows.map(
    (r) => [r.id, r.score]),
);
await db.query(`select score_round($1)`, [sp.id]);
const afterSplit = Object.fromEntries(
  (await db.query(`select id, score from players where game_id=$1`, [game.id])).rows.map(
    (r) => [r.id, r.score]),
);
const gained = (id) => afterSplit[id] - beforeSplit[id];
// Ben was alone on side 1: a point for answering plus two for the smaller half.
check('the smaller half is worth more', gained(pb.id) === 3, `Ben +${gained(pb.id)}`);
check('the larger half still scores', gained(pa.id) === 1, `Ana +${gained(pa.id)}`);
check('everybody who tapped scored something',
  [ph.id, pa.id, pb.id, proxy.id].every((id) => gained(id) > 0));

console.log('\n=== the poll ===');
await be(HOST);
const pl = (await db.query(
  `select * from start_round($1,'poll-decorate','poll','say',null,null,'voting',30)`,
  [game.id])).rows[0];
check('a poll is dealt straight into the vote', pl.phase === 'voting', pl.phase);

// Two name Ana, one names Ben, and one names themselves.
for (const [uid, target] of [[HOST, pa.id], [BEN, pa.id], [ANA, pb.id]]) {
  await be(uid);
  await db.query(`select cast_vote($1,$2,null,null,null,null,null)`, [pl.id, target]);
}
await be(ANA);
let selfOk = true;
try {
  await db.query(`select cast_vote($1,$2,null,null,null,null,null)`, [pl.id, pa.id]);
} catch { selfOk = false; }
check('naming yourself is a legitimate answer to a poll', selfOk);

await be(HOST);
const beforePoll = Object.fromEntries(
  (await db.query(`select id, score from players where game_id=$1`, [game.id])).rows.map(
    (r) => [r.id, r.score]));
await db.query(`select score_round($1)`, [pl.id]);
const afterPoll = Object.fromEntries(
  (await db.query(`select id, score from players where game_id=$1`, [game.id])).rows.map(
    (r) => [r.id, r.score]));
const got = (id) => afterPoll[id] - beforePoll[id];
// Ana was named twice (by Hana and Ben) and also named herself once.
// She takes the 3 for being named, plus 1 for answering, plus 1 for calling it.
check('the room’s choice is paid without a second vote', got(pa.id) >= 3, `Ana +${got(pa.id)}`);
check('everyone who named somebody scored', [ph.id, pb.id].every((id) => got(id) > 0));

// ── The Last Screen Standing ────────────────────────────────────────────────
//
// A separate game on separate tables, and the checks that matter are all one
// question: can a player learn a percentage that is not theirs? Everything
// else about this game is decoration if the answer is yes.

console.log('\n=== The Last Screen Standing: the seal ===');

const SHOST = '44444444-4444-4444-4444-444444444444';
const CARA = '55555555-5555-5555-5555-555555555555';
const DEV = '66666666-6666-6666-6666-666666666666';
const LEE = '77777777-7777-7777-7777-777777777777';

const refuses = async (sql, params = []) => {
  try {
    await db.query(sql, params);
    return null;
  } catch (err) {
    return String(err.message).split('\n')[0];
  }
};

await be(SHOST);
const sgame = (await db.query(`select * from survival_create('Hana')`)).rows[0];
check('survival_create allocates a room code', sgame?.code?.length === 4, sgame?.code);

await be(CARA);
const pCara = (await db.query(`select * from survival_join($1,'Cara')`, [sgame.code])).rows[0];
await be(DEV);
const pDev = (await db.query(`select * from survival_join($1,'Dev')`, [sgame.code])).rows[0];
check('two more players joined', !!pCara?.id && !!pDev?.id);

// Explicit: this whole section is about individual answers, individual
// percentages and individual auto-assignment — three players default into
// one shared team now that consensus is the default mode, and a shared
// team's tap fans out to everyone on it.
await be(SHOST);
await db.query(`select survival_set_mode($1, 'solo')`, [sgame.id]);

console.log('\n--- the sealed table has no way in ---');
await be(CARA);
check('a player cannot read survival_options',
  !!(await refuses(`select * from survival_options`)));
check('a player cannot ask which move is worst',
  !!(await refuses(`select survival_worst_option(0)`)));
check('a player cannot write an answer directly',
  !!(await refuses(`select survival_assign($1,$2,0,1,false)`, [sgame.id, pCara.id])));
check('a player cannot ask anyone\'s odds directly, not even their own',
  !!(await refuses(`select survival_odds($1,$2)`, [sgame.id, pCara.id])));
check('nor the unrounded figure behind it',
  !!(await refuses(`select survival_odds_precise($1,$2)`, [sgame.id, pCara.id])));

console.log('\n--- two warm-ups, nobody answering, nothing at stake ---');
await be(SHOST);
await db.query(`select survival_advance($1)`, [sgame.id]); // briefing
await db.query(`select survival_advance($1)`, [sgame.id]); // running — question_idx = -2

let started = (await db.query(`select question_idx from survival_games where id=$1`, [sgame.id])).rows[0];
check('the night opens on the first warm-up', started.question_idx === -2, `${started.question_idx}`);

await db.query(`select survival_reveal($1)`, [sgame.id]); // reveal warm-up 1, silence throughout
check('a silent warm-up gets nobody auto-assigned',
  (await db.query(`select * from survival_answers where game_id=$1 and question_idx=-2`, [sgame.id])).rows.length === 0);
check('and never writes a percentage',
  (await db.query(`select * from survival_scores where game_id=$1 and question_idx=-2`, [sgame.id])).rows.length === 0);

await db.query(`select survival_advance($1)`, [sgame.id]); // → warm-up 2, question_idx = -1
await db.query(`select survival_reveal($1)`, [sgame.id]);
check('the second warm-up behaves the same way',
  (await db.query(`select * from survival_answers where game_id=$1 and question_idx=-1`, [sgame.id])).rows.length === 0 &&
  (await db.query(`select * from survival_scores where game_id=$1 and question_idx=-1`, [sgame.id])).rows.length === 0);

await db.query(`select survival_advance($1)`, [sgame.id]); // → question_idx = 0, the real gauntlet begins
started = (await db.query(`select question_idx, revealed from survival_games where id=$1`, [sgame.id])).rows[0];
check('the gauntlet opens fresh, unrevealed', started.question_idx === 0 && started.revealed === false);

console.log('\n--- one question, played ---');
await be(CARA);
// Option 2 on question 0 is 'block their number', the best move on the card.
await db.query(`select survival_answer($1, 2)`, [sgame.id]);
check('a tap is final', !!(await refuses(`select survival_answer($1, 0)`, [sgame.id])));

await be(DEV);
check('nobody else sees a choice before the reveal',
  (await db.query(`select * from survival_answers where game_id=$1`, [sgame.id])).rows.length === 0);

await be(SHOST);
check('the host cannot skip the reveal',
  !!(await refuses(`select survival_advance($1)`, [sgame.id])));
await db.query(`select survival_reveal($1)`, [sgame.id]);

await be(DEV);
const opened = (await db.query(
  `select player_id, option_index, auto_assigned from survival_answers
    where game_id=$1 and question_idx=0`, [sgame.id])).rows;
check('every choice opens at the reveal', opened.length === 3, `${opened.length} of 3`);
check('the silent players were given the worst move',
  opened.filter((r) => r.auto_assigned).every((r) => r.option_index === 0) &&
  opened.filter((r) => r.auto_assigned).length === 2);

console.log('\n--- but the percentages do not ---');
await be(CARA);
const myPct = (await db.query(`select * from survival_scores where game_id=$1`, [sgame.id])).rows;
check('you see your own percentage', myPct.length === 1 && myPct[0].survival_pct === 75,
  `${myPct.length} row(s)`);
check('and only your own', myPct.every((r) => r.player_id === pCara.id));
check('survival_standings refuses before the tribunal',
  !!(await refuses(`select * from survival_standings($1)`, [sgame.id])));

const reveal = (await db.query(`select * from survival_reveal_data($1, 0)`, [sgame.id])).rows;
check('the reveal carries five outcomes', reveal.length === 5, `${reveal.length}`);
check('and no percentage anywhere in it',
  reveal.every((r) => !Object.keys(r).some((k) => k.includes('pct'))),
  Object.keys(reveal[0] ?? {}).join(','));
check('and counts who took each move',
  reveal.find((r) => r.option_index === 2)?.takers === 1);

console.log('\n--- arriving late ---');
await be(LEE);
const pLee = (await db.query(`select * from survival_join($1,'Lee')`, [sgame.code])).rows[0];
const leeRows = (await db.query(
  `select * from survival_answers where game_id=$1 and player_id=$2`, [sgame.id, pLee.id])).rows;
check('a late joiner is backfilled for every revealed question', leeRows.length === 1,
  `${leeRows.length}`);
check('with the worst move, flagged as not their doing',
  leeRows[0]?.option_index === 0 && leeRows[0]?.auto_assigned === true);

console.log('\n--- the rest of the night, nobody answering ---');
for (let q = 1; q <= 8; q += 1) {
  await be(SHOST);
  await db.query(`select survival_advance($1)`, [sgame.id]);
  await db.query(`select survival_reveal($1)`, [sgame.id]);
}
await be(SHOST);
await db.query(`select survival_advance($1)`, [sgame.id]); // → plea

// The invariant the whole schema leans on: no player has a gap, whatever they
// did or did not do, and whenever they turned up.
const gaps = (await db.query(
  `select p.name, count(a.*)::int as n
     from survival_players p
     left join survival_answers a on a.game_id = p.game_id and a.player_id = p.id
    where p.game_id = $1 group by p.name order by p.name`, [sgame.id])).rows;
check('every player has an answer for every question',
  gaps.length === 4 && gaps.every((r) => r.n === 9),
  gaps.map((r) => `${r.name}:${r.n}`).join(' '));

console.log('\n--- the plea and the tribunal ---');
await be(CARA);
await db.query(`select survival_plea($1,'I have the ledger passcodes')`, [sgame.id]);
await be(DEV);
await db.query(`select survival_plea($1,'I am very light')`, [sgame.id]);
check('a plea is sealed while people are still writing',
  (await db.query(`select * from survival_pleas where game_id=$1`, [sgame.id])).rows.length === 1);

// Who has acted is public at every phase; what they did is not. Without this
// the host has no way to know the room has finished writing, and the shared
// screen shows an empty roster all the way through.
await be(DEV);
const midPlea = (await db.query(`select * from survival_progress($1)`, [sgame.id])).rows[0];
check('the host can see who has filed a plea', midPlea.pleaded.length === 2,
  `${midPlea.pleaded.length} of 4`);
check('without the pleas themselves travelling',
  (await db.query(`select * from survival_pleas where game_id=$1`, [sgame.id])).rows.length === 1);

await be(SHOST);
await db.query(`select survival_advance($1)`, [sgame.id]); // → tribunal

await be(DEV);
check('the pleas open at the tribunal, with names on them',
  (await db.query(`select * from survival_pleas where game_id=$1`, [sgame.id])).rows.length === 2);
const standings = (await db.query(`select * from survival_standings($1)`, [sgame.id])).rows;
check('and so does everybody else’s survival rate', standings.length === 4);
check('Cara leads, having made the one good decision of the night',
  standings[0]?.name === 'Cara', standings.map((s) => `${s.name} ${s.average}%`).join(', '));
check('a vote cannot be cast for yourself',
  !!(await refuses(`select survival_vote($1,$2)`, [sgame.id, pDev.id])));

// A dead heat on votes, so the tie-break is what decides it.
await db.query(`select survival_vote($1,$2)`, [sgame.id, pCara.id]);
await be(CARA);
await db.query(`select survival_vote($1,$2)`, [sgame.id, pDev.id]);
await be(SHOST);
await db.query(`select survival_vote($1,$2)`, [sgame.id, pCara.id]);
await be(LEE);
await db.query(`select survival_vote($1,$2)`, [sgame.id, pDev.id]);

await be(LEE);
const voting = (await db.query(`select * from survival_progress($1)`, [sgame.id])).rows[0];
check('and who has voted, without the votes', voting.voted.length === 4,
  `${voting.voted.length} of 4`);

await be(CARA);
check('no tally builds up in public while voting',
  (await db.query(`select * from survival_votes where game_id=$1`, [sgame.id])).rows.length === 1);
check('survival_winner refuses before the room has finished',
  !!(await refuses(`select * from survival_winner($1)`, [sgame.id])));

await be(SHOST);
await db.query(`select survival_advance($1)`, [sgame.id]); // → result
await be(LEE);
const winner = (await db.query(`select * from survival_winner($1)`, [sgame.id])).rows;
check('a tied vote is broken by the higher survival average',
  winner.length === 1 && winner[0].name === 'Cara',
  winner.map((w) => `${w.name} ${w.votes}v ${w.average}%`).join(', '));

console.log('\n--- two players who round to the same "64.0%" but are not tied ---');
// Geometric mean spreads odds across a legible range, but two different
// precise values can still land on the same rounded display by coincidence.
// Both of these players show "64.0%" once rounded, and if the ranking or the
// tie-break ever compared THAT figure instead of the unrounded one, this
// would misreport a real difference as a draw.
const PING = '88888888-8888-8888-8888-888888888888';
const PONG = '99999999-9999-9999-9999-999999999999';
await be(SHOST);
const pgame = (await db.query(`select * from survival_create('Ref')`)).rows[0];
await be(PING);
const pPing = (await db.query(`select * from survival_join($1,'Ping')`, [pgame.code])).rows[0];
await be(PONG);
const pPong = (await db.query(`select * from survival_join($1,'Pong')`, [pgame.code])).rows[0];

// Written directly rather than played through real rounds: the point here is
// the arithmetic on already-scored rows, not how they got scored.
await be(SHOST);
await db.exec('reset role;');
// sqrt(0.63 * 0.65) ≈ 63.992% precise, rounds to 64.0%.
for (const pct of [63, 65]) {
  await db.query(
    `insert into survival_scores (game_id, player_id, question_idx, survival_pct)
     values ($1,$2,(select coalesce(max(question_idx),-1)+1 from survival_scores
                     where game_id=$1 and player_id=$2),$3)`,
    [pgame.id, pPing.id, pct]);
}
// sqrt(0.64 * 0.64) = 64.0% precise exactly — same rounded figure, still ahead underneath.
for (const pct of [64, 64]) {
  await db.query(
    `insert into survival_scores (game_id, player_id, question_idx, survival_pct)
     values ($1,$2,(select coalesce(max(question_idx),-1)+1 from survival_scores
                     where game_id=$1 and player_id=$2),$3)`,
    [pgame.id, pPong.id, pct]);
}
await db.query(`select survival_advance($1)`, [pgame.id]); // briefing
await db.query(`select survival_advance($1)`, [pgame.id]); // running
await db.query(`select survival_reveal($1)`, [pgame.id]);
await db.query(`update survival_games set phase='tribunal' where id=$1`, [pgame.id]);

await be(PING);
const rounded = (await db.query(`select * from survival_standings($1)`, [pgame.id])).rows;
// Ref (the host) never scored a round and legitimately shows 0% — only Ping
// and Pong are the ones under test here.
const pingPong = rounded.filter((r) => r.name === 'Ping' || r.name === 'Pong');
check('both players display as the same rounded figure',
  pingPong.every((r) => Number(r.average) === 64),
  rounded.map((r) => `${r.name} ${r.average}%`).join(', '));
check('but Pong (64.0% exactly) is ranked above Ping (63.992%) underneath it',
  rounded[0]?.name === 'Pong',
  rounded.map((r) => r.name).join(' > '));

await db.query(`select survival_vote($1,$2)`, [pgame.id, pPong.id]);
await be(PONG);
await db.query(`select survival_vote($1,$2)`, [pgame.id, pPing.id]);
await be(SHOST);
await db.query(`select survival_advance($1)`, [pgame.id]); // → result
await be(PING);
const tieBreak = (await db.query(`select * from survival_winner($1)`, [pgame.id])).rows;
check('a vote tie is broken by the same unrounded figure, not the display one',
  tieBreak.length === 1 && tieBreak[0].name === 'Pong',
  tieBreak.map((w) => `${w.name} ${w.votes}v ${w.average}%`).join(', '));

console.log('\n=== the extraction code and the ruthlessness trap ===');

const EHOST = '10101010-1010-1010-1010-101010101010';
const ECARA = '20202020-2020-2020-2020-202020202020';
const EDEV = '30303030-3030-3030-3030-303030303030';
const ELEE = '40404040-4040-4040-4040-404040404040';

await be(EHOST);
const egame = (await db.query(`select * from survival_create('Hana')`)).rows[0];
await be(ECARA);
const eCara = (await db.query(`select * from survival_join($1,'Cara')`, [egame.code])).rows[0];
await be(EDEV);
const eDev = (await db.query(`select * from survival_join($1,'Dev')`, [egame.code])).rows[0];
await be(ELEE);
const eLee = (await db.query(`select * from survival_join($1,'Lee')`, [egame.code])).rows[0];

// Explicit: this whole section is about individual cooldowns, individual
// solve order and individual disqualification — four players default into
// two shared teams now that consensus is the default mode, and a team's
// shared cooldown turns "one player's wrong guess" into "everyone on their
// team is now blocked too," which crashes an unguarded call further down
// the moment two teammates try the keypad back to back.
await be(EHOST);
await db.query(`select survival_set_mode($1, 'solo')`, [egame.id]);

console.log('\n--- the sealed puzzle has no way in ---');
await be(ECARA);
check('a player cannot read survival_keys',
  !!(await refuses(`select * from survival_keys`)));
check('a player cannot call the generator',
  !!(await refuses(`select survival_generate_key($1)`, [egame.id])));
check('a player cannot read the sealed ruthless threshold',
  !!(await refuses(`select survival_ruthless_threshold()`)));
check('a player cannot ask someone else\'s ruthless marks directly',
  !!(await refuses(`select survival_ruthless_marks($1,$2)`, [egame.id, eDev.id])));
check('nor whether they are disqualified',
  !!(await refuses(`select survival_disqualified($1,$2)`, [egame.id, eDev.id])));
check('a player cannot read the contenders view directly',
  !!(await refuses(`select * from survival_contenders($1)`, [egame.id])));
check('survival_seats refuses before the result',
  !!(await refuses(`select * from survival_seats($1)`, [egame.id])));
check('survival_key_reveal refuses before the result',
  !!(await refuses(`select * from survival_key_reveal($1)`, [egame.id])));
check('survival_ruthless refuses before the result',
  !!(await refuses(`select * from survival_ruthless($1)`, [egame.id])));
check('nobody can insert an escape directly',
  !!(await refuses(`insert into survival_escapes (game_id, player_id, solve_order) values ($1,$2,1)`,
    [egame.id, eCara.id])));

console.log('\n--- the code is genuinely derivable from the clues, and different every game ---');
await db.exec('reset role;');
const key = (await db.query(`select * from survival_keys where game_id=$1`, [egame.id])).rows[0];
const digits = Object.fromEntries((await db.query(
  `select question_idx, digit from survival_clue_digits where game_id=$1`, [egame.id])).rows
  .map((r) => [r.question_idx, r.digit]));
check('exactly seven rounds carry a digit', Object.keys(digits).length === 7,
  Object.keys(digits).sort((a, b) => a - b).join(','));
const recomputed = `${digits[3]}${digits[8]}${digits[5]}${digits[1]}`;
check('the code is the green berths, read from the last back to the first',
  recomputed === key.code, `${recomputed} vs ${key.code}`);

const otherCodes = new Set();
for (let i = 0; i < 8; i += 1) {
  const g = (await db.query(`select * from survival_create('Ref')`)).rows[0];
  otherCodes.add((await db.query(`select code from survival_keys where game_id=$1`, [g.id])).rows[0].code);
}
check('every game gets its own code', otherCodes.size >= 7, `${otherCodes.size} distinct of 8`);

console.log('\n--- clues are ephemeral, gone the instant the host advances ---');
await be(EHOST);
await db.query(`select survival_advance($1)`, [egame.id]); // briefing
await db.query(`select survival_advance($1)`, [egame.id]); // running, first warm-up
for (let i = 0; i < 2; i += 1) {
  await db.query(`select survival_reveal($1)`, [egame.id]);
  await db.query(`select survival_advance($1)`, [egame.id]);
} // now at question 0 — carries no clue (Q0 is a decoy round, still delivers a digit)

await be(ECARA);
let currentClue = (await db.query(
  `select * from survival_clue_digits where game_id=$1`, [egame.id])).rows;
check('question 0 (a decoy round) still delivers its one digit', currentClue.length === 1 &&
  currentClue[0].question_idx === 0);

await be(EHOST);
await db.query(`select survival_reveal($1)`, [egame.id]);
await db.query(`select survival_advance($1)`, [egame.id]); // → question 1

await be(ECARA);
currentClue = (await db.query(`select * from survival_clue_digits where game_id=$1`, [egame.id])).rows;
check("once the host moves on, the previous round's digit is gone from view",
  !currentClue.some((r) => r.question_idx === 0));
// Question 1 (The Feuding Neighbour) is a GREEN berth — this is the exact
// case the green-seal migration exists for. It carries a clue, the round is
// current, and it must still deliver nothing: a green round's digit is
// never read from this table by anyone, seer or not. Only the Exchange
// (survival_fragments / survival_posts) may ever produce it.
check("a green round's digit is never delivered here, current or not",
  currentClue.length === 0, JSON.stringify(currentClue));

console.log('\n--- a wrong guess is recorded, never leaks, and never locks anyone out ---');
const wrong = (await db.query(`select * from survival_escape($1,'0000')`, [egame.id])).rows[0];
check('a wrong guess is refused', wrong.correct === false);
check('it carries a retry countdown, not a lockout', wrong.retry_in_seconds > 0);
let cooling = null;
try {
  await db.query(`select * from survival_escape($1,'1111')`, [egame.id]);
} catch (e) { cooling = e.message; }
check('trying again inside the cooldown is refused', !!cooling, (cooling ?? '').split('\n')[0]);

await be(EDEV);
const devProgress = (await db.query(`select * from survival_progress($1)`, [egame.id])).rows[0];
check('one player\'s cooldown never touches another\'s', devProgress.retry_in_seconds === 0);

await be(EHOST);
await db.exec('reset role;');
await db.query(
  `update survival_attempts set created_at = now() - interval '1 hour' where game_id=$1`, [egame.id]);
await be(ECARA);
const stillWrong = (await db.query(`select * from survival_escape($1,'0000')`, [egame.id])).rows[0];
check('after the cooldown elapses, trying again is allowed', stillWrong.correct === false);

console.log('\n--- the race: solve order matches submission order, for every viewer ---');
const realCode = key.code;
await be(EDEV);
const devSolve = (await db.query(`select * from survival_escape($1,$2)`, [egame.id, realCode])).rows[0];
check('a correct code is accepted', devSolve.correct === true && devSolve.solve_order === 1);
await be(ELEE);
const leeSolve = (await db.query(`select * from survival_escape($1,$2)`, [egame.id, realCode])).rows[0];
check('the second solver gets the next order', leeSolve.correct === true && leeSolve.solve_order === 2);

for (const uid of [EDEV, ELEE, ECARA]) {
  await be(uid);
  const order = (await db.query(`select * from survival_progress($1)`, [egame.id])).rows[0].escaped;
  check(`escaped order agrees for every viewer (${uid.slice(0, 4)})`,
    JSON.stringify(order) === JSON.stringify([eDev.id, eLee.id]));
}

await be(EDEV);
check('an already-escaped player cannot submit again',
  !!(await refuses(`select * from survival_escape($1,$2)`, [egame.id, realCode])));

console.log('\n--- disqualification skips a seat, on both paths ---');
// Cara solves too, wrong-order deliberately (third), and is made ruthless
// directly — this is the headline scenario: solved first among the
// remaining two, refused anyway, the seat passes on. Clear her cooldown
// again first — her own earlier wrong guesses (above) are still fresh.
await db.exec('reset role;');
await db.query(
  `update survival_attempts set created_at = now() - interval '1 hour' where game_id=$1`, [egame.id]);
await be(ECARA);
const caraSolve = (await db.query(`select * from survival_escape($1,$2)`, [egame.id, realCode])).rows[0];
check('a third solver gets order 3', caraSolve.correct === true && caraSolve.solve_order === 3);

await db.exec('reset role;');
await db.query(`update survival_options set ruthless = true where question_idx = 0 and option_index = 1`);
await db.query(
  `insert into survival_answers (game_id, player_id, question_idx, option_index, auto_assigned)
   values ($1,$2,0,1,false)
   on conflict (game_id, player_id, question_idx) do update set option_index = 1, auto_assigned = false`,
  [egame.id, eCara.id]);
for (const q of [1, 2, 3, 4]) {
  await db.query(
    `insert into survival_answers (game_id, player_id, question_idx, option_index, auto_assigned)
     values ($1,$2,$3,0,false)
     on conflict (game_id, player_id, question_idx) do update set option_index = 0, auto_assigned = false`,
    [egame.id, eCara.id, q]);
}
await db.query(`update survival_options set ruthless = true where question_idx in (1,2,3,4) and option_index = 0`);

await be(EHOST);
// Question 1 is the current round and is still unrevealed (the race tests
// above only advanced into it) — reveal it first, then advance/reveal the rest.
await db.query(`select survival_reveal($1)`, [egame.id]);
for (let q = 2; q <= 8; q += 1) {
  await db.query(`select survival_advance($1)`, [egame.id]);
  await db.query(`select survival_reveal($1)`, [egame.id]);
}
await db.query(`select survival_advance($1)`, [egame.id]); // → plea
await db.query(`select survival_advance($1)`, [egame.id]); // → tribunal

await be(EDEV);
const votedForEscapee = await refuses(`select survival_vote($1,$2)`, [egame.id, eLee.id]);
check('voting for an already-escaped player is refused', !!votedForEscapee,
  (votedForEscapee ?? '').split('\n')[0]);

check('survival_ruthless still refuses mid-tribunal, not just before it',
  !!(await refuses(`select * from survival_ruthless($1)`, [egame.id])));

// Hana (the host) is made ruthless too, but never escapes — this is the
// vote-path headline scenario: the room votes her the most seats and only
// learns she was refused when the seats are actually decided.
await db.exec('reset role;');
const eHost = (await db.query(
  `select id from survival_players where game_id=$1 and user_id=$2`, [egame.id, EHOST])).rows[0];
await db.query(
  `insert into survival_answers (game_id, player_id, question_idx, option_index, auto_assigned)
   values ($1,$2,0,1,false)
   on conflict (game_id, player_id, question_idx) do update set option_index = 1, auto_assigned = false`,
  [egame.id, eHost.id]);
for (const q of [1, 2, 3, 4]) {
  await db.query(
    `insert into survival_answers (game_id, player_id, question_idx, option_index, auto_assigned)
     values ($1,$2,$3,0,false)
     on conflict (game_id, player_id, question_idx) do update set option_index = 0, auto_assigned = false`,
    [egame.id, eHost.id, q]);
}

await be(EDEV);
const votedForRuthlessHost = await refuses(`select survival_vote($1,$2)`, [egame.id, eHost.id]);
check('a vote for a disqualified-but-not-escaped player is accepted, not refused',
  !votedForRuthlessHost, votedForRuthlessHost ?? '(accepted)');
await be(ELEE);
await db.query(`select survival_vote($1,$2)`, [egame.id, eHost.id]);

await be(EHOST);
await db.query(`select survival_advance($1)`, [egame.id]); // → result

await be(ELEE);
const ruthless = (await db.query(`select * from survival_ruthless($1)`, [egame.id])).rows;
const caraRow = ruthless.find((r) => r.player_id === eCara.id);
check('Cara is flagged disqualified', caraRow?.disqualified === true, `${caraRow?.marks} marks`);
const hostRow = ruthless.find((r) => r.player_id === eHost.id);
check('Hana (the host) is flagged disqualified too', hostRow?.disqualified === true, `${hostRow?.marks} marks`);

const seats = (await db.query(`select * from survival_seats($1)`, [egame.id])).rows;
check('the disqualified first-among-remaining solver holds no seat',
  !seats.some((s) => s.player_id === eCara.id));
check('the disqualified vote leader holds no seat either, despite the votes she got',
  !seats.some((s) => s.player_id === eHost.id));
check('the seats that were earnable went to eligible people',
  seats.every((s) => s.player_id === eDev.id || s.player_id === eLee.id || s.path === 'vote'));

// ── the three paths, and a chopper sized for the room ────────────────────
// Both backends have to agree on this table or a silent player is seated
// differently in local play than in production. src/survival/scale.test.ts
// asserts the same numbers against seatsFor().
const seatTable = [[5, 3], [6, 3], [8, 3], [12, 3], [16, 4], [20, 5], [24, 6], [3, 1], [4, 2], [0, 0]];
for (const [players, expected] of seatTable) {
  const got = (await db.query(`select survival_seats_for($1) as n`, [players])).rows[0].n;
  check(`survival_seats_for(${players}) is ${expected}, as seatsFor says`, got === expected, `got ${got}`);
}

check('no path claims the whole chopper on its own',
  new Set(seats.map((s) => s.path)).size > 1 || seats.length <= 1,
  seats.map((s) => `${s.name}:${s.path}`).join(', '));
check('every seat names one of the three paths',
  seats.every((s) => ['escape', 'record', 'vote'].includes(s.path)),
  seats.map((s) => s.path).join(', '));
check('the room never seats more people than it has seats for',
  seats.filter((s) => !s.contested).length <= (await db.query(
    `select survival_seat_count($1) as n`, [egame.id])).rows[0].n,
  JSON.stringify(seats.map((s) => [s.name, s.seat, s.path, s.contested])));

const keyReveal = (await db.query(`select * from survival_key_reveal($1)`, [egame.id])).rows[0];
check('the code is only ever readable at result, and matches the derived one',
  keyReveal.code === key.code);

console.log('\n--- silence never earns a mark, structurally ---');
// In the ORIGINAL playthrough (sgame) Cara alone ever answered anything for
// real — question 0, deliberately, with the one dark option there — so her
// single genuine mark is correct and expected. Dev, Hana and Lee never
// answered a single real question; every one of their answers was
// auto-assigned, including onto dark options on other questions, and none
// of it should count.
await be(SHOST);
const quietRuthless = (await db.query(`select * from survival_ruthless($1)`, [sgame.id])).rows;
const silentOnes = quietRuthless.filter((r) => r.name !== 'Cara');
check('Cara\'s one deliberate dark pick correctly earns exactly one mark',
  quietRuthless.find((r) => r.name === 'Cara')?.marks === 1);
check('every player who never answered for real has zero marks, though some auto-picks were dark',
  silentOnes.length === 3 && silentOnes.every((r) => r.marks === 0 && r.disqualified === false),
  quietRuthless.map((r) => `${r.name}:${r.marks}`).join(' '));

console.log('\n--- warm-ups structurally cannot carry a clue or a ruthless flag ---');
await db.exec('reset role;');
check('no clue digit exists for a negative question_idx',
  (await db.query(`select 1 from survival_clue_digits where question_idx < 0`)).rows.length === 0);
check('no sealed option row exists for a negative question_idx',
  (await db.query(`select 1 from survival_options where question_idx < 0`)).rows.length === 0);

console.log('\n--- nothing new leaks through the existing narrow RPCs ---');
await be(CARA);
const rd = (await db.query(`select * from survival_reveal_data($1, 0)`, [sgame.id])).rows[0];
check('survival_reveal_data still carries no percentage or ruthless flag',
  !Object.keys(rd).some((k) => /pct|ruth|dark|glyph|mark|digit/i.test(k)),
  Object.keys(rd).join(','));

console.log('\n--- and nothing of this travels over realtime ---');
await db.exec('reset role;');
const published = (await db.query(
  `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`
)).rows.map((r) => r.tablename);
check('the lobby is published', published.includes('survival_games') &&
  published.includes('survival_players'));
check('answers, scores, pleas, votes, clues, keys, attempts and escapes are not',
  ![
    'survival_answers', 'survival_scores', 'survival_pleas', 'survival_votes',
    'survival_clue_digits', 'survival_keys', 'survival_attempts', 'survival_escapes',
  ].some((t) => published.includes(t)),
  published.filter((t) => t.startsWith('survival')).join(', '));

console.log('\n--- a broad audit: every internal-only helper is still revoked from PUBLIC ---');
// Not every survival_* function is revoked from PUBLIC — the player-facing
// actions (survival_answer, survival_vote, survival_join, ...) rely on the
// ordinary `grant execute ... to authenticated` this schema has always used
// for them, same as the base game. This audit is specifically about the
// functions that would leak the seal, or the puzzle, if called directly —
// the ones this feature's migrations (and the ones before it) explicitly
// `revoke all ... from public` right after creating.
const INTERNAL_ONLY = [
  'survival_worst_option', 'survival_assign', 'survival_odds', 'survival_odds_precise',
  'survival_generate_key', 'survival_ruthless_threshold', 'survival_ruthless_marks',
  'survival_disqualified', 'survival_contenders', 'survival_assign_teams',
];
const funcs = (await db.query(
  `select p.proname,
          has_function_privilege('public', p.oid, 'EXECUTE') as pub_x
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'survival\\_%'`
)).rows;
const leaky = funcs.filter((f) => INTERNAL_ONLY.includes(f.proname) && f.pub_x);
check('none of the internal-only helpers are executable by PUBLIC', leaky.length === 0,
  leaky.map((f) => f.proname).join(', '));
check('every internal-only helper this audit expects actually exists',
  INTERNAL_ONLY.every((name) => funcs.some((f) => f.proname === name)),
  INTERNAL_ONLY.filter((name) => !funcs.some((f) => f.proname === name)).join(', '));

const tableGrants = (await db.query(
  `select table_name, privilege_type
     from information_schema.role_table_grants
    where grantee = 'authenticated' and table_name like 'survival\\_%'`
)).rows;
check('the sealed tables (options, keys) grant nothing to authenticated',
  !tableGrants.some((g) => ['survival_options', 'survival_keys'].includes(g.table_name)),
  tableGrants.filter((g) => ['survival_options', 'survival_keys'].includes(g.table_name))
    .map((g) => `${g.table_name}:${g.privilege_type}`).join(', '));
check('no survival table is writable by authenticated at all',
  !tableGrants.some((g) => ['INSERT', 'UPDATE', 'DELETE'].includes(g.privilege_type)),
  tableGrants.filter((g) => ['INSERT', 'UPDATE', 'DELETE'].includes(g.privilege_type))
    .map((g) => `${g.table_name}:${g.privilege_type}`).join(', '));

console.log('\n=== the ruthless cutoff is a lobby-only, host-only switch ===');

const RHOST = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const RCARA = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';

await be(RHOST);
const rgame = (await db.query(`select * from survival_create('R-Host')`)).rows[0];
await be(RCARA);
const rCara = (await db.query(`select * from survival_join($1,'R-Cara')`, [rgame.code])).rows[0];

check('ruthless_enabled defaults to true, same as the mechanic always has been',
  (await db.query(`select ruthless_enabled from survival_games where id=$1`, [rgame.id])).rows[0].ruthless_enabled === true);

check('only the host may switch it',
  !!(await refuses(`select survival_set_ruthless_enabled($1,false)`, [rgame.id])));

await be(RHOST);
// Solo, to keep this section about one player's own marks rather than a
// team's shared ones — the toggle itself does not care which mode is on.
await db.query(`select survival_set_mode($1,'solo')`, [rgame.id]);
await db.query(`select survival_set_ruthless_enabled($1,false)`, [rgame.id]);
check('the toggle took',
  (await db.query(`select ruthless_enabled from survival_games where id=$1`, [rgame.id])).rows[0].ruthless_enabled === false);

await db.query(`select survival_advance($1)`, [rgame.id]); // briefing
check('too late to change the cutoff once the briefing has started',
  !!(await refuses(`select survival_set_ruthless_enabled($1,true)`, [rgame.id])));

await db.query(`select survival_advance($1)`, [rgame.id]); // running — first warm-up
for (let i = 0; i < 2; i += 1) {
  await db.query(`select survival_reveal($1)`, [rgame.id]);
  await db.query(`select survival_advance($1)`, [rgame.id]);
} // → question 0

// Cara picks five dark options directly — the same shortcut the
// ruthlessness-trap section above takes, and the same rows it already
// marked dark, so this reuses rather than redefines what "dark" means here.
await db.exec('reset role;');
await db.query(`update survival_options set ruthless = true where question_idx = 0 and option_index = 1`);
await db.query(
  `insert into survival_answers (game_id, player_id, question_idx, option_index, auto_assigned)
   values ($1,$2,0,1,false)
   on conflict (game_id, player_id, question_idx) do update set option_index = 1, auto_assigned = false`,
  [rgame.id, rCara.id]);
await db.query(`update survival_options set ruthless = true where question_idx in (1,2,3,4) and option_index = 0`);
for (const q of [1, 2, 3, 4]) {
  await db.query(
    `insert into survival_answers (game_id, player_id, question_idx, option_index, auto_assigned)
     values ($1,$2,$3,0,false)
     on conflict (game_id, player_id, question_idx) do update set option_index = 0, auto_assigned = false`,
    [rgame.id, rCara.id, q]);
}

await be(RHOST);
for (let q = 0; q <= 8; q += 1) {
  await db.query(`select survival_reveal($1)`, [rgame.id]);
  if (q < 8) await db.query(`select survival_advance($1)`, [rgame.id]);
}
await db.query(`select survival_advance($1)`, [rgame.id]); // → plea
await db.query(`select survival_advance($1)`, [rgame.id]); // → tribunal
await db.query(`select survival_advance($1)`, [rgame.id]); // → result

const rRuthless = (await db.query(`select * from survival_ruthless($1)`, [rgame.id])).rows;
const rCaraRow = rRuthless.find((r) => r.player_id === rCara.id);
check('the real tally still shows — turning the cutoff off never hides a mark',
  rCaraRow?.marks >= 5, rCaraRow?.marks);
check('but with the cutoff off, that tally costs nobody a seat',
  rCaraRow?.disqualified === false);

console.log('\n=== consensus mode: teams draw once, and a tap fans out to the whole team ===');

const THOST = '50505050-5050-5050-5050-505050505050';
const TCARA = '60606060-6060-6060-6060-606060606060';
const TDEV = '70707070-7070-7070-7070-707070707070';
const TLEE = '80808080-8080-8080-8080-808080808080';
const TGIA = '90909090-9090-9090-9090-909090909090';

await be(THOST);
const tgame = (await db.query(`select * from survival_create('T-Host')`)).rows[0];
for (const [uid, name] of [[TCARA, 'T-Cara'], [TDEV, 'T-Dev'], [TLEE, 'T-Lee'], [TGIA, 'T-Gia']]) {
  await be(uid);
  await db.query(`select survival_join($1,$2)`, [tgame.code, name]);
}

await be(TCARA);
check('only the host may set the mode',
  !!(await refuses(`select survival_set_mode($1,'consensus')`, [tgame.id])));

await be(THOST);
check('a bogus mode is refused',
  !!(await refuses(`select survival_set_mode($1,'chaos')`, [tgame.id])));
await db.query(`select survival_set_mode($1,'consensus')`, [tgame.id]);

await db.query(`select survival_advance($1)`, [tgame.id]); // briefing — teams are drawn here

const members = (await db.query(
  `select team_no, count(*)::int as n from survival_team_members
    where game_id = $1 group by team_no order by team_no`, [tgame.id],
)).rows;
check('five players draw a team of two and a team of three, nobody standing alone',
  members.map((r) => r.n).sort().join(',') === '2,3',
  members.map((r) => `team ${r.team_no}: ${r.n}`).join(', '));

// Five players is the one headcount where the old "fixed pairs" formula and
// teamsFor happen to agree (both give a team of 2 and a team of 3), so the
// check above cannot by itself prove teamsFor is what actually ran. Eight
// players is where they first diverge: fixed pairs gives four teams of two,
// teamsFor(8) gives two teams of four — the whole reason teams exist here.
await db.exec('reset role;');
const eightUid = (n) => `8${String(n).padStart(7, '0')}-8787-8787-8787-${String(n).padStart(12, '0')}`;
await be(eightUid(0));
const eightGame = (await db.query(`select * from survival_create('E-Host')`)).rows[0];
for (let i = 1; i < 8; i += 1) {
  await be(eightUid(i));
  await db.query(`select survival_join($1,$2)`, [eightGame.code, `E-P${i}`]);
}
await be(eightUid(0));
await db.query(`select survival_set_mode($1,'consensus')`, [eightGame.id]);
await db.query(`select survival_advance($1)`, [eightGame.id]); // briefing — teams drawn here
const eightMembers = (await db.query(
  `select team_no, count(*)::int as n from survival_team_members
    where game_id = $1 group by team_no order by team_no`, [eightGame.id],
)).rows;
check('eight players draw two teams of four, not four teams of two',
  eightMembers.length === 2 && eightMembers.every((r) => r.n === 4),
  eightMembers.map((r) => `team ${r.team_no}: ${r.n}`).join(', '));

// Restore the THOST context this section was already running under —
// the eight-player detour above ends on its own last-joined player.
await be(THOST);

check('too late to change the mode once the briefing has started',
  !!(await refuses(`select survival_set_mode($1,'solo')`, [tgame.id])));

await db.query(`select survival_advance($1)`, [tgame.id]); // running — first warm-up

const pair = members.find((r) => r.n === 2).team_no;
const pairRows = (await db.query(
  `select t.player_id, p.user_id from survival_team_members t
     join survival_players p on p.id = t.player_id
    where t.game_id = $1 and t.team_no = $2`,
  [tgame.id, pair],
)).rows;

await be(pairRows[0].user_id);
await db.query(`select survival_answer($1, 2)`, [tgame.id]);

await be(pairRows[1].user_id);
const teammatesAnswer = (await db.query(
  `select option_index from survival_answers
    where game_id = $1 and player_id = $2 and question_idx = -2`, [tgame.id, pairRows[1].player_id],
)).rows[0];
check("the teammate's tap is already on my own row, though I never tapped",
  teammatesAnswer?.option_index === 2, JSON.stringify(teammatesAnswer));
check('and a second tap for the team is refused, exactly like a solo second tap',
  !!(await refuses(`select survival_answer($1, 3)`, [tgame.id])));

console.log('\n--- consensus mode: the clue splits, and the keypad is shared ---');

await be(THOST);
await db.query(`select survival_reveal($1)`, [tgame.id]); // close warm-up 1
await db.query(`select survival_advance($1)`, [tgame.id]); // warm-up 2
await db.query(`select survival_reveal($1)`, [tgame.id]);
await db.query(`select survival_advance($1)`, [tgame.id]); // question 0 — a clued round

await be(pairRows[0].user_id);
const seer0 = (await db.query(`select * from survival_clue_digits where game_id=$1`, [tgame.id])).rows;
const askedBy0 = (await db.query(`select public.survival_current_clue_seer($1) as n`, [tgame.id])).rows[0].n;

await be(pairRows[1].user_id);
const seer1 = (await db.query(`select * from survival_clue_digits where game_id=$1`, [tgame.id])).rows;
const askedBy1 = (await db.query(`select public.survival_current_clue_seer($1) as n`, [tgame.id])).rows[0].n;

check('exactly one of the two teammates sees this round\'s digit, not both',
  seer0.length + seer1.length === 1,
  `saw: ${seer0.length} and ${seer1.length}`);
check("the one who can't see it is told who on their team to ask instead",
  (seer0.length === 1 && askedBy0 === null && askedBy1 !== null)
  || (seer1.length === 1 && askedBy1 === null && askedBy0 !== null),
  `askedBy0=${askedBy0} askedBy1=${askedBy1}`);

await be(THOST);
await db.query(`select survival_reveal($1)`, [tgame.id]);
await db.query(`select survival_advance($1)`, [tgame.id]); // question 1

await be(pairRows[0].user_id);
await db.query(`select survival_answer($1, 1)`, [tgame.id]);

// A wrong guess by one teammate starts the cooldown for BOTH of them — same
// shared keypad, not two independent ones.
const wrong1 = (await db.query(`select * from survival_escape($1, '0000')`, [tgame.id])).rows[0];
check('a wrong guess is rejected', wrong1.correct === false, JSON.stringify(wrong1));

await be(pairRows[1].user_id);
check("the teammate's cooldown is already running too, though they never guessed",
  !!(await refuses(`select * from survival_escape($1, '1111')`, [tgame.id])));

// Fast-forward past the cooldown and hand both teammates the real code.
await db.exec('reset role;');
await db.query(`update survival_attempts set created_at = now() - interval '10 seconds' where game_id = $1`, [tgame.id]);
const teamCode = (await db.query(`select code from survival_keys where game_id = $1`, [tgame.id])).rows[0].code;

await be(pairRows[1].user_id);
const solved = (await db.query(`select * from survival_escape($1, $2)`, [tgame.id, teamCode])).rows[0];
check('the correct code is accepted', solved.correct === true, JSON.stringify(solved));

// The team solved it together — shared clues, one keypad, and the cooldown
// above was started by the OTHER member's wrong guess. But the seat belongs
// to whoever states the code: an escape path that seats whole teams takes
// every seat the room is playing for, which is what left the nine moral
// rounds and the tribunal deciding nothing.
const escapedRows = (await db.query(
  `select player_id, solve_order from survival_escapes where game_id = $1`, [tgame.id],
)).rows;
check('cracking it seats whoever stated the code, not their whole team',
  escapedRows.length === 1 && escapedRows[0].player_id === pairRows[1].player_id,
  JSON.stringify(escapedRows));
check("the teammate who did not type it keeps the record and the vote instead",
  !escapedRows.some((r) => r.player_id === pairRows[0].player_id),
  JSON.stringify(escapedRows));

console.log('\n=== the berth puzzles: one answer, and no team able to reach it alone ===');
// The SQL generator is NOT a mirror of src/survival/puzzles.ts and is not
// meant to be: a puzzle is per-game random, exactly like the extraction
// digits, so each backend makes up its own. What the two must share is the
// PROPERTIES, so the same ones puzzles.test.ts asserts over seeds are
// asserted here over a real generated game.
const satisfies = (rule, line) => {
  switch (rule.kind) {
    case 'sealParity': return (line.seal % 2 === 0) === rule.even;
    case 'berthIs': return line.line_berth === rule.berth;
    case 'berthIsNot': return line.line_berth !== rule.berth;
    case 'signedBefore': return line.signed_at < rule.minutes;
    case 'signedAfter': return line.signed_at > rule.minutes;
    case 'signerIs': return line.signer === rule.signer;
    default: throw new Error('unknown rule kind: ' + rule.kind);
  }
};

await db.exec('reset role;');
const greens = (await db.query(`select * from survival_green_berths()`)).rows;
const tRoster = (await db.query(
  `select count(*)::int as n from survival_players where game_id = $1`, [tgame.id],
)).rows[0].n;
check('four green berths carry a puzzle', greens.length === 4, JSON.stringify(greens));

for (const green of greens) {
  const lines = (await db.query(
    `select berth, line_id, line_berth, seal, signed_at, signer from survival_berth_lines
      where game_id = $1 and berth = $2 order by line_id`, [tgame.id, green.berth],
  )).rows;
  const frags = (await db.query(
    `select player_id, rule from survival_fragments where game_id = $1 and berth = $2`,
    [tgame.id, green.berth],
  )).rows;
  const digit = (await db.query(
    `select digit from survival_clue_digits where game_id = $1 and question_idx = $2`,
    [tgame.id, green.question_idx],
  )).rows[0]?.digit;

  check(`berth ${green.berth} puts five lines on the board`, lines.length === 5, `${lines.length}`);
  check(`berth ${green.berth} deals a fragment to every player`,
    frags.length === tRoster, `${frags.length} of ${tRoster}`);

  const all = frags.map((f) => f.rule);
  const left = lines.filter((l) => all.every((r) => satisfies(r, l)));
  check(`berth ${green.berth} has exactly one surviving line`, left.length === 1,
    JSON.stringify(left.map((l) => l.line_id)));
  check(`berth ${green.berth}'s surviving line carries that round's digit`,
    left.length === 1 && left[0].seal === digit, `${left[0]?.seal} vs ${digit}`);

  // No decoy may share the answer's seal, or a wrong line gives a right digit.
  check(`berth ${green.berth} never lets a wrong line carry the right digit`,
    lines.filter((l) => l.seal === digit).length === 1,
    JSON.stringify(lines.map((l) => l.seal)));

  // The load-bearing one.
  const teamsOf = (await db.query(
    `select team_no, array_agg(player_id) as ids from survival_team_members
      where game_id = $1 group by team_no`, [tgame.id],
  )).rows;
  for (const team of teamsOf) {
    const held = frags.filter((f) => team.ids.includes(f.player_id)).map((f) => f.rule);
    const narrowed = lines.filter((l) => held.every((r) => satisfies(r, l)));
    check(`berth ${green.berth} cannot be solved by team ${team.team_no} alone`,
      narrowed.length > 1, `${narrowed.length} line(s) left`);
  }

  // And no single fragment may be indispensable — one quiet player must not
  // be able to strand the room.
  const spare = frags.filter((_, i) => {
    const without = all.filter((_, j) => j !== i);
    return lines.filter((l) => without.every((r) => satisfies(r, l))).length === 1;
  });
  check(`berth ${green.berth} survives somebody staying quiet`, spare.length > 0,
    `${spare.length} of ${frags.length} fragments are droppable`);
}

check('the answer does not sit in the same slot on every board',
  new Set(
    (await db.query(`select answer_line_id from survival_berth_answers where game_id = $1`,
      [tgame.id])).rows.map((r) => r.answer_line_id),
  ).size > 1,
  'four berths all answering to the same line id means the shuffle is not shuffling');

// The answer itself is behind two shut gates, exactly like survival_options.
await be(pairRows[0].user_id);
check('a player cannot read the puzzle answers',
  !!(await refuses(`select * from survival_berth_answers where game_id = $1`, [tgame.id])));
check("a player cannot read another player's fragment",
  (await db.query(
    `select count(*)::int as n from survival_fragments where game_id = $1`, [tgame.id],
  )).rows[0].n === greens.length,
  'RLS should leave exactly one fragment per berth visible');
await db.exec('reset role;');

console.log('\n=== a late joiner folds into a team and is dealt a spare fragment ===');
// Real gap this closes: a player arriving after teams and puzzles are
// already dealt used to stay teamless and hold nothing for any berth — a
// team of one for every puzzle in the room, exactly the single point of
// failure noTeamSolves exists to rule out.
const TLATE = 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0';
await be(TLATE);
const late = (await db.query(`select * from survival_join($1, 'T-Late')`, [tgame.code])).rows[0];

await db.exec('reset role;');
const lateTeam = (await db.query(
  `select team_no from survival_team_members where game_id = $1 and player_id = $2`,
  [tgame.id, late.id],
)).rows[0]?.team_no;
check('a late joiner is folded into a team, not left teamless', lateTeam != null);

const teamSizesNow = (await db.query(
  `select team_no, count(*)::int as n from survival_team_members
    where game_id = $1 group by team_no order by team_no`, [tgame.id],
)).rows;
check('she landed on whichever team was smallest at the time',
  lateTeam === teamSizesNow.reduce((a, b) => (b.n < a.n ? b : a)).team_no
  || teamSizesNow.filter((t) => t.n === Math.min(...teamSizesNow.map((x) => x.n))).some((t) => t.team_no === lateTeam),
  JSON.stringify({ lateTeam, teamSizesNow }));

const lateFrags = (await db.query(
  `select berth from survival_fragments where game_id = $1 and player_id = $2`, [tgame.id, late.id],
)).rows;
check('she was dealt a fragment for every berth already open',
  lateFrags.length === greens.length, `${lateFrags.length} of ${greens.length}`);

await db.exec('reset role;');
const herOwnFrags = (await db.query(
  `select berth, rule from survival_fragments where game_id = $1 and player_id = $2`, [tgame.id, late.id],
)).rows;
let allSpare = true;
for (const f of herOwnFrags) {
  const berthLines = (await db.query(
    `select seal, signed_at, line_berth from survival_berth_lines where game_id = $1 and berth = $2`,
    [tgame.id, f.berth],
  )).rows;
  const satisfiesAll = berthLines.every((l) => satisfies(
    { kind: f.rule.kind, minutes: f.rule.minutes, berth: f.rule.berth, even: f.rule.even, signer: f.rule.signer },
    { seal: l.seal, signed_at: l.signed_at, line_berth: l.line_berth },
  ));
  if (!satisfiesAll) allSpare = false;
}
check("her fragment for every berth is a spare rule — true of every line on that board, not a key one",
  allSpare, JSON.stringify(herOwnFrags));
await db.exec('reset role;');

console.log('\n=== re-applying over a database that already has a game in it ===');
// This is the real situation on the hosted project: 0001 and 0002 were
// applied by hand, so `supabase db push` finds an empty migration table and
// runs all three against live data. Re-running on an empty schema proves
// much less than re-running on top of rows.
await db.exec('reset role;');
for (const file of files) {
  try {
    await db.exec(load(file));
    check(`${file} re-applies over live data`, true);
  } catch (err) {
    check(`${file} re-applies over live data`, false, String(err.message).split('\n')[0]);
  }
}
const kept = await db.query(
  'select (select count(*) from submissions) as subs, (select count(*) from votes) as votes,'
  + ' (select count(*) from players where score > 0) as scored,'
  + ' (select count(*) from survival_escapes) as escapes,'
  + ' (select count(*) from survival_attempts) as attempts',
);
check('the game survives the re-apply intact',
  Number(kept.rows[0].subs) > 0 && Number(kept.rows[0].scored) > 0,
  JSON.stringify(kept.rows[0]));
check('the extraction race survives the re-apply too',
  Number(kept.rows[0].escapes) > 0 && Number(kept.rows[0].attempts) > 0,
  JSON.stringify(kept.rows[0]));

console.log('\n--- a player still cannot drive the game ---');
await be(BEN);
let denied = null;
try { await db.query(`select set_phase($1,'awards',3)`, [game.id]); } catch (e) { denied = e.message; }
check('non-host set_phase is refused', !!denied, (denied ?? '').split('\n')[0]);

console.log(`\n${'='.repeat(60)}\n  ${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log(`    FAILED: ${f}`);
process.exit(fail.length ? 1 : 0);
