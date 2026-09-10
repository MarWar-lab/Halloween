"""
End-to-end proof against the live Supabase project.

Plays a real all-play round with two separate anonymous users and asserts the
row-level security policies actually hold — that player B cannot read player A's
answer before the reveal, and cannot read A's vote before scoring.

If these assertions fail, the sealed-answer mechanic is a lie and the game's
central claim (the quiet half of the team can win without being watched) does
not hold. That is why this is a script and not a manual click-through.
"""

import json
import urllib.request
import urllib.error

import os
import pathlib


def _from_env_file():
    """Read .env.local so the project URL and key live in one place only."""
    env = pathlib.Path(__file__).resolve().parent.parent / ".env.local"
    values = {}
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                values[k.strip()] = v.strip()
    return values


_env = _from_env_file()
URL = os.environ.get("VITE_SUPABASE_URL") or _env.get("VITE_SUPABASE_URL", "")
ANON = os.environ.get("VITE_SUPABASE_ANON_KEY") or _env.get("VITE_SUPABASE_ANON_KEY", "")

if not URL or not ANON:
    raise SystemExit(
        "No Supabase credentials found. Fill in .env.local first — see docs/SETUP.md."
    )

passed, failed = [], []


def call(method, path, token=None, body=None):
    req = urllib.request.Request(f"{URL}{path}", method=method)
    req.add_header("apikey", ANON)
    req.add_header("Authorization", f"Bearer {token or ANON}")
    req.add_header("Content-Type", "application/json")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as e:
        return {"__error__": e.code, "body": e.read().decode()[:400]}


def check(label, condition, detail=""):
    (passed if condition else failed).append(label)
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{'  — ' + detail if detail else ''}")


def one(result):
    if isinstance(result, list):
        return result[0] if result else None
    return result


print("\n=== signing in two separate anonymous users ===")
a = call("POST", "/auth/v1/signup", body={})
b = call("POST", "/auth/v1/signup", body={})
tok_a, tok_b = a.get("access_token"), b.get("access_token")
check("two anonymous sessions", bool(tok_a and tok_b and tok_a != tok_b))

print("\n=== the schema is up to date ===")
# 0003 is what keeps answers anonymous. Without it the game still runs, and
# quietly tells every client who wrote what — so stop here rather than
# reporting a wall of confusing failures.
probe = call("POST", "/rest/v1/rpc/round_progress", tok_a,
             {"p_round": "00000000-0000-0000-0000-000000000000"})
if isinstance(probe, dict) and probe.get("__error__") in (404, 400):
    print("  FAIL  migration 0003 has not been applied")
    print("\n  Run supabase/migrations/0003_anonymity.sql in the Supabase SQL editor,")
    print("  then run this again. Until then, answers are NOT anonymous.")
    raise SystemExit(1)
check("migration 0003 is applied", True)

print("\n=== host creates a game ===")
game = one(call("POST", "/rest/v1/rpc/create_game",
                tok_a, {"p_deck": "halloween", "p_theme": "halloween"}))
check("create_game", bool(game and game.get("code")),
      f"code {game.get('code') if game else game}")
if not game or not game.get("code"):
    print("\nCannot continue.", json.dumps(game)[:400])
    raise SystemExit(1)

code, game_id = game["code"], game["id"]

look = {"body": 1, "topper": 1, "top": 1, "accessory": 0}
pa = one(call("POST", "/rest/v1/rpc/join_game", tok_a,
              {"p_code": code, "p_name": "Ana", "p_look": look}))
pb = one(call("POST", "/rest/v1/rpc/join_game", tok_b,
              {"p_code": code, "p_name": "Ben", "p_look": look}))
check("both players joined", bool(pa and pb and pa.get("id") != pb.get("id")))

print("\n=== a non-member cannot even see the game ===")
c = call("POST", "/auth/v1/signup", body={})
stranger = call("GET", f"/rest/v1/games?code=eq.{code}&select=id", c.get("access_token"))
check("stranger sees no game row", isinstance(stranger, list) and len(stranger) == 0,
      f"got {stranger}")

print("\n=== host opens an all-play round ===")
rnd = one(call("POST", "/rest/v1/rpc/start_round", tok_a, {
    "p_game": game_id, "p_card": "ghost-writer", "p_mechanic": "allplay",
    "p_lane": "say", "p_phase": "submitting", "p_secs": 180,
}))
check("start_round", bool(rnd and rnd.get("id")), f"phase {rnd.get('phase') if rnd else None}")
round_id = rnd["id"]
check("deadline is server-set", bool(rnd.get("deadline_at")), str(rnd.get("deadline_at")))

print("\n=== both submit ===")
call("POST", "/rest/v1/rpc/submit_answer", tok_a,
     {"p_round": round_id, "p_text": "ANA_SECRET_ANSWER"})
call("POST", "/rest/v1/rpc/submit_answer", tok_b,
     {"p_round": round_id, "p_text": "BEN_SECRET_ANSWER"})
mine = call("GET", f"/rest/v1/submissions?round_id=eq.{round_id}&select=text", tok_a)
check("submissions were stored", isinstance(mine, list) and len(mine) >= 1)

print("\n=== THE SEALING TEST — before the reveal ===")
seen_by_b = call("GET", f"/rest/v1/submissions?round_id=eq.{round_id}&select=text", tok_b)
texts = [s["text"] for s in seen_by_b] if isinstance(seen_by_b, list) else []
check("Ben sees exactly one submission (his own)", len(texts) == 1, f"saw {texts}")
check("Ben CANNOT read Ana's sealed answer", "ANA_SECRET_ANSWER" not in texts,
      "leaked!" if "ANA_SECRET_ANSWER" in texts else "sealed")

print("\n=== the host can see progress without seeing answers ===")
# The host has to know when everyone has finished writing, or the game cannot
# be run at all. Knowing *that* someone answered is not knowing *what*.
prog = one(call("POST", "/rest/v1/rpc/round_progress", tok_a, {"p_round": round_id}))
submitted = (prog or {}).get("submitted") or []
check("round_progress names who has answered", len(submitted) == 2, f"{len(submitted)} of 2")
check("progress carries no answer text", "text" not in json.dumps(prog or {}))

print("\n=== host reveals ===")
call("POST", "/rest/v1/rpc/advance_round", tok_a, {"p_round": round_id, "p_phase": "revealing"})
revealed = call("POST", "/rest/v1/rpc/round_submissions", tok_b, {"p_round": round_id})
texts = [s["text"] for s in revealed] if isinstance(revealed, list) else []
check("after reveal Ben sees both", len(texts) == 2, f"saw {len(texts)}")

print("\n=== THE ANONYMITY TEST — the reveal must not name the author ===")
# Voting for the funniest answer only means anything while nobody knows whose
# it is. Row-level security cannot hide a column, so this goes through
# round_submissions() rather than a select on the table.
others = [r for r in (revealed or []) if r["text"] != "BEN_SECRET_ANSWER"]
check("Ana's answer reaches Ben with no author attached",
      len(others) == 1 and others[0]["player_id"] is None,
      f"player_id {others[0]['player_id'] if others else 'missing'}")
check("Ben can still identify his own answer",
      any(r["player_id"] == pb["id"] for r in (revealed or []) if r["text"] == "BEN_SECRET_ANSWER"))

direct = call("GET", f"/rest/v1/submissions?round_id=eq.{round_id}&select=text,player_id", tok_b)
check("and the table itself still refuses to hand over anyone else's row",
      isinstance(direct, list) and len(direct) == 1,
      f"saw {len(direct) if isinstance(direct, list) else direct}")

print("\n=== voting, and the vote-sealing test ===")
call("POST", "/rest/v1/rpc/advance_round", tok_a, {"p_round": round_id, "p_phase": "voting"})

# Voters pick an answer, never a person — they were never told whose it was.
by_text = {r["text"]: r["id"] for r in (revealed or [])}
call("POST", "/rest/v1/rpc/cast_vote", tok_a,
     {"p_round": round_id, "p_submission": by_text["BEN_SECRET_ANSWER"]})
call("POST", "/rest/v1/rpc/cast_vote", tok_b,
     {"p_round": round_id, "p_submission": by_text["ANA_SECRET_ANSWER"]})

resolved = call("GET", f"/rest/v1/votes?round_id=eq.{round_id}&select=target_player_id", tok_b)
check("the server resolved the author from the answer",
      isinstance(resolved, list) and resolved and resolved[0]["target_player_id"] == pa["id"],
      str(resolved)[:80])

own = call("POST", "/rest/v1/rpc/cast_vote", tok_b,
           {"p_round": round_id, "p_submission": by_text["BEN_SECRET_ANSWER"]})
check("voting for your own answer is refused", isinstance(own, dict) and "__error__" in own,
      str(own)[:90])

# Changing your mind must replace your vote, not add a second one.
call("POST", "/rest/v1/rpc/cast_vote", tok_b,
     {"p_round": round_id, "p_submission": by_text["ANA_SECRET_ANSWER"]})
mine_now = call("GET", f"/rest/v1/votes?round_id=eq.{round_id}&voter_id=eq.{pb['id']}&select=id", tok_b)
check("a second vote replaces the first rather than counting twice",
      isinstance(mine_now, list) and len(mine_now) == 1,
      f"{len(mine_now) if isinstance(mine_now, list) else mine_now} vote rows")
votes_b = call("GET", f"/rest/v1/votes?round_id=eq.{round_id}&select=voter_id", tok_b)
check("Ben sees only his own vote while voting is open",
      isinstance(votes_b, list) and len(votes_b) == 1, f"saw {len(votes_b) if isinstance(votes_b, list) else votes_b}")

print("\n=== a player cannot drive the game ===")
bad = call("POST", "/rest/v1/rpc/advance_round", tok_b, {"p_round": round_id, "p_phase": "scored"})
check("non-host advance_round is refused", isinstance(bad, dict) and "__error__" in bad,
      str(bad)[:90])
bad2 = call("PATCH", f"/rest/v1/players?id=eq.{pb['id']}", tok_b, {"score": 999})
still = one(call("GET", f"/rest/v1/players?id=eq.{pb['id']}&select=score", tok_b))
check("a player cannot write their own score directly",
      still is not None and still.get("score") != 999, f"score is {still}")

print("\n=== scoring ===")
res = call("POST", "/rest/v1/rpc/score_round", tok_a, {"p_round": round_id})
check("score_round returns points", isinstance(res, dict) and "points" in res,
      json.dumps(res)[:160] if isinstance(res, dict) else str(res)[:160])
players = call("GET", f"/rest/v1/players?game_id=eq.{game_id}&select=name,score", tok_a)
check("scores were applied", isinstance(players, list) and any(p["score"] > 0 for p in players),
      str(players))
votes_after = call("GET", f"/rest/v1/votes?round_id=eq.{round_id}&select=voter_id", tok_b)
check("votes open up once scored",
      isinstance(votes_after, list) and len(votes_after) == 2,
      f"saw {len(votes_after) if isinstance(votes_after, list) else votes_after}")

print("\n=== the Pass ends the turn and costs nothing ===")
solo = one(call("POST", "/rest/v1/rpc/start_round", tok_a, {
    "p_game": game_id, "p_card": "the-sound", "p_mechanic": "solo",
    "p_lane": "say", "p_turn": pb["id"], "p_phase": "choosing", "p_secs": None,
}))
before = one(call("GET", f"/rest/v1/players?id=eq.{pb['id']}&select=score", tok_b))
call("POST", "/rest/v1/rpc/spend_pass", tok_b, {"p_game": game_id})
after = one(call("GET", f"/rest/v1/players?id=eq.{pb['id']}&select=score,pass_spent", tok_b))
closed = one(call("GET", f"/rest/v1/rounds?id=eq.{solo['id']}&select=phase", tok_b))
check("the Pass costs exactly zero points",
      after and after["score"] == before["score"], f"{before['score']} -> {after['score']}")
check("the Pass is recorded", bool(after and after["pass_spent"]))
check("the Pass actually closes the card", closed and closed["phase"] == "scored",
      f"phase {closed['phase'] if closed else '?'}")

print(f"\n{'=' * 60}\n  {len(passed)} passed, {len(failed)} failed")
if failed:
    for f in failed:
        print(f"    FAILED: {f}")
raise SystemExit(1 if failed else 0)
