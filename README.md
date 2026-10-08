# Audience Layout Designer

A responsive audience seating planner for an orchestra-level auditorium. Configure rows and columns independently for nine sections: front, middle, and rear, each divided into left, center, and right.

## Development

- `npm run dev` starts the development server.
- `npm run build` creates a production build.
- `npm run lint` runs Oxlint.

Built with React, TypeScript, and Vite.

## Website hosting

### GitHub Pages

The public planner is hosted at
https://redmondtechorchestra.org/meydenbauer-stage/.
The GitHub Pages URL redirects to this inherited organization domain.
The GitHub Pages workflow deploys on pushes to `main`, and can also be run
manually in Actions. It installs the lockfile dependencies, runs lint, builds
with the base path provided by GitHub Pages, and publishes the resulting static
site. Repository Pages settings must use **GitHub Actions** as the build source.
Hash routes make each view directly linkable without server rewrites.
The planner's HTML includes `noindex, nofollow` for all views, asking search
engines not to index the planner or follow its links. This does not affect the
marketing site's other pages, and is not access control: the planner and its
repository remain public. Previously indexed pages may take time to disappear.
Do not block crawler access to the planner in `robots.txt`, since crawlers must
be able to read the `noindex` directive.

### Other hosting options

The planner is a static web app; no application server is required. Publish the
contents of `dist` to a static host with HTTPS.

- **Subdomain**, for example `plan.redmondtechorchestra.org`: run `npm run build`,
  deploy `dist` at the host root, and configure the subdomain's DNS and HTTPS
  through the hosting provider. This keeps deployment separate from the main site.
- **Subroute**, for example `redmondtechorchestra.org/meydenbauer/`: run
  `npm run build -- --base=/meydenbauer/` and serve `dist` at that path. The main
  website's host must support serving these static files, or proxying that path
  to a separate static host. Keep the trailing slash on the deployment URL.

The base option sets asset URLs, including the lazy-loaded 3D and stage views.
The view navigation uses hash routes (`#/plan`, `#/stage`, and `#/venue`), so
direct links, refreshes, and browser Back/Forward work on GitHub Pages without
a server routing fallback. The same top navigation is present in all three views.
Choose the final URL and hosting configuration before deploying; no DNS or
website changes are made by building the app.

Capacity and attendance planning remain available, but projected ticket revenue,
ticket pricing, and fee estimates are not included in the app.
Ticket-sale counts used for attendance planning are saved only in the visitor's
browser, not shared between visitors.

## View navigation

Use the top navigation's **Auditorium plan**, **Production stage plan**, and
**3D venue** titles to switch views; these replace duplicate page headings.
Audience-category legends are omitted from the plan and venue to save space;
seat colors and attendance controls are unchanged.
The Attendance preview panel appears only on Auditorium plan. Production stage
plan and 3D venue use the freed space, while retaining the same attendance settings.
Seating-dimension controls are also confined to Auditorium plan. The 3D venue
always displays a full audience regardless of the plan's sales projection and
fills the window edge-to-edge below the top navigation.
Seating and attendance settings remain unchanged
when switching views. There is no Reset layout control.

The 3D toolbar includes Overview, Bird's eye view (near the 31-foot ceiling
above the front audience seating), and shortcuts to the rear, scissor-lift,
and stage DJI cameras. Camera shortcuts use the same lens framing as clicking
their models. Hover, focus, or click **Navigation help** for mouse and keyboard
instructions instead of a full-width help bar.
View transitions smoothly interpolate position, rotation, and lens field of
view together; selecting another preset mid-transition starts from the current pose.

## 2D room details

The 2D plan and PNG export include a plan-derived upper-left wall cutout,
upper-left double doors, four outward-swinging rear double-door sets, a large
left-wall garage door shown flush with the wall using tick marks. The rear tech booth has
two desk stations and a separate camera position. Unlabeled dimensions and
positions are approximate interpretations of the supplied floor plan.
These room details and seating proportions are also reflected in the 3D preview.
The door behind the stage and stage stairs are intentionally omitted from the
audience-facing 2D plan.
The 2D stage is a single outline: a 48-foot-wide body for the rear 32 feet
and a 54-foot-wide front apron for the final 8 feet, with no height-tier divisions.
Stage dimensions and the garage-door text label are hidden in 2D and PNG exports.
The camera position is centered on the stage, with the tech booth to its left;
both are clear of the rear doors.
The combined tech-and-camera footprint is 24 by 8 feet: 18 feet for the two
tech desk stations and 6 feet for the camera, with no gap between them.
The stage is offset 2 feet 3 inches from the rear wall. Default 2D seating uses
a 3.25-foot row pitch and at least 8 feet of clearance from the stage apron to the
front chair edges within its width. The tech booth depicts two desks with chairs.
Clearances change when users customize seating dimensions.

## Production 2D stage view

Select **Production stage plan** for a stage-only crew plan. It shares the procedural layout
with the 3D scene and shows musician chairs and facing directions,
instrument footprints, stage tiers, and numbered microphone bases with boom/
capsule positions. An adjacent input patch list labels channels 1-26, including
the stereo keyboard DIs. The audience-facing **Auditorium plan** remains unchanged.
The top view places the audience below and stage right on the left.
The stage drawing scales to fit the available viewport below the navigation.
The input patch list scrolls independently when needed; on narrow screens it
sits below the drawing.
Instrument footprints and microphone placement remain illustrative.
Production 2D and 3D include schematic stage-left stairs beside the harps,
ascending inward to the 5-foot tier, with an opening in the side railing.
The 10-foot run and 4-foot width are illustrative, not a construction or
code-compliance design; confirm actual stairs, landings and handrails with the venue.
Music stands are hidden in the production 2D view to reduce clutter; they remain
visible in 3D. Instrument bounds are projected into stage-local coordinates so
keyboards and percussion align with the same tiers as their 3D counterparts.
Both keyboards place black keys at the far edge of the white key bed, away
from the player's bench, with no white strip behind them.

## 3D microphone and navigation details

### Input channel numbering

The 3D microphone and keyboard hover labels use this patch order.
The 88-key instrument is assigned to piano; the 49-key instrument to keyboard.
Stereo inputs are listed left then right.

| Input | Source |
| --- | --- |
| 1-2 | Overheads (C414 pair) |
| 3 | Principal 1st violin |
| 4 | Principal 2nd violin |
| 5 | Principal viola |
| 6 | Principal cello |
| 7 | Principal bass |
| 8 | 1st violin section |
| 9 | 2nd violin section (shared violin omni) |
| 10 | Viola/cello section (shared omni) |
| 11-12 | Stereo piano DI (L/R) |
| 13-14 | Stereo keyboard DI (L/R) |
| 15-16 | Harp 1 / Harp 2 |
| 17-18 | Winds pair (flute-side / oboe-side) |
| 19 | Horns |
| 20 | Trumpet |
| 21 | Trombone |
| 22 | Tuba |
| 23-26 | Percussion zones 1-4 |

Total: 22 microphones on 21 stands plus 4 DI channels = 26 console inputs.
The DI assignments label the existing instruments; separate DI boxes are not modeled.

### Microphone placement

Stage microphones are supported by tripod stands and visible poles/booms.
The main pair depicts side-address AKG C414 cardioids spaced horizontally
1 foot apart, each aimed 45 degrees inward across the orchestra by rotating
around the vertical axis. This is a spaced inward-facing crossed pair, not
coincident XY or outward-facing ORTF. Both bodies stand upright, with the black
body below the gray grille and no tilt. The active grille fronts define the
aiming directions.
Its stand rests directly on the stage behind the conductor, placing the pair
8 feet above the local stage deck, with no microphone riser.

First-desk pencil mics extend above each string desk and angle back toward the
instruments, not the score, except input 7, which sits between the two downstage
bass players and aims toward their shared instrument area.
Booms approach from in front along the desk's facing
direction rather than across it. First violins and cellos sit 9 inches farther
outward from the conductor, with their desks moving together to leave mic space.
The first-violin section mic remains directional. The former second-violin
section mic is a shared violin omni, with another shared omni between violas and
cellos. Both shared omnis (inputs 9 and 10) stand on the 4-foot platform at the
same Z baseline and stand height. These are recording/blend channels and cautious PA trials, not a promise
of equal section coverage or sufficient gain before feedback.
Two high wind mics reach over and aim down at the midpoint between the shifted
front and rear wind rows. Each harp retains a close condenser.
Four brass mics cover horns, trumpets, trombones and tuba independently.
The horn mic sits behind the rear horn row, aiming downstage toward the bells;
both horn rows are shifted 1 foot stage-right and each chair faces the conductor,
with individual music stands following the new orientation. The horn mic follows
the shifted section and aims at an estimated rear-row bell area.
trumpet and trombone mics sit elevated in front of their respective sections.
The dedicated tuba mic booms from beside the player to above the estimated bell.
Instrument bodies are not modeled, so bell positions are illustrative and must
be adjusted to actual players and instruments during rehearsal.
Four separate percussion zone mics cover the rear instruments.
These placements are flexible rehearsal starting points; use only needed
channels in the PA and check coverage, spill and phase.
Polar-pattern choices are described by hover labels/metadata, not simulated
acoustic pickup. Heights are relative to the supporting stage tier unless noted;
placement is illustrative, not an acoustic analysis.

Click or Tab-focus the 3D canvas to use WASD flight navigation: W/S move along
the view direction, A/D strafe, Q/E move down/up at 30 feet per second, and Shift
increases speed to 80 feet per second.
Mouse orbit and pan remain available. Flight keys clear when focus is lost.
In development only, the compact bottom-left coordinate guide shows red X, green Y, and blue Z arrows
that follow the camera orientation, without text labels or a room-size badge.
The guide is omitted from production builds.

The 3D stage and orchestra move together by 2 feet 3 inches from the upstage
wall. Audience rows use the 2D row pitch and section clearances, including
rearward-aligned center blocks. The room has the same upper-left cutout,
flush garage door, closed double doors, and adjoining tech/camera area.
Rear door swing direction is shown outward in 2D; 3D renders the doors closed.
The tech area uses desk and chair geometry rather than an opaque booth block.
The combined 24-by-8-foot tech/camera platform is 3 feet high, with all desks,
chairs and camera equipment elevated together.
The 3D room includes an extended scissor lift near the long wall opposite the
garage door, beside the stage-left stairs. Its platform is 20 feet above the
floor, with a supported camera aimed toward the stage. Lift dimensions and
placement are schematic, not an equipment specification or operating plan;
venue approval, floor loading, access and manufacturer requirements must be
confirmed separately.
The production stage plan and 3D scene also include a compact DJI-style camera
on a slim upright pole at the center of the 4-foot tier, with its lens 6 feet
above the deck, facing the center winds and tilted 15 degrees upward.
The pole is a schematic mount, not a specified freestanding support design.
Click the rear tech, scissor-lift or onstage camera in 3D to transition
to its lens position looking toward the stage. Camera views assume 16:9 video
with full-frame-equivalent lenses: rear tech 85mm for tighter stage framing,
lift 16mm for a wider full-stage overview with framing margin. The onstage camera
uses an approximate 120-degree horizontal ultra-wide field of view.
A white frame and shaded outside region indicate approximate recorded framing.
Projection uses a 36mm-wide equivalent sensor cropped to 16:9, adapting to the
viewport so the frame retains the chosen lens field of view on resize.
These are rectilinear planning assumptions, not calibrated physical lenses,
sensor modes, or a simulation of DJI fisheye distortion and stabilization crops.
Overview returns to the room view; flight navigation exits the camera-view label.

Audience chairs include four floor-reaching legs that follow each chair's
orientation and occupancy opacity. Legs support the same seat-view selection
as the cushions and backs; wheelchair spaces remain floor markers.

The orchestra layout includes approximate 42-inch-high railings along the outer
sides and back of the tiered stage, leaving the downstage front and internal tier
edges open. Winds, brass, and basses each have an individual music stand; other
strings share stands by desk. Bass stands face inward toward the conductor.
The unpaired outermost first violin, second violin, and viola players each have
a stand directly in front of their remaining chair rather than at a desk midpoint.
Bass stools sit 2.6 feet outward from their individual stand centers.
Brass chairs use 2.5-foot horizontal center spacing, with individual stands
aligned to each player and the rear horns staggered behind the front row.
Flutes, oboes, and clarinets also use 2.5-foot horizontal center spacing;
bassoons retain their 3-foot spacing.
Wind and brass chair centers follow straight row baselines without an automatic
rearward offset at the outer seats. Horn chairs still turn individually toward
the conductor; their row centers remain aligned with the rest of the front brass.
Both wind rows and their music stands are set back 12 inches, placing the second
row near the rear edge of the 5-foot-high tier. Brass and active percussion are
also set back 18 inches together, preserving their internal spacing.
The seating setbacks preserve microphone tripod positions; subsequent mic
revisions change aiming and wind boom reach. Harps and stored rear percussion
stay in place.
Harp strings extend to the bottom frame. Each harp's taller side points toward
the conductor, with a chair behind the shorter side facing toward the taller side
and the instrument on the player's right.
These models are planning illustrations, not a safety or code-compliance assessment.

Rear-tier percussion runs from stage left (+X) to stage right (-X):
glockenspiel, xylophone, a table with six small banchan bowls in a 3-by-2 grid,
vibraphone, four active timpani (32, 29, 26, and 23 inches), snare drum, 20-inch
tam-tam, hi-hat, crash cymbals on a stand, bass drum, auxiliary table, toms,
suspended cymbal, and congas. Active stage-right stations from snare through
congas share a single Z baseline; the congas sit side-by-side along X.
These stations are spaced with equal X footprint gaps from the active timpani
to the inside of the stage-right railing.
Both percussion tabletops measure 18 by 12 inches; the six bowls retain a 3-by-2 grid.
Instrument dimensions and clearances are approximate.
X-aligned tubular bells, two spare timpani (29 and 26 inches), and a spare snare
are stored along the back of the stage, separate from the active percussion.
Two mallet-player stations form right-angle layouts: the Z-aligned vibraphone
with the X-aligned bowl table near its downstage end, and the Z-aligned xylophone
with the X-aligned glockenspiel near its downstage end, toward the conductor.
Players stand inside the L facing downstage. Small gaps separate the
instruments at each corner. The four active timpani form a deeper 45-degree
touching-rim curve with an open playing side upstage.
The three concert toms form a smaller 45-degree wrap, also open upstage, with
individual supports beneath the drums.
