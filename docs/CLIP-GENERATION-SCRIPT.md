# Clip generation script — the eight uncovered beats

Every one of the nine real questions already has its own clip
(`public/clips/*.mp4`, wired through `Question.clip` in
[`questions.ts`](../src/survival/questions.ts) and rendered by
[`ClipStage.tsx`](../src/survival/views/ClipStage.tsx)). The two warm-ups and
five non-`running` phases never got one. This is the production script for
those eight — written for **Higgsfield** (Seedance 2.0 / Popcorn), in the
prompt structure Higgsfield's own guide specifies: a shot-count line first,
then a locked cinematic-quality block, then location/character, then a
timed action sequence, then explicit camera/lens/VFX technical notes and a
"the camera does NOT do this" lock so the perspective doesn't drift.

Read [How this plugs in](#how-this-plugs-in-once-the-files-exist) before
generating anything — it explains the one real constraint every clip here
has to satisfy: **it has to loop**, because none of these render as a single
play-once cut.

## Global spec — identical for all eight

Put this at the top of every generation, before the per-clip prompt:

```
Total: 5s / 1 shot / 9:16
Montage: no. Single continuous take, no cuts, no cut-aways, no intercut
angles. Cinematic lighting, photorealistic, 35mm film quality, desaturated
teal-and-rust color grade, professional color grading, sharp focus, high
detail texture, subtle film grain, shallow depth of field. Night-for-night
exposure — practical light sources only (screens, sodium streetlight,
emergency beacon, CRT glow), no daylight unless the shot specifically calls
for dawn. No on-screen text, no subtitles, no logos, no legible UI, no
readable signage — the game supplies all text itself and generated text
reads as garbled artifacts.
```

**Aspect ratio: 9:16.** The backdrop this fills (`.clip-stage` in
`survival.css`) is a full-bleed layer behind a single-column phone card —
this plays on one phone in portrait, not a shared widescreen display.
Higgsfield supports 9:16 natively; do not generate 16:9 and crop.

**Duration: ~5 seconds, and it has to loop.** Every clip plays with `loop`
set (see `ClipStage.tsx`) and stays on screen for as long as a round is
open — anywhere from a few seconds to a couple of minutes. A hard cut back
to frame one reads as a stutter every few seconds for the length of a
round. Ask for **continuous, unresolving motion** — a slow dolly, a held
orbit, drifting embers, cycling glow — never an action with a beginning and
an end (a door that finishes opening, a hand that finishes reaching). If
Higgsfield's output visibly jumps at the loop point, trim a few frames from
each end before it goes in `public/clips/`; a loop that's musically exact
matters far less than one that never holds still long enough to notice the
seam.

**Audio: not required.** Every clip plays `muted` — see the `<video>` in
`ClipStage.tsx`. Generate silent, or don't bother stripping the track
after; either way nothing an audio track carries will ever be heard.

**No people in extreme close-up carrying dialogue.** A couple of the nine
existing clips (`guilt-trip.mp4`, `feuding-neighbour.mp4`) show people
because their scenario is a face-to-face confrontation. None of these eight
need that — they're establishing shots for a *phase*, not a *choice*, and a
generated face holding an expression for an unbounded loop is the first
thing that reads as wrong. Where a person appears, keep them mid-distance,
in motion or turned away, never a static held close-up.

---

## 1. Lobby — `lobby.mp4`

The very first thing anyone sees, before the world has been told to them in
words. Quiet dread, not action yet.

```
Total: 5s / 1 shot / 9:16
[insert Global spec block]

Location: a suburban street at dusk, seen from a bedroom window looking
out. Empty road, one parked car with its hazards blinking, a folded
emergency-broadcast leaflet skittering across the tarmac in the wind. Two
houses down, a window flickers with the blue-white pulse of a muted TV.
No people visible.

Action (0-5s): the hazard lights blink on a slow, steady cycle — off,
amber, off. The leaflet on the road lifts an inch in a gust, settles,
lifts again. Nothing else moves. The camera holds completely still.

Camera: locked-off static shot, no pan, no push, no handheld drift at all.
Lens: standard 35mm-equivalent, natural perspective, no distortion.
[VFX: a single loose leaflet caught mid-gust, looping on the hazard-light
cycle rather than on its own motion]

The camera does NOT: move, dolly, or reframe at any point. This is the one
clip in the set that should feel like a held breath, not a shot.
```

---

## 2. Briefing — `briefing.mp4`

Plays under the `OPENING` + `EXTRACTION_BRIEF` narration — the outbreak
confirmed, the grid failing, the port established as the only way out.

```
Total: 5s / 1 shot / 9:16
[insert Global spec block]

Location: a city skyline at night, shot from a rooftop or high window,
looking out toward a distant industrial port lit up on the horizon (cranes,
floodlights, one lit helicopter pad). Between here and there, the city is
going dark in patches — whole blocks losing power mid-shot, one grid
sector at a time.

Action (0-2s): the skyline is fully lit, ordinary. (2-4s): three or four
blocks in the middle distance cut to black in a ripple, left to right.
(4-5s): a single distant light — a helicopter, small and steady — crosses
low over the skyline, headed toward the lit port on the horizon.

Camera: slow, barely perceptible push-in (dolly in), held on the skyline
the entire time — the power failing and the helicopter crossing both
happen inside one continuous frame, not a cut to either.
Lens: wide, slight vignette at the corners.
[VFX: block-by-block power failure, sodium streetlight color dying to
black in patches; a single moving aircraft light, steady altitude]

The camera does NOT: cut to the helicopter, cut to street level, or zoom
past a gentle dolly. One skyline, one push, the whole five seconds.
```

---

## 3. Warm-up 1 — `first-move.mp4`

Under "First Move" — comedic, frantic, the lightest beat in the whole
night. Deliberately breaks from the dread of everything else.

```
Total: 5s / 1 shot / 9:16
[insert Global spec block, EXCEPT: warmer color grade — ordinary indoor
lamplight, not teal-and-rust. This is still an ordinary evening for one
more second.]

Location: a cluttered bedroom, phone face-up on a nightstand mid-shot, its
screen flooding the room red with a silent emergency alert banner (no
legible text — a solid red banner shape only). A hand enters frame from
the side, reaching toward a cluttered desk covered in options: a phone
charger tangled in cables, a half-eaten snack bag, a framed photo face-
down, a game console controller, an umbrella leaning in the corner.

Action (0-1s): red light floods the room from the phone screen. (1-4s):
a hand sweeps across the desk in a single hesitating motion, hovering over
each object in turn without committing to one — charger, snack, photo,
controller, umbrella — before the loop resets to the hover. (4-5s): hand
pulls back to the starting hover position, ready to repeat.

Camera: static, slightly high angle looking down at the desk and the
reaching hand, handheld with very light natural sway — not stabilized,
not violent.
Lens: standard, shallow depth of field, desk objects in focus, background
soft.
[VFX: the red alert-light flood is a constant wash from off-frame, pulsing
gently rather than static]

The camera does NOT: follow the hand off the desk, cut to the phone
screen, or reveal a face. The comedy is in the indecision, held in one
frame.
```

---

## 4. Warm-up 2 — `group-chat.mp4`

Under "The Group Chat" — same light, comedic register as warm-up 1.

```
Total: 5s / 1 shot / 9:16
[insert Global spec block, same warm indoor exception as clip 3]

Location: close on a phone screen held at arm's length in a dark room, the
only light source. The screen itself shows an unreadable wash of chat-
bubble shapes stacking rapidly (no legible text) — silhouetted, generic
message bubbles scrolling upward fast, over and over.

Action (0-5s): message bubbles stack and scroll upward continuously,
never slowing, never stopping — a chat that has gone completely feral.
The phone's glow flickers slightly with each new bubble, like a strobe of
notifications.

Camera: static, phone held roughly centre-frame, very slight natural
handheld tremor (someone is holding this phone, but not shaking it).
Lens: close, shallow depth of field, edges of the phone slightly out of
focus, the bubble-scroll is the entire subject.
[VFX: notification-flicker lighting synced loosely to each new bubble
appearing; the bubble shapes themselves must stay abstract/unreadable —
no invented words, letters, or logos]

The camera does NOT: pull back to reveal who's holding the phone, or slow
the scroll rate at any point in the loop.
```

---

## 5. The Exchange (puzzle surface) — `the-exchange.mp4`

Backdrop for the Exchange/ledger UI, where the berth-puzzle fragments get
traded. Ties directly to the existing `Terminal.tsx` scene component,
which already frames a real vintage CRT photo — this clip should read as
if it's playing on that exact monitor.

```
Total: 5s / 1 shot / 9:16
[insert Global spec block, EXCEPT: this one is lit ENTIRELY by the CRT's
own green glow — no external practical lights at all]

Location: extreme close on an old CRT monitor's curved glass, angled
slightly off-axis so the screen's own glow lights the shot rather than
anything in the room. On the screen: cascading columns of green digits,
digital-rain style, scrolling downward continuously. Faint visible
scanlines and a soft phosphor bloom around the brightest digits.

Action (0-3s): green digit-rain scrolls down steadily, dense and fast.
(3-3.5s): one column glitches — a burst of static, the green briefly
replaced by a flash of red digits mid-column. (3.5-5s): the glitch clears,
green digit-rain resumes exactly as before, uninterrupted.

Camera: locked-off, dead-on to the curved glass, no movement at all — the
screen's own content is the only motion.
Lens: macro-close, screen door / phosphor texture visible, natural CRT
curvature distortion at the frame edges.
[VFX: digital-rain digit cascade (green, dense); one brief red-static
glitch burst at the 3s mark, then a clean return to green — this is the
loop's one accent beat, not a repeating pattern]

The camera does NOT: pull back to reveal the room, the monitor's casing,
or anyone standing at it. Screen only, the whole five seconds.
```

---

## 6. The final plea — `the-plea.mp4`

Under `FINAL_PLEA.setup` almost verbatim: the chopper lands, the blast
doors give way, the pilot is shouting over the rotors.

```
Total: 5s / 1 shot / 9:16
[insert Global spec block]

Location: a rooftop helipad at night. A helicopter has just touched down,
rotor wash kicking up dust and loose debris in a wide radius. Beside it,
a set of heavy hydraulic blast doors are mid-grind, opening onto the
rooftop from a stairwell housing. Silhouette of a pilot, half-turned in
the cockpit doorway, one arm raised and gesturing urgently — mouth open,
mid-shout, face not the focus.

Action (0-5s): rotor blades spin at a constant fast rate throughout (never
slowing, never a held single frame — motion-blurred blades, continuous).
The blast doors continue their grinding open motion at a steady rate,
never fully finishing within the loop. Dust and debris kick continuously
in the rotor wash. The pilot's raised arm gestures in a repeating urgent
sweep.

Camera: handheld, moderate intensity (present but not chaotic — this is
urgent, not violent), slowly circling a few degrees around the scene
rather than holding static.
Lens: wide-ish, slight chromatic aberration from the dust and downwash.
[VFX: continuous rotor-blade motion blur; grinding blast-door texture with
sparks at the hinge; dust/debris particulate kicked by downwash]

The camera does NOT: let the blast doors finish opening, let the rotors
slow or stop, or cut to inside the cabin. The urgency is that nothing here
resolves — it stays mid-arrival for the whole loop.
```

---

## 7. The tribunal — `the-tribunal.mp4`

The vote. "Make the case for what is left" — a room deciding, not acting.

```
Total: 5s / 1 shot / 9:16
[insert Global spec block]

Location: a rooftop at night, a loose ring of figures standing at a
distance from camera, lit only by the slow rotating sweep of a helicopter
beacon light somewhere off-frame — the beam sweeps across the group once
per loop, briefly lighting faces in silhouette before passing on. Nobody
is centred; this reads as a group, not a portrait.

Action (0-5s): the beacon light sweeps once across the ring of figures,
left to right, briefly rim-lighting each silhouette as it passes, then
fades back to near-darkness before repeating (the loop point IS the
beacon's return to its start position, so time the sweep to complete
exactly at 5s).

Camera: static, wide, holding the whole ring in frame.
Lens: wide, low-light grain heavier than the other clips — this is the
darkest exposure in the set.
[VFX: a single rotating beacon sweep, warm amber-white, the only light
source in the shot]

The camera does NOT: push in on any one figure, cut to a face, or hold on
anyone longer than the sweep naturally does. This is a jury, not a
witness stand.
```

---

## 8. Result — `result.mp4`

Aftermath. Whatever happened, the night is over.

```
Total: 5s / 1 shot / 9:16
[insert Global spec block, EXCEPT: allow the first hint of dawn light at
the horizon — the only clip in the set permitted any daylight, because
this is the one moment that comes after]

Location: the same rooftop helipad as `the-plea.mp4`, now shot from
further back — wide enough to see the helicopter lifting off into the
night sky, already a few dozen feet up and climbing away from camera. The
rooftop below is otherwise empty and still. At the horizon behind the
departing aircraft, the faintest suggestion of dawn — a thin band of
grey-blue, not yet warm.

Action (0-5s): the helicopter continues climbing and receding at a
constant rate throughout, its position never resolving to "gone" within
the loop — always still visible, always still leaving. Its nav lights
blink at a steady interval.

Camera: static, wide, locked on the empty rooftop with the receding
aircraft in the upper frame — no push, no pan, no follow.
Lens: wide, the widest field of view in the set, to hold both the empty
foreground and the departing aircraft in one frame.
[VFX: blinking aircraft nav lights (red/white, steady interval); the
faintest dawn gradient at the horizon line]

The camera does NOT: follow the helicopter, cut to the sky, or let dawn
progress past a bare suggestion at the horizon. It stays exactly this far
from resolved — no seat is filled or emptied by anything this clip shows.
```

---

## Delivery

| Clip | File | Question / phase it backs |
|---|---|---|
| Lobby | `public/clips/lobby.mp4` | `lobby` phase |
| Briefing | `public/clips/briefing.mp4` | `briefing` phase |
| First Move | `public/clips/first-move.mp4` | `INTRO_QUESTIONS[0]` |
| The Group Chat | `public/clips/group-chat.mp4` | `INTRO_QUESTIONS[1]` |
| The Exchange | `public/clips/the-exchange.mp4` | the Exchange/ledger surface |
| The final plea | `public/clips/the-plea.mp4` | `plea` phase |
| The tribunal | `public/clips/the-tribunal.mp4` | `tribunal` phase |
| Result | `public/clips/result.mp4` | `result` phase |

Same delivery constraints as the nine existing clips (see
`scripts/check-bundle.mjs`): `.mp4`, no audio track needed, committed to
`public/clips/` (this repo has no Git LFS yet — see `docs/BRIEFING.md`'s
open note on that), and matched by a `clip:` reference wherever the code
ends up reading it.

## How this plugs in once the files exist

Writing these files into `public/clips/` doesn't make them appear —
`ClipStage.tsx` only ever reads `Question.clip`, and only during the
`running` phase. Wiring the lobby/briefing/plea/tribunal/result clips in is
a separate, small code change (a phase-keyed variant of `ClipStage`, or a
`PHASE_CLIPS` lookup rendered outside the `running`-only gate) and the two
warm-up clips need `INTRO_QUESTIONS[i].clip` populated the same way the nine
real questions already are. Ask for that once the assets exist — this
document is deliberately just the generation brief, not the integration.
