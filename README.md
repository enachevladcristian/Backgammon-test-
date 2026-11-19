# Backgammon — 2.5D

A complete backgammon game that runs in the browser. No dependencies, no build
step: plain ES modules, a hand-rolled 3D projection and the Canvas 2D API.

The board is drawn in perspective ("2.5D"): checkers are real cylinders with
side walls, highlights and drop shadows, and the dice are **actual cubes** whose
pips sit on the faces — they tumble through quaternion-space while rolling and
land on the number you rolled.

The layout is the classic one: the outer boards on the left, each player's home
board on the right, the points meeting across the middle of the board and a
raised **vertical bar** separating the two halves.

![The board, mid-game](docs/preview.jpg)

## Play

```bash
npm start          # http://localhost:8080
```

Any static server works too (`python3 -m http.server`), the modules just need to
be served over http.

## What you can do

- **Roll the dice** — press `Space`, click **Roll dice**, or click the board.
- **Move the pieces** — click a checker, then click one of the highlighted
  points (the gold badges show which die is used). Click the tray to bear off.
- Play **against the computer** (default) or **two players** on one screen.
- **Undo** your moves during your own turn, hit `Esc` to deselect, `N` for a new
  game. Sound can be muted with the ♪ button.

## Rules implemented

- Standard starting position (167 pips), direction of play, no two-sided points.
- Blots are hit and sent to the bar; a player on the bar must re-enter into the
  opponent's home board before doing anything else.
- Bearing off only when all fifteen checkers are home; an oversized die may only
  be used on the checker farthest from the goal.
- Doubles are played four times.
- You must use as many dice as possible — if only one die can be played, the
  higher one must be played. Illegal moves simply never appear as options.
- Turns end automatically when no legal move is left; gammons and backgammons
  are detected when the game ends.

## The computer opponent

`js/ai.js` enumerates every legal turn with a depth-first search (deduplicated
and capped, typically a few milliseconds) and scores the resulting positions on
pip count, blots and exposure, points made, checkers on the bar and checkers
borne off. It plays a solid game and never makes an illegal move.

## Layout of the code

| file | role |
| --- | --- |
| `index.html`, `styles.css` | page shell, HUD, glass panels |
| `js/rules.js` | position, legal moves, hits, bear-off, turn-optimality search |
| `js/ai.js` | computer opponent (full-turn search + heuristic) |
| `js/scene.js` | perspective camera, board geometry, 3D checkers and dice |
| `js/app.js` | game flow, input, animation, UI, synthesised sound |
| `server.js` | tiny dependency-free static server |

The camera is a real pinhole model: world → screen happens in `Camera.project()`
and screen → board plane in `Camera.unproject()`, which is what makes clicking
perspective-correct points possible. `Camera.fit()` picks the elevation, focal
length and offset so the whole board always fits the viewport.

## Tests

```bash
npm test
```

- `test/rules.test.js` — rule checks plus 300 complete random games that assert
  the invariants (checker counts, no negative stacks, games terminate).
- `test/ai.test.js` — the AI's moves are always legal, it finds hits, it answers
  in a few milliseconds, and it plays 40 full games against itself.
- `test/app.test.js` — boots the real app against a mock DOM/canvas, rolls,
  clicks projected board positions and moves checkers, so the renderer and game
  flow are exercised end to end in Node.
