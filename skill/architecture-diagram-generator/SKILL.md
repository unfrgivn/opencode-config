---
name: architecture-diagram-generator
description: Create clean, readable architecture diagrams, infrastructure diagrams, service maps, network diagrams, security boundary diagrams, deployment diagrams, and flowcharts as responsive SVG artifacts. Use whenever the user asks for a system visual, wants a codebase turned into a diagram, wants existing diagrams simplified, or needs docs-friendly diagrams that avoid iframe scrolling and crowded text.
---

# Architecture Diagram Generator

Create calm, sparse, docs-friendly SVG diagrams that explain a system quickly.

## Core Mandate

Default to **responsive SVG**, not iframe-based HTML. The diagram must fit its container without horizontal scrolling.

Use `assets/template.svg` as the starting style. Copy the structure and customize the SVG. If the user explicitly needs a standalone browser file, wrap the SVG in simple HTML, but the diagram itself must remain a single responsive SVG.

## Diagram Style

Match the provided examples:

- Light background, soft pastel fills, medium-contrast strokes.
- Dashed rounded containers for zones, trust boundaries, sandboxes, external services, and regions.
- Large spacing, generous margins, and obvious left-to-right or top-to-bottom flow.
- Short labels inside boxes. Details belong in nearby callouts or page text, not crammed into nodes.
- Few colors, used semantically and consistently.
- No legends unless they remove ambiguity. Prefer direct labels on zones and nodes.
- Child nodes must be fully contained by their parent zone, with at least 24px inner padding from every parent boundary. Do not let boxes, labels, or arrowheads spill outside their containing region.
- Flow lines should not cross when objects can be rearranged to avoid it. Move destination zones or nodes before accepting crossing arrows.
- Edge labels must be useful, short, horizontal, and readable. Preserve helpful labels when they clarify protocol, policy, or branch meaning, but place them correctly.
- Prefer no edge label when the connected nodes already explain the flow. Do not delete a helpful label just to avoid placement work.
- Never place text directly above, below, or across an arrow path. Labels need clear whitespace on all sides and must not visually touch the line.
- Never rotate or tilt edge labels. Keep all diagram text horizontal unless the user explicitly asks for a stylized diagram.
- Arrows should be straight or gently curved whenever possible. Avoid awkward elbows when moving a node slightly would make the path direct.
- Arrowheads must point naturally into the target object, generally toward the center of the target edge they enter, not turn perpendicular at the last second.
- Arrows should originate from the side of the source facing the target, usually from a center-side attachment point or a shared junction close to that side.
- Arrows should enter the side of the target facing the source. If the source is left of the target, enter the target's left side, not its top or bottom.
- Straight or orthogonal line segments must not overlap directly with unrelated line segments. If two lines share a route, make it an intentional shared trunk with clear branch points.
- Multiple flows that end at the same target location should merge into one shared trunk. Feeder lines must not have arrowheads; only the final trunk segment into the destination carries the arrowhead.
- Arrows must route around child boxes. They may cross parent/boundary containers, but must not run over component boxes, labels, or child-node interiors.

## Readability Rules

Hard limits unless the user explicitly asks for depth:

- 5 to 9 primary nodes per diagram.
- 1 to 3 words for node titles where possible.
- At most one short subtitle line per node.
- At most 3 bullet lines inside any large container.
- At most 2 edge labels per diagram, only for meaningful protocols or decision branches. Most diagrams should have zero edge labels.
- Minimum 36px gap between boxes, 56px preferred.
- Zero crossing arrows by default. If a crossing is unavoidable, use one clear bridge/gap treatment and keep it away from labels.
- Use multiple diagrams instead of one mega-diagram when the system has more than 9 important nodes.

If the source architecture is complex, split into focused views:

1. System topology
2. Request flow
3. Access or credential boundary
4. Data lifecycle
5. Operations or governance

## Workflow

1. Extract the story first.
   - Identify the one thing the diagram must teach.
   - Remove components that do not support that story.
   - Choose topology, flowchart, trust-boundary, lifecycle, or sequence-like flow.

2. Plan before drawing.
   - Group nodes into 2 to 4 zones.
   - Decide primary flow direction.
   - Place target zones to make arrows short, direct, and non-crossing.
   - Use straight lines first, shallow curves second, and elbow/orthogonal routes only when they clarify a real branch or avoid an obstacle.
   - Merge same-target flows into a shared trunk before the target.
   - Route paths through whitespace around child nodes, even if that means crossing a dashed parent boundary.
   - Put high-volume detail in surrounding prose, not the SVG.
   - Use a second SVG if readability would suffer.

3. Build a responsive SVG.
   - Use `viewBox` and `width="100%" height="auto"`.
   - Do not set a fixed pixel width that forces horizontal scroll.
   - Avoid foreignObject unless the target renderer is known to support it.
   - Prefer inline SVG text with explicit line breaks.

4. Validate visually.
   - No overlaps.
   - Every child node is fully inside its parent zone with visible inner padding.
   - No clipped arrowheads.
   - Text is readable at typical docs width.
   - The diagram still makes sense if viewed quickly for 5 seconds.

## Output Contract

Default output:

- One or more `.svg` files with descriptive names, for example `dispatch-flow.svg`.
- If placing in a Docusaurus site, put SVGs under `static/img/diagrams/` and embed with Markdown image syntax or inline JSX, not iframe.
- If replacing old standalone HTML diagrams, remove iframe usage and update docs to reference SVG assets.

Only create `.html` when the user specifically asks for a standalone HTML artifact.

## SVG Conventions

Use this visual vocabulary:

| Purpose | Fill | Stroke |
| --- | --- | --- |
| Trigger/input | `#FFE4BC` | `#B86B3D` |
| Control/API | `#FFF3BF` | `#A66B1F` |
| Sandbox/runtime | `#EAF4FF` | `#3659A8` |
| Agent/app | `#DCD4FF` | `#6D36C6` |
| Proxy/gateway | `#4F7FE5` | `#2751A8` |
| Data/store | `#9FC7F3` | `#315F92` |
| External service | `#B9F1D0` | `#2E7D61` |
| Denied/error | `#FFD9D9` | `#B94D4D` |

Typography:

- Prefer a readable mono or rounded sans: `ui-monospace`, `SFMono-Regular`, `Menlo`, `Consolas`, monospace.
- Node titles: 16 to 22px.
- Zone labels: 15 to 18px.
- Small notes: 12 to 14px.
- Avoid all-caps except tiny eyebrow labels.

Shapes:

- Primary nodes: rounded rectangles, `rx="10"` to `rx="18"`.
- Zones: rounded rectangles with `stroke-dasharray="8 8"` and low-opacity fill.
- Decision points: diamonds only when an actual branch exists.
- Arrows: simple lines or shallow paths, 2 to 3px stroke, muted color. The final segment should enter the target cleanly from the expected side.
- Shared-trunk arrows: feeder lines should join the trunk cleanly, without markers. The arrowhead belongs at the destination edge, not in the middle of the path.
- Edge labels: 1 to 2 short words, or two stacked horizontal lines. Offset labels from the path by at least 18px and verify no part of the label intersects the arrow stroke.

## Arrow Routing Rules

Choose arrow style by situation:

1. Direct straight arrow
   - Use when source and target have clear line of sight.
   - Prefer for adjacent boxes in the same row or column.

2. Gentle curve
   - Use when it improves visual flow and does not cross child boxes, labels, or other arrows.
   - Use for one-to-many fanout only when the curve stays in open whitespace.

3. Orthogonal right-angle route
   - Use when another child box sits between source and target.
   - Route through open lanes between rows and columns.
   - Keep bends minimal, usually no more than two 90-degree turns.

4. Shared trunk
   - Use when multiple sources go to the same destination.
   - Feeder lines have no arrowheads.
   - The single trunk arrowhead lands at the destination edge.

## Lane Discipline

Before drawing arrows:

- Arrange nodes on an invisible grid.
- Reserve whitespace lanes between rows and columns for arrows.
- Route arrows through lanes, not across child boxes.
- If no clean lane exists, move nodes or split the diagram.

## Arrow Attachment

- Arrows should enter the side of the target facing the source.
- Do not aim arrows at corners unless the geometry naturally requires it.
- Avoid arrowheads landing near text inside a node.
- Prefer center-left, center-right, top-center, or bottom-center attachment points.
- Fan-out arrows should leave from a clean source-side junction, then branch into separated lanes. Do not make branches appear to originate from random points around the source box.

## Curves vs Right Angles

Use curves for visual flow, but do not force them. If a curve must arc around multiple objects or creates a huge loop, use an orthogonal route instead.

Bad:

- giant rainbow arcs across the diagram
- curves that pass over child boxes
- curves that make the eye travel backward

Good:

- short curves between nearby nodes
- right-angle routes around obstacles
- trunk-and-branch routing for fan-in/fan-out

## Final Routing Check

Before finishing:

- No arrow crosses a child box.
- No arrow crosses node text.
- No label intersects an arrow.
- No arrowhead appears in the middle of a merged path.
- Outbound arrows originate from the correct side of the source.
- Inbound arrows enter the side of the target facing the source.
- No straight segments overlap ambiguously unless they are an intentional shared trunk.
- No avoidable crossing remains.
- If the routing looks clever, simplify it.

## Anti-Patterns

Do not produce:

- Dense everything-diagrams.
- Tiny 7px labels.
- Long paragraphs inside boxes.
- Legends that duplicate obvious labels.
- Dark neon dashboards unless requested.
- `iframe` embeds for docs pages.
- SVGs with `min-width` that trigger horizontal scrolling.
- Scrolling containers inside a diagram.
- Diagonal arrows crossing other arrows because the nodes were placed lazily.
- Edge labels rotated over boundaries, printed directly on paths, or hidden behind background badges.
- Edge labels that sit between a source and target when the arrow passes through the same visual space. Move the label to whitespace or delete it.
- Bent arrows with a needless dogleg when a straight line or gentle curve would work.
- Arrowheads aimed sideways into a top/bottom edge, or vertically into a side edge, unless that direction is semantically important.
- Child boxes protruding outside parent containers, even by a few pixels.
- Multiple arrowheads stacked into the same target point when a merged trunk would be clearer.
- Arrows drawn across child component boxes or their text.

## Revision Behavior

When the user says a diagram is busy, do not merely shrink text. Redesign it:

- Remove nodes.
- Split into multiple diagrams.
- Replace text paragraphs with labels.
- Increase spacing and viewBox dimensions.
- Convert HTML/iframe artifacts into SVG assets.
