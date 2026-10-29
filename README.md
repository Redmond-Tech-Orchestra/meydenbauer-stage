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
Auditorium plan starts in **Full capacity** mode. **Sales projection** remains
available in Attendance preview, without changing saved ticket-sale counts.
Capacity totals appear in the right panel rather than being repeated above
the drawing.

All three views share a restrained panel style, consistent control sizing and
clear keyboard-focus indicators. The top navigation uses icon-labeled links
with a distinct active state and consistent icon spacing, without a product title.
View tabs stay left-aligned on every page, with page-specific header controls
on the right.
Compact stacked icons and labels keep the header to one row on phones.
Auditorium's layout-controls toggle lives in the header.
Attendance and capacity panels use the same light surfaces and simpler
typography as the production input list. The 3D view keeps its full-size canvas.
Camera, scene, house lighting and fullscreen controls dock in the top navigation
on wide screens. At tablet and phone widths, a **View controls** button opens
a compact panel; click outside or press Escape to close it. On phones the button
uses an icon with an accessible label.
In fullscreen the same controls move inside the 3D container as a floating
toolbar, with **Exit fullscreen** available directly. Exiting fullscreen,
including with Escape, returns them to the header. Moving the controls does not
recreate the renderer or reset the camera, selected scene or lighting level.

The 3D venue opens in **Bird's eye view** by default.
The 3D toolbar's **Camera angle** dropdown includes Overview, Bird's eye view (near the 31-foot ceiling
above the front audience seating), and shortcuts to the rear
and stage DJI cameras, plus the conductor-facing phone. Camera shortcuts use the same lens framing as clicking
their models. Hover, focus, or click **Navigation help** for mouse and keyboard
instructions instead of a full-width help bar.
View transitions smoothly interpolate position, rotation, and lens field of
view together; selecting another preset mid-transition starts from the current pose.

### Piece scenes

The **Scene** dropdown in the production stage plan and 3D venue switches
between **Barber** (the default layout), **Holst**, **Williams**, **Korngold**,
**Ravel**, and **Hisaishi**. The selection is shared
between these views, with the scene selector consistently at the right of
the top navigation. In 3D fullscreen it remains in the fullscreen controls.
A disabled **Intermission** entry separates Korngold
from Ravel in the dropdown. Changing scenes updates the stage without resetting the
3D camera or audience.

For Barber, the two first-desk first-violin chairs vacate their position near
the conductor. One fills the empty place beside the existing single player at
the back of the first-violin section, with that pair's stand recentered. The
other sits one row behind on the same 2-foot-8-inch apron, using the relocated
first-desk stand. The principal microphone (input 4) stays with the new front
desk nearest the conductor, rather than following the relocated chair. The
first-violin section microphone (input 9) and its aim point also move back one
player row (3 feet outward, following the section's slight stagger), keeping
the microphone between the third and fourth rows as in Hisaishi.
All other instruments,
chairs and stairs retain their Hisaishi positions.

First-half percussion uses common floor marks across Barber, Holst, Williams
and Korngold. Chimes stay at the back; horizontal glockenspiel, xylophone and
vibraphone share a downstage row. Crash cymbals fit in that same row
between the xylophone and vibraphone, on one fixed first-half mark.
This pre-sets the
Korngold mallet arrangement even when instruments are parked.
Barber percussion runs stage left to right across the rear 6-foot tier:
chimes, glockenspiel, xylophone, crash cymbals and vibraphone; snare;
32/29/26/23-inch timpani in an arc approximately centered; a second 29/26-inch timpani
pair parked front-to-back at a shared X mark; second snare; bass drum;
suspended cymbal; tam-tam; auxiliary table;
congas. Percussion microphones 24-27 remain at their Hisaishi positions.
The parked pair's narrower horizontal footprint lets the stage-right stations
move inward, with 6-inch footprint gaps. These closer marks remain shared
throughout the first half, including Holst when all six timpani are active.
Barber appears first in the scene dropdown. Only its primary 32/29/26/23-inch
timpani quartet is active; all other Barber percussion is parked. Parked
instruments remain in place, shown opaque gray in 3D and with pale fills,
dashed outlines and muted labels in 2D. Hover labels identify activity per scene.
Hisaishi percussion remains active, and microphone activity is unchanged.
Barber also includes a same-scale standing violin soloist on the cleared apron,
audience-left of the conductor, with a violin in playing position.
The violin rests on the soloist's left shoulder with its neck pointing toward
the conductor; the left hand supports the neck. The bow is intentionally omitted.
A dedicated pencil mic uses input 3, reserved for the soloist outside Barber.
Barber has 28 inputs including the speaking mic on input 28.
Its straight upright stand has no boom and sits forward and to the player's
left (audience-right of the player), with the capsule
below the violin, aimed upward and inward from approximately 22 inches away.
This below-instrument placement prioritizes live-concert sightlines. It is a
starting position for the audio engineer to adjust during sound check for tone,
feedback and player/bow clearance.

Holst uses Hisaishi's original violin seating and Barber's percussion layout,
but replaces the timpani groups with two trios ordered stage left to right:
32/26/23 inches, then 29/29/26 inches. These occupy the same overall timpani
area as two separate arcs, open toward their players upstage, with a 6-inch gap between
groups; stage-left percussion and microphones stay put. Barber's quartet uses the same
upstage-open arc shape as Hisaishi rather than a straight line.
For Holst, only the six timpani, stage-right snare, bass drum, suspended cymbal
and tam-tam are active; all other percussion is parked. The timpani
reconfigure and the inactive mallet-side snare parks beside the chimes:
the stage-right snare, bass drum, tam-tam, auxiliary table,
suspended cymbal and congas retain their Barber marks. The timpani keep the
6-inch gap between trios; the larger gap beside
the stage-right snare is intentional to avoid moving the other instruments.
Percussion microphones remain fixed.

Williams uses original violin seating and Barber's percussion positions,
including the four-drum timpani arc and separate two-drum group. Only the primary
four timpani are active, along with both snares, tam-tam, crash cymbals,
vibraphone, glockenspiel, suspended cymbal and auxiliary table. The other
percussion remains parked; microphone positions are unchanged.
Williams uses the same horizontal mallet row as the other first-half pieces;
its inactive xylophone stays on its performance mark rather than parking upstage.

Korngold uses original violin seating and the Barber four-drum timpani arc.
Active percussion, stage left to right, is tubular bells, glockenspiel,
xylophone, crash cymbals, vibraphone, the primary four timpani, stage-right
snare, bass drum, suspended cymbal, tam-tam, and auxiliary table. The suspended
cymbal retains its shared first-half mark between bass drum and tam-tam.
Extra timpani, the other snare and
congas remain parked. Microphones stay fixed; no soloist is present.
Korngold's glockenspiel, xylophone and vibraphone all run horizontally in one
downstage row, in that order from stage left to right, with crash cymbals
inserted between xylophone and vibraphone. The glockenspiel shifts 0.4 feet
and xylophone 0.9 feet toward stage left to make room. Modeled footprint gaps
beside the crash stand are only about 3 inches, not player-access aisles;
confirm actual frames, stand legs and playing clearance on site.
The chimes use their post-intermission mark (X 10.2, Z -79 feet) in every
scene, including Korngold, so they never need moving. This rear placement
supersedes their earlier stage-left position in the listed order.
The straight row avoids the extra
front-to-back footprint of angled mallet keyboards; player access and working
clearances still need confirmation on site.

### Percussion changeovers

Both halves use a shared percussion-row baseline of Z -75.5 feet for bass
drum, snares, tam-tam, auxiliary table and congas, avoiding a front-to-back
reset at intermission. All percussion except chimes is set back 1.5 feet
from the previous forward layout, leaving more room for fixed zone-mic stands.
Both mallet rows are at Z -75.2 feet, with first-half crash cymbals at
X 14.1 on that same baseline. The stage-left snare sits between the
32-inch timpano and vibraphone at X 6.1, Z -75.2 feet, in line with the
mallets for Barber, Williams and Korngold. In Holst/Mars, it parks at
X 6.1, Z -79 feet beside the tubular bells to clear the wider timpani setup.
The timpani arcs start at Z -75.6 feet in both halves.
The parked spare pair stays front-to-back and within the rear tier.
Chimes remain fixed at X 10.2, Z -79 feet.
Horizontal placement and activity remain
piece-specific as described below.

In every four-timpani setup, the midpoint of the gap between the facing rims
of the 29-inch and 26-inch drums is on the stage centerline. The whole quartet
shifts together, preserving its arc. Holst's two-trio arrangement is unchanged.
The Ravel/Hisaishi stage-right row is spaced from the centered quartet,
preserving instrument order and matching marks between those two pieces.

- **Barber to Holst:** reconfigure the six timpani into two trios and park
  the mallet-side snare beside the chimes; all other percussion stays put.
- **Holst to Williams:** restore the primary timpani quartet and parked spare
  pair and return the mallet-side snare to the mallet row; all other percussion stays put.
- **Williams to Korngold:** no percussion movement; only activity changes.
- **Intermission:** reset to the Ravel/Hisaishi layout and remove the spare
  two timpani and second snare. This is the only bass-drum move.
- **Ravel to Hisaishi:** no percussion movement; only activity changes.

These are illustrative instrument footprints, not certified working aisles.
Confirm player access, instrument transport paths and rail clearance on site.

Ravel and Hisaishi are after intermission: their spare two timpani and second
snare are removed from the stage entirely, not merely marked parked. Their
stage-right percussion closes toward the primary timpani with reduced gaps,
preserving instrument order.
Both scenes use a single horizontal mallet row: glockenspiel, xylophone,
bowls and vibraphone from stage left to right, with chimes behind.
They share identical marks so no percussion moves between Ravel and Hisaishi.
Ravel uses Hisaishi's original violin seating and percussion arrangement, with
only glockenspiel, bowls, the primary four timpani, snare, crash cymbals, bass
drum and auxiliary table active in that stage-left-to-right order. Other
percussion remains parked. Microphones stay fixed.

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
The back row of the left section omits the three rightmost chairs for tech
booth clearance, reflected in the plan, PNG export, 3D view, and capacity totals.
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
capsule positions. An adjacent input patch list labels channels 1-28, including
the stereo keyboard DIs and speaking mic. Input 3 is reserved outside Barber.
The audience-facing **Auditorium plan** remains unchanged.
The top view places the audience below and stage right on the left.
Dimension labels, the introductory orientation sentence and footer legend are omitted from
the drawing; tier boundaries and stair-direction arrows remain visible.
The stage drawing fills a dedicated panel directly below the navigation.
The shared scene selector sits at the right of the navigation in stage-plan
and 3D views. Input totals remain in the patch panel, without a separate
input-count toolbar above the drawing.
The input patch uses channel badges, a fixed summary header and an independently
scrolling, keyboard-focusable list. On narrow screens the list sits below the
drawing and the page scrolls normally, keeping the full patch accessible.
Instrument footprints and microphone placement remain illustrative.
Production 2D and 3D include schematic stage-left stairs beside the harps,
ascending inward to the 5-foot tier, with an opening in the side railing.
This staircase has a 9-foot-2-inch run, 3-foot width, and ten 6-inch rises.
An additional staircase on the same side reaches the rearmost row of 6-foot
panels, centered 16 feet upstage of the existing stairs, with its own railing
opening. It has an 11-foot run, 3-foot width, and twelve 6-inch rises.
Both rear side-railing openings match the 3-foot stair width.
The frontmost 2-foot-8-inch apron has stairs on both sides, each 2 feet wide
with a 5-foot-6-inch run and six equal 5-1/3-inch rises.
The 32-inch apron has no railings.
All stairs use 11-inch tread depths. The tread depth and rear stair width
follow the published dimensions of [Wenger's Adjustable Height Stairway](https://shop.wengercorp.com/education/adjustable-height-stairway.html);
riser counts and runs remain modeling assumptions, not a verified Wenger
configuration or venue specification. Apron widths remain schematic.
These are not construction or code-compliance designs; confirm actual stairs,
landings and handrails with the venue.
Music stands are hidden in the production 2D view to reduce clutter; they remain
visible in 3D. Instrument bounds are projected into stage-local coordinates so
keyboards and percussion align with the same tiers as their 3D counterparts.
Both keyboards place black keys at the far edge of the white key bed, away
from the player's bench, with no white strip behind them.

## 3D microphone and navigation details

### Input channel numbering

The stage plan and 3D microphone and keyboard hover labels use this patch order.
Labels contain only source names; microphone techniques and setup guidance
remain in the placement notes below. The patch is fixed across all scenes:
input 3 is reserved outside Barber, and speech stays on input 28.
The 88-key instrument is assigned to piano; the 49-key instrument to keyboard.
Stereo inputs are listed left then right.

| Input | Source |
| --- | --- |
| 1-2 | Overheads L/R |
| 3 | Violin soloist |
| 4 | Violin 1 principal |
| 5 | Violin 2 principal |
| 6 | Viola principal |
| 7 | Cello principal |
| 8 | Bass principal |
| 9 | Violin 1 section |
| 10 | Violin 2 section |
| 11 | Viola / cello |
| 12-13 | Piano L/R |
| 14-15 | Keyboard L/R |
| 16 | Harp 1 |
| 17 | Harp 2 |
| 18 | Flutes / clarinets |
| 19 | Oboes / bassoons |
| 20 | Horns |
| 21 | Trumpets |
| 22 | Trombones |
| 23 | Tuba |
| 24-27 | Percussion 1-4 |
| 28 | Speech |

In Holst, input 23 is labeled **Tuba / euphonium** for the shared source.

Total: 23 microphones on 22 stands plus 4 DI channels = 27 console inputs
(input 3 is unused outside Barber). Barber adds its soloist mic and stand
for 28 console inputs.
The DI assignments label the existing instruments; separate DI boxes are not modeled.

### Microphone placement

Stage microphones are supported by tripod stands and visible poles/booms.
An SM58-style handheld speaking mic, with a black body and rounded silver
grille, rests on a straight stand 2 feet to the conductor's left of the music
stand (audience-left). It is available for pickup in every scene; a storage
box is not modeled. Input 28 stays assigned to speech in all scenes.
The main pair depicts side-address AKG C414 cardioids spaced horizontally
1 foot apart, each aimed 45 degrees inward across the orchestra by rotating
around the vertical axis. This is a spaced inward-facing crossed pair, not
coincident XY or outward-facing ORTF. Both bodies stand upright, with the black
body below the gray grille and no tilt. The active grille fronts define the
aiming directions.
Its stand rests directly on the stage behind the conductor, placing the pair
8 feet above the local stage deck, with no microphone riser.

First-desk violin and viola pencil mics extend above each string desk and angle
back toward the instruments, not the score. The principal cello mic (input 7)
sits close to the principal music stand, approximately 8 inches in front of its
upright toward the conductor, clear of the chairs. Its capsule is approximately 2 feet above the deck,
aimed back toward the players' instrument area. Input 8 sits 3.5 feet inward
(toward the conductor) from the midpoint of the two downstage bass stools,
clear of the space between them. Its low stand places the capsule approximately
2 feet above the deck, aimed back toward the stools and their shared instrument area.
Booms approach from in front along the desk's facing
direction rather than across it. First violins and cellos sit 9 inches farther
outward from the conductor, with their desks moving together to leave mic space.
The first-violin section mic remains directional. The former second-violin
section mic is a shared violin omni, with another shared omni between violas and
cellos. Both shared omnis (inputs 10 and 11) stand on the 4-foot platform at the
same Z baseline and stand height. These are recording/blend channels and cautious PA trials, not a promise
of equal section coverage or sufficient gain before feedback.
Two high wind mics reach over and aim down at the midpoint between the shifted
front and rear wind rows. Each harp retains a close condenser.
Four brass mics cover horns, trumpets, trombones and tuba independently.
The horn mic sits behind the rear horn row, aiming downstage toward the bells;
both horn rows are shifted 1 foot stage-right and each chair faces the conductor,
with individual music stands following the new orientation. The horn mic follows
the shifted section and aims at an estimated rear-row bell area.
Trumpet and trombone mics use straight upright stands without booms, with
capsules approximately 5 feet above the lower, 5-foot wind deck, preserving
their previous absolute height of 10 feet above the room floor.
Their bases sit at Z -63.2 feet, fully downstage of the step at Z -64.
The rear winds and their stands move 6 inches downstage, reducing wind-row
spacing to 3.1 feet. Trumpet, trombone and tuba chairs and stands also move
6 inches downstage, to Z -67.85 feet; the shared tuba/euphonium mic follows
those players on the 6-foot tier. Horns and percussion mics stay unchanged.
This is a trial layout, not confirmed player or instrument clearance.
Check actual stand-foot clearance,
percussion access, trombone slide space, balance and feedback at sound check;
the schematic does not establish a safe rigging or placement margin.
The tuba chair aligns with the trumpet/trombone row. Input 23 sits between
the tuba and fourth trombone chair, above the estimated upward-facing bells
and aimed down between them. In Holst, the fourth trombonist doubles on
euphonium and shares this microphone with tuba.
Instrument bodies are not modeled, so bell positions are illustrative and must
be adjusted to actual players and instruments during rehearsal.
Four separate percussion zone mics cover the rear instruments.
Inputs 24-27 use identical stand positions, heights and aim in every scene:
stage-right percussion, inner-right percussion/second timpani, central timpani,
and mallets respectively. Bases sit at Z -71 feet and X -19, -9, 2 and 18
feet, with poles 6 feet above the deck and short 6-inch upstage booms.
The first three aim toward Z -75.5 feet; the mallet mic aims toward
X 16, Z -73.5 feet. Its aim remains fixed; audition coverage of the
aligned mallet rows during rehearsal.
These broad zones deliberately avoid following individual instruments.
Greater distance also increases room/brass spill; one mallet mic may not
give uniform coverage across the full row. Confirm balance, feedback margin
and whether another mallet mic is needed during rehearsal.
These placements are flexible rehearsal starting points; use only needed
channels in the PA and check coverage, spill and phase.
Polar-pattern choices are described by hover labels/metadata, not simulated
acoustic pickup. Heights are relative to the supporting stage tier unless noted;
placement is illustrative, not an acoustic analysis.

Click or Tab-focus the 3D canvas to use WASD flight navigation: W/S move along
the view direction, A/D strafe, Q/E move down/up at 30 feet per second, and Shift
increases speed to 80 feet per second.
Left-drag looks around from a fixed camera position rather than orbiting a
distant target. Pitch is limited just short of straight up/down to avoid flips.
The cursor hides during an aiming drag and returns on release, cancellation,
or focus loss.
Shift+left-drag or right-drag pans with the cursor visible; scrolling zooms.
Ctrl/Command+left-drag also pans. The modifier is checked when the drag begins.
WASD/QE moves through the room.
A click without dragging still selects a seat or camera. Flight keys and
look gestures clear when focus is lost.
All camera movement, including look, pan, zoom, flight, and preset/seat
transitions, stays inside the room with a six-inch margin from the floor,
31-foot ceiling, and walls, including the upper-left cutout. Doors do not
permit camera travel outside. Overview uses an interior elevated rear-corner
position with a 65-degree field of view rather than an exterior room view.
These limits follow the room shell, not furniture or stage collisions.
In development only, the compact bottom-left coordinate guide shows red X, green Y, and blue Z arrows
that follow the camera orientation, without text labels or a room-size badge.
The guide is omitted from production builds.

The 3D stage and orchestra move together by 2 feet 3 inches from the upstage
wall. Audience rows use the 2D row pitch and section clearances, including
rearward-aligned center blocks. The room has the same upper-left cutout,
flush garage door, closed double doors, and adjoining tech/camera area.
Rear door swing direction is shown outward in 2D; 3D renders the doors closed.
The tech area uses desk and chair geometry rather than an opaque booth block.
Two short suspended lighting trusses sit above the front/middle audience break,
one on either side of center, matching the approximate overhead locations in
the supplied plan. Each carries four modeled fixtures aimed in overlapping warm
front and rear stage washes. These spotlights replace the global sun light.
The floor, opaque walls, doors and ceiling use baked indirect lightmaps with
three diffuse bounces, calculated on a roughly four-foot patch grid. The bake
includes the stepped room footprint and stage tiers as static reflectors and
occluders. Fixed FOH/stage-baseline light and the additional house-light output
are baked separately; the House lights slider mixes these contributions
without rebaking. Direct lights remain live, and a very small constant ambient
fill keeps navigation readable. Room outlines also dim with the house lights.
The FOH stage wash remains independent.
Four fixtures cast shadows.

Run `npm run bake:lighting` with Node.js 24+ after changing the static room,
stage tiers, or light layout/output. The deterministic CPU radiosity bake is
saved in `src/room-lighting-bake.json`; rendering only samples small lightmaps,
so no real-time GI pass or WebGPU migration is required. Run
`npm run test:lighting` to check the bake and dimmer composition.
Furniture, players, instruments and audience are deliberately excluded from
the bake so scene and attendance changes cannot leave baked-in chair shadows.
Those objects retain direct lighting and the minimal ambient fill; they do not
receive the room's baked bounce light. Specular interreflection, detailed
contact shadows and dynamic-object GI are not modeled. This is a soft-light
visualization, not a calibrated photometric or safety assessment.

Nine stage ceiling fixtures cover rear percussion, middle tiers, and the apron,
with three fixtures across each of three rows. They retain a baseline wash
at 0% and brighten to full output with the House lights slider.
Audience ceiling fixtures start at a dimmed wash (15% of their full house-light output). Fifteen audience
fixtures cover five rows from the front seating to the rear, with three fixtures
across each row. Stage and audience ceiling fixtures reach the same per-fixture
output at 100% to provide a bright house-light setting. Visible diffusers
reflect the same bright-stage/dim-house distinction. These additional downlights
do not cast shadows, to limit rendering cost, and apply to every piece scene.
Ceiling fixture locations and dimming levels are schematic, not venue specifications.
The 3D toolbar's **House lights** slider adjusts stage and audience ceiling-light
output and diffuser glow from 0 to 100%, starting at 15%. The front-of-house
stage wash is unaffected.
The level stays unchanged when switching piece scenes; 0% leaves ambient fill
and stage spill in place rather than making the entire audience area black.
Wheelchair floor markers use lit, shadow-receiving materials so they dim and
brighten with the room instead of remaining self-lit.
Stage ceiling coverage and output emphasize visibility of percussion and
instruments without increasing global exposure or the default audience wash.
Truss lengths, 27-foot trim height, fixture count, beam angles and output are
illustrative, not a surveyed rigging plan or a calibrated photometric simulation.
The combined 24-by-8-foot tech/camera platform is 3 feet high, with all desks,
chairs and camera equipment elevated together.
The production stage plan and 3D scene also include a compact DJI-style camera
on a slim upright pole at the center of the 4-foot tier, with its lens 6 feet
above the deck, facing the center winds and tilted 15 degrees upward.
The pole is a schematic mount, not a specified freestanding support design.
The same mount holds a landscape phone 3 inches below the DJI, facing the
opposite direction and aimed at the conductor's upper body. **Conductor phone**
selects its view; the phone model is also clickable. Its lens assumes a
26mm full-frame-equivalent main camera, pending the actual phone/lens choice.
Click the rear tech or onstage camera in 3D to transition
to its lens position. Camera views assume 16:9 video
with full-frame-equivalent lenses: rear tech 85mm for tighter stage framing. The onstage camera
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
sides of the 4-, 5-, and 6-foot tiers and the back of the stage. The 32-inch
apron is unrailed; the downstage front and internal tier edges remain open.
Winds, brass, and basses each have an individual music stand; other
strings share stands by desk. Bass stands face inward toward the conductor.
Violas have four pairs of chairs, each with a shared stand centered on the pair.
The unpaired outermost first violin and second violin players each have
a stand directly in front of their remaining chair rather than at a desk midpoint.
Bass stools sit 2.6 feet outward from their individual stand centers.
Brass chairs use 2.5-foot horizontal center spacing, with individual stands
aligned to each player and the rear horns staggered behind the front row.
Flutes, oboes, and clarinets also use 2.5-foot horizontal center spacing;
bassoons retain their 3-foot spacing.
Wind and brass chair centers follow straight row baselines without an automatic
rearward offset at the outer seats. Horn chairs still turn individually toward
the conductor; their row centers remain aligned with the rest of the front brass.
The front wind row retains its 12-inch setback; the rear row now has a
6-inch setback to make room for the lower-tier brass mic bases.
See the microphone placement notes for the trial brass positions.
The seating setbacks preserve microphone tripod positions; subsequent mic
revisions change aiming and wind boom reach. Stored rear percussion stays in place.
Both harps sit farther inward toward the winds, away from the stage-left
staircase: the inner harp moves 1 foot inward and the outer harp 1 foot 4 inches.
Their chairs, facing directions and close microphones follow the instruments
in every scene. Confirm the full player, instrument, cable and stair-access
clearances with the venue before setting up.
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
