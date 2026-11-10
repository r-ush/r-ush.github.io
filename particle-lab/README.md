# Robot particles

A standalone prototype using the six supplied robot STLs (01–06). Open `index.html`
directly in a browser, or serve this repository and visit `/particle-lab/`.
The demo uses local files only; no CDN, install, build, tracking, or network API.

The page starts in **animation** mode. The three gripper/assembly pairs are
01 ↔ 02, 03 ↔ 04, and 05 ↔ 06. Use the **Connect to assembly / Extract gripper**
button or select a paired model to see the gripper rotate and scale into its
actual mounting position while the surrounding robot fades in. The reverse
transition extracts the gripper. Switching unrelated models (for example,
01 → 03) disperses the points before reconstructing the next shape.

For **05 ↔ 06**, the button becomes **Split into two hands / Merge into one
hand**. The right hand produces a mirrored counterpart, both remain visible
side by side briefly, and then shrink/rotate into their respective arm mounts.
The left copy uses a geometric reflection of the same surface samples, including
its normals. It is not another rotated right hand. Reversing the transition
retraces the split and restores the single-hand view.
The side-by-side stage mirrors across the current camera's horizontal axis, so
the two hands visibly match even if the model was spinning before selection.
Automatic spin pauses for this transition and resumes afterward.

Choose **pose editing** to rotate a model by dragging in screen space; Shift-drag
horizontally to twist it. Use the
Roll / Pitch / Yaw sliders or number fields for precise angles. Arrow keys rotate
the focused canvas; Shift-arrow keys twist it. Rotation, cycling, and scattering
are suspended while editing, so the visible orientation matches the export.

**Copy this model** exports its filename and angles; **Copy all six** exports
all six independent poses. Clipboard failure reveals and selects the same JSON
for manual copying. Poses are retained per model and saved in browser localStorage
when available, including for local HTML. If storage is unavailable, the UI says
that values are kept only in the current tab. **0°** resets only the selected pose.
The animation tab previews the chosen poses and resets the automatic spin to the
base angle whenever switching modes. The general reset keeps chosen base poses.

Angles are degrees on the original STL axes, right-handed fixed-axis X then Y
then Z: `R = Rz(yaw) * Ry(pitch) * Rx(roll)`. Zero means the original STL orientation.
The renderer's CAD-to-display axis conversion and fixed camera angle are separate
from these angles. `pose-math.js` converts screen-space dragging to that same
coordinate convention, so copies can be used directly as the future defaults.

All six models include the user's confirmed default poses in the
generated model metadata. Browser-saved edits take precedence, matched by the
full source filename rather than list position.
`tools/build_points.py` records these defaults and stable sampling seeds, so
regenerating the assets retains the child clouds and orientations.

- Each model rotates slowly while idle. Hover near its surface to scatter the
  particles; damped springs return them when the pointer moves away.
- Six model buttons select the shape. Automatic cycling waits 16 seconds per
  shape and pauses while interacting. Pointer scattering is suspended during a
  model transition so the attachment motion stays legible.
- Rotation, automatic cycling, speed, repulsion strength, and light/dark
  appearance can be controlled independently. Reset restores the current shape
  and the default motion settings.
- Touch and move works on mobile; vertical page scrolling remains available.
  Focus the canvas and use left/right arrows to change models, Space to pause.
- Reduced-motion preferences disable initial rotation and automatic cycling;
  the visitor can explicitly enable either. Hidden tabs stop rendering.

`models.js` holds 32,000 surface samples per model, quantized as signed 16-bit
positions and normals, about 3 MB total. Mobile uses an evenly distributed subset
of 16,000 samples. WebGL draws the particles; a reduced-density Canvas 2D renderer
is available if WebGL cannot be initialized. Springs are integrated on the CPU,
with substeps to handle irregular frame times.

Offline triangle registration locates each component in its parent STL. Models
02 and 04 share 12,000 particle identities with their child, restricted to
surfaces within 0.8 CAD units (millimeters for these files) of the parent mesh.
Their other 20,000 points describe the surrounding assembly. Model 06 instead
uses 9,000 matching samples for each hand and 14,000 context samples. Both hands
are registered independently against the actual assembly; the second match
includes a reflection and must be separate from the first hand's location.
Mirrored source/destination indices preserve parity so the 16,000-point mobile
subset retains the exact same left/right correspondences. The source CAD
versions differ slightly for 01/02 and 05/06; unmatched geometry fades across
the transition rather than being forced into the registered component.
`transitions.js` interpolates the component's rotation with quaternion slerp,
its scale uniformly, and its position linearly with easing. It transforms
normals separately and fades the surrounding context in/out. Interrupted
transitions use the currently visible shape and opacity as a scatter start.
The mirror copy changes handedness only while invisible, then fades in as a
rigid reflected hand. Invisible particles settle directly on their target so
spring inertia does not visibly flatten the reflected copy during its appearance.

To rebuild after editing the source STLs (requires Python, NumPy, and SciPy):

```powershell
python particle-lab/tools/register_parts.py
python particle-lab/tools/build_points.py
```

The first command recomputes `tools/part-transforms.json`; it can be skipped if
the meshes have not changed. The original STL files are read only during these
offline steps. `index.html`, `style.css`, `app.js`, `pose-math.js`,
`transitions.js`, and `models.js` are sufficient to run the demo.

## Homepage section and local preview

The local portfolio `../index.html` includes **Graspical Abstract** between the
profile/contact block and Research. It starts with end effectors 01, 03, and 05
in three independent views named ReC-Gripper, PALM-Gripper, and Robotic hand.
Each text-free on/off switch beside its model name switches only its own pair (01↔02,
03↔04, or 05↔06); the hand duplicates into a mirrored pair before docking.
The homepage uses the approved poses, independent of playground pose edits.
Model names jump to the matching ReC-Gripper and PALM-Gripper papers and the
Scooping Grasping with Robotic Hand project in the same page. Names and
Expand all / Collapse all share monochrome underlined text controls, with
small chevrons on model links and gray/charcoal system switches. Introductory text,
hover instructions, and model-state captions are omitted.

Idle rotation is 0.336 rad/s (twice the first homepage version). Particle diameter
is 25% larger, with extra enlargement during scattering. ReC/PALM alone target
the hand's displayed height at the approved starting pose (1.5114× and 1.5956×).
Systems target the largest existing system's projected longest side: ReC
1.2269×, PALM 1.5834×, and the dual-arm system 1.3×. The hand stays at 1×.
A cached rotation envelope limits enlargement only when needed to fit the
viewport, including narrow screens. Its constant scale prevents pulsing during
idle rotation. Display zoom interpolates during docking, without changing the
registered geometry or particle correspondences.

In system view, the registered gripper particles use the selected blue accent
(`#397de0`) while the surrounding assembly retains its original color. Both
hands receive the same accent. The color fades in/out with docking/extraction,
remains identifiable while hovering, and returns to the original single-model
color after extraction. WebGL and Canvas 2D both use the same component mask.
The accent is fixed; the temporary color comparison controls have been removed.

End effectors share one rotation clock and systems share another, using the
approved poses as the common front reference. Staggered toggles join the
destination group's current angle. The first half of docking holds the viewing
angle to preserve component mounting and the mirrored-hand split; the second
half gently scatters particles while aligning, then gathers them at the shared
angle. This fits within the existing 2.4/3.2-second transitions. Idle rotation
carries particle targets directly so spring lag cannot shift the viewing phase;
springs still control hover displacement. Pause, hidden tabs, collapsed sections,
and offscreen return preserve group synchronization.

The section is initially expanded; its heading and the portfolio's Expand all /
Collapse all controls toggle it. Collapsing immediately pauses rendering and
reopening retains model selection and rotation settings. Only this section
extends to 1060 px on desktop; the rest of the portfolio keeps its 900 px width.

Open `home-preview.html` directly in a browser for the **complete r-ush homepage**
with the new section in place, without the automatic CV popup. The generated
copy resolves assets against the repository root. No server, build, or internet connection is
needed for the interaction. The generated preview stays local and is ignored by
Git; the homepage component and its shared assets are part of the portfolio.

`pair-view.js` reuses `transitions.js` at 1.5× speed: 2.4 seconds for the gripper
pairs and 3.2 seconds for the mirrored-hand pair, in both directions. Each view
uses 16,000 points. `../assets/js/graspical-abstract.js` loads the shared data only
near the viewport and gives the three views a shared 30 fps schedule. Offscreen
views and hidden tabs sleep. Rotation starts enabled, including when reduced
motion is preferred; the rotation button can pause it at any time. Each system
button remains independently usable. Static
posters remain visible if interactive loading fails.

Regenerate the posters and the local preview from the actual homepage section:

```powershell
python particle-lab/tools/build_home_preview.py
```

`node particle-lab/tools/check_homepage.cjs` checks local-file script loading,
independent buttons, both directions of all three pairs, 1.5× timing, mirrored
point correspondence, hover, pause, visibility, rotation enabled by default, loading
failure, and context recovery using DOM/Canvas fixtures. It also checks that the
preview contains the same markup as the homepage; it is not a browser screenshot
test. The generated `home-preview.html` is ignored by Git.

`node particle-lab/tools/check_transitions.cjs` verifies all six directed pair
transitions, rigid component shape preservation, opacity and endpoint agreement,
mirrored point/normal correspondence, reverse merging, unrelated scattering,
interruptions, and desktop/mobile particle layouts. The
test uses a DOM/Canvas fixture; it does not claim browser visual verification.
