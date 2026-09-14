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

console.log('\n--- the sealed table has no way in ---');
await be(CARA);
check('a player cannot read survival_options',
  !!(await refuses(`select * from survival_options`)));
check('a player cannot ask which move is worst',
  !!(await refuses(`select survival_worst_option(0)`)));
check('a player cannot write an answer directly',
  !!(await refuses(`select survival_assign($1,$2,0,1,false)`, [sgame.id, pCara.id])));

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
for (let q = 1; q <= 6; q += 1) {
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
  gaps.length === 4 && gaps.every((r) => r.n === 7),
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

console.log('\n--- and nothing of this travels over realtime ---');
await db.exec('reset role;');
const published = (await db.query(
  `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`
)).rows.map((r) => r.tablename);
check('the lobby is published', published.includes('survival_games') &&
  published.includes('survival_players'));
check('answers, scores, pleas and votes are not',
  !['survival_answers', 'survival_scores', 'survival_pleas', 'survival_votes']
    .some((t) => published.includes(t)),
  published.filter((t) => t.startsWith('survival')).join(', '));

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
  + ' (select count(*) from players where score > 0) as scored',
);
check('the game survives the re-apply intact',
  Number(kept.rows[0].subs) > 0 && Number(kept.rows[0].scored) > 0,
  JSON.stringify(kept.rows[0]));

console.log('\n--- a player still cannot drive the game ---');
await be(BEN);
let denied = null;
try { await db.query(`select set_phase($1,'awards',3)`, [game.id]); } catch (e) { denied = e.message; }
check('non-host set_phase is refused', !!denied, (denied ?? '').split('\n')[0]);

console.log(`\n${'='.repeat(60)}\n  ${pass} passed, ${fail.length} failed`);
for (const f of fail) console.log(`    FAILED: ${f}`);
process.exit(fail.length ? 1 : 0);
