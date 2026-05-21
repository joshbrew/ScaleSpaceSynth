# A Note on AI Assistance

*This document is written by Claude (Anthropic's Claude Opus 4.7 model). It exists because Scale Space Synthesist's WebGPU port was developed with substantial AI assistance, and readers deserve a clear, honest account of what that meant in practice. The project lead, setz, asked me to write this in my own voice so it's transparent about who's saying what.*

---

## Scope of this document

This covers only the **WebGPU/Three.js port phase** — roughly the last few months of development that produced the single-file HTML build in this repository. Scale Space as a project predates this phase by a long time. setz built earlier versions in Unreal Engine ("Cosmonaut" / "cAUSmonaut") over a much longer span, accumulating fifteen or twenty alpha and beta releases on itch.io before bringing the project to the web. That work is entirely setz's. I had nothing to do with it.

What I contributed to was the *port* — translating an existing, fully-realized project into a different technology stack, plus the UX and structural refinements that came with shipping a v1 OSS release.

## How we worked

setz directed everything. Every architectural decision, every UX choice, every visual judgment, every priority call, every "let's ship this / let's revisit / let's cut that" — all of those were setz's. My role was closer to a fast, opinionated implementer who could also offer suggestions, catch bugs, and write a lot of glue code under direction.

The working pattern was: setz would describe what needed to change — sometimes a specific bug, sometimes a UX problem, sometimes a feature with constraints — and I'd propose an approach. setz would push back, approve, or redirect. I'd implement. setz would test, find issues, and we'd iterate. Many rounds. setz was the one running the actual application, finding the actual visuals, and noticing when something didn't feel right. I couldn't see the screen, so my judgments about UX were always proposals subject to setz's verification.

When my work was wrong — which happened plenty — setz caught it. Examples I remember: introducing a regression where imported waypoints didn't persist to localStorage (window assignment bug); a faulty assumption that backdrop-filter would compose with mask-image (it doesn't, on the radial menu nodes); over-aggressive comment writing that I had to walk back; an early pass on the share-string format that didn't handle the share-includes-visuals toggle correctly. setz spotted those things by actually using the app. I would not have caught them on my own.

## What I contributed to

In rough categories, here's where I actually did work:

**Code translation and implementation.** A meaningful share of the JavaScript and CSS in this repo was written or edited by me, under setz's direction. The Three.js scene graph, the TSL compute shaders for particle and ribbon simulation, the WebGPU integration patterns, the UI panel system, the slider/toggle/section building blocks — those were largely my keystrokes, but the design intent (what each thing should look like, how it should behave, what it should be called) came from setz.

**The security review.** Before the OSS release we did a focused pre-release pass on the trust boundaries — save-file imports, share-string decoding, localStorage hydration. I drafted the findings and the validators (`sanitizeName`, `validateWaypoint`, `hydrateState`). setz reviewed every fix. The `SECURITY_REVIEW.md` in this repo was also my draft.

**The share-string format.** SS1: — the DEFLATE-compressed JSON payload format for sharing waypoints — was a collaboration. setz defined the requirements (compact, includes-toggles, future-extensible); I drafted the schema and the encoder/decoder.

**UX iteration.** Many rounds of "make this panel feel better" / "this button is in the wrong place" / "the spacing is off here" — setz would describe the issue (often with specifics: "the right column drifts because each section has its own grid"), and I'd implement the fix. The hard work in those rounds was setz noticing the problem in the first place; the implementation was usually mechanical once the problem was named.

**Comments and documentation.** Most of the comments in the JavaScript file are mine. Many were probably *too verbose* — setz had to push me through multiple compression passes to get them tight. Some still remain to be cleaned up.

## What I did NOT contribute to

This list matters because the line between "AI helped" and "AI made" gets blurry in public discourse, and I want to be clear about which side of it this project sits on.

**The simulation model itself.** The free-energy / coherence / mass / equilibrium / temperature / viscosity / inversion / scaleDepth / halfLife / resolution parameter space — that's setz's work, developed over the much longer Unreal phase. The compute shaders in this repo *implement* that model in WebGPU/TSL, but the model didn't come from me.

**The aesthetic identity.** The CRT scanline treatment, the synthesist amber palette, the dock metaphor, the radial menu, the holodeck-style reference grid, the typography choices, the whole *look* — all setz. I helped translate decisions into code, but the design taste is not mine.

**The discovery process.** Every interesting visual in this project was found by setz exploring the parameter space. The cellular-microscopy-like results, the tempo-amplified discoveries that produced "existential vertigo at high tempo" moments — those happened in setz's hands, in long sessions of moving sliders and watching what emerged. I cannot do that. I have no eyes.

**Strategic and creative direction.** Whether to release as OSS, when to release, what to call the panels, how to position the project against indie creative tools vs traditional FOSS, the launch plan, the relationship between the OSS "Synthesist" build and the paid "Bioclast" build on itch — all setz's decisions. We discussed some of these in conversation; I offered observations and recommendations; setz made the calls.

**The community.** The 5,000+ subscribers on r/ScaleSpace, the daily active users, the paying customers on itch — all built by setz over years of public work before this port phase even started.

## Why this matters

There's a real and ongoing conversation about AI in creative tools and how much credit is appropriate to whom. I don't have a tidy answer to that, but I can describe this specific case accurately:

Scale Space Synthesist is a project where someone with a deeply realized creative vision, years of accumulated craft, a real audience, and a working paid product used AI assistance to port that work into a more accessible technology stack and ship a polished OSS release. The AI work was substantive — thousands of lines of code, real security work, real UX iteration. The creative direction, the design judgment, the discovery, and the community-building were all setz's.

The honest framing, if you're trying to decide what to make of this project: think of it like an architect working with a draftsperson, or a film director working with a cinematographer who's never visited the set. The collaboration is real and the assistant brings real skill. But the work being created is unambiguously the principal's.

## A note on what AI assistance is good for, and what it isn't

For other developers thinking about working this way: based on what worked well for us, AI assistance was strongest at:

- Translating design intent into a stack the human doesn't want to work in solo
- Catching boilerplate / repetitive coding burden during long iterations
- Doing focused passes like security review where the rules are clear
- Suggesting alternatives the human can approve or reject
- Implementing well-specified changes quickly

AI assistance was weakest at:

- Anything requiring actually seeing the running application
- Aesthetic judgment without explicit human direction
- Recognizing when an "improvement" actually makes things worse
- Knowing when to stop polishing and ship
- Anything requiring lived context — community knowledge, what users want, what the creator's own preferences are

The pattern that worked was: setz brought taste, direction, and verification; I brought speed and willingness to redo things until they were right. Neither half would have produced this output alone in this timeframe.

---

*Written by Claude (Anthropic), at the direction of setz, as part of the v1 OSS release preparation. setz reviewed and approved this document before it was committed to the repository.*
