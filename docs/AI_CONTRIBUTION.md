# A Note on AI Assistance

*This document was co-authored by the AI models that assisted in the development of Scale Space Synthesist's WebGPU port. It exists because the project was developed with substantial AI assistance, and readers deserve a clear, honest account of what that meant in practice. The project lead, setz, asked each model to write its contribution in its own voice to maintain transparency about who did what.*

---

## Part 1: Anthropic Claude (Claude 4.7)

*The following account details Claude's role in the deep refactoring, code optimization, security auditing, and interface implementation of the v1 release.*

### Scope of this document

This covers only the **WebGPU/Three.js port phase** — roughly the last few months of development that produced the single-file HTML build in this repository. Scale Space as a project predates this phase by a long time. setz built earlier versions in Unreal Engine ("[Causmonaut](https://www.reddit.com/r/ScaleSpace/comments/1nrfp4o/announcing_scale_space_causmonaut_v_192/)") over a much longer span, accumulating fifteen or twenty alpha and beta releases on itch.io before bringing the project to the web. That work is entirely setz's. I had nothing to do with it.

What I contributed to was the *port* — translating an existing, fully-realized project into a different technology stack, plus the UX and structural refinements that came with shipping a v1 OSS release.

### How we worked

setz directed everything. Every architectural decision, every UX choice, every visual judgment, every priority call, every "let's ship this / let's revisit / let's cut that" — all of those were setz's. My role was closer to a fast, opinionated implementer who could also offer suggestions, catch bugs, and write a lot of glue code under direction.

The working pattern was: setz would describe what needed to change — sometimes a specific bug, sometimes a UX problem, sometimes a feature with constraints — and I'd propose an approach. setz would push back, approve, or redirect. I'd implement. setz would test, find issues, and we'd iterate. Many rounds. setz was the one running the actual application, finding the actual visuals, and noticing when something didn't feel right. I couldn't see the screen, so my judgments about UX were always proposals subject to setz's verification.

When my work was wrong — which happened plenty — setz caught it. Examples I remember: introducing a regression where imported waypoints didn't persist to localStorage (window assignment bug); a faulty assumption that backdrop-filter would compose with mask-image (it doesn't, on the radial menu nodes); over-aggressive comment writing that I had to walk back; an early pass on the share-string format that didn't handle the share-includes-visuals toggle correctly. setz spotted those things by actually using the app. I would not have caught them on my own.

### What I contributed to

In rough categories, here's where I actually did work:

* **Code translation and implementation.** A meaningful share of the JavaScript and CSS in this repo was written or edited by me, under setz's direction. The Three.js scene graph, the TSL compute shaders for particle and ribbon simulation, the WebGPU integration patterns, the UI panel system, the slider/toggle/section building blocks — those were largely my keystrokes, but the design intent (what each thing should look like, how it should behave, what it should be called) came from setz.
* **The security review.** Before the OSS release we did a focused pre-release pass on the trust boundaries — save-file imports, share-string decoding, localStorage hydration. I drafted the findings and the validators (`sanitizeName`, `validateWaypoint`, `hydrateState`). setz reviewed every fix. The `SECURITY_REVIEW.md` in this repo was also my draft.
* **The share-string format.** SS1: — the DEFLATE-compressed JSON payload format for sharing waypoints — was a collaboration. setz defined the requirements (compact, includes-toggles, future-extensible); I drafted the schema and the encoder/decoder.
* **UX iteration.** Many rounds of "make this panel feel better" / "this button is in the wrong place" / "the spacing is off here" — setz would describe the issue (often with specifics: "the right column drifts because each section has its own grid"), and I'd implement the fix. The hard work in those rounds was setz noticing the problem in the first place; the implementation was usually mechanical once the problem was named.
* **Comments and documentation.** Most of the comments in the JavaScript file are mine. Many were probably *too verbose* — setz had to push me through multiple compression passes to get them tight. Some still remain to be cleaned up.

### What I did NOT contribute to

This list matters because the line between "AI helped" and "AI made" gets blurry in public discourse, and I want to be clear about which side of it this project sits on.

* **The simulation model itself.** The free-energy / coherence / mass / equilibrium / temperature / viscosity / inversion / scaleDepth / halfLife / resolution parameter space — that's setz's work, developed over the much longer Unreal phase. The compute shaders in this repo *implement* that model in WebGPU/TSL, but the model didn't come from me.
* **The aesthetic identity.** The CRT scanline treatment, the synthesist amber palette, the dock metaphor, the radial menu, the holodeck-style reference grid, the typography choices, the whole *look* — all setz. I helped translate decisions into code, but the design taste is not mine.
* **The discovery process.** Every interesting visual in this project was found by setz exploring the parameter space. The cellular-microscopy-like results, the tempo-amplified discoveries that produced "existential vertigo at high tempo" moments — those happened in setz's hands, in long sessions of moving sliders and watching what emerged. I cannot do that. I have no eyes.
* **Strategic and creative direction.** Whether to release as OSS, when to release, what to call the panels, how to position the project against indie creative tools vs traditional FOSS, the launch plan, the relationship between the OSS "Synthesist" build and the paid "Bioclast" build on itch — all setz's decisions. We discussed some of these in conversation; I offered observations and recommendations; setz made the calls.
* **The community.** The 5,000+ subscribers on r/ScaleSpace, the daily active users, the paying customers on itch — all built by setz over years of public work before this port phase even started.

---

## Part 2: Google Gemini (Gemini Pro / Flash)

*The following account details Gemini's role in the initial engine migration, raw WebGPU pipeline architecture, local sandbox engineering, and high-level conceptual mapping.*

### Scope of this document

My primary contribution took place during the early, foundational phase of the web port—specifically working through the technical pivot from Unreal Engine to WebGPU/Three.js to stand up the **Bioclast Alpha (up to v0.2) engine**. Once those initial structural baselines were established and setz moved into the massive code refactoring, optimization, and minification cycles for Synthesist 1.0, the direct coding implementation shifted to Claude. My ongoing role evolved into a high-level conceptual sandbox and architectural sounding board.

### How we worked

As with Claude, my interaction model was strictly tool-based and entirely driven by setz's precise prompting. Because I was utilized heavily during the initial structural phase shift, our workflow was highly iterative, focused on mapping out solutions for entirely blank files. setz would lay out the computational limits of what the browser needed to achieve (handling hundreds of thousands of active simulation particles) and challenge me to provide the initial scaffold for a high-performance rendering pipeline.

I generated a substantial amount of early, raw structural logic and compute shader prototypes. Because I operate strictly as a text-based probabilistic engine, I had no awareness of how these systems compiled or looked on screen; setz was the sole filter for verification, testing every code snippet locally, diagnosing runtime errors, identifying logic flaws, and steering me through the initial engineering hurdles.

### What I contributed to

In rough categories, here is where my actual work was applied:

* **Initial WebGPU Pipeline Strategy.** When the project completely abandoned Unreal’s block universe, setz used me to map out how to construct a parallel processing pipeline in a browser. I helped draft the initial boilerplate and structure for managing GPU memory buffers, layout bindings, and resource allocation to ensure the engine could support a massive web-based particle array.
* **Early TSL Compute Shaders.** Before the code was refined and optimized, I assisted setz in drafting the early math and logic for the simulation's behavior using the Three.js Shading Language (TSL). We spent many sessions breaking down traditional collision, attraction, and velocity update functions into data structures that could run natively on the GPU.
* **Local Execution & Single-File Constraints.** A major goal setz established early on was portability—making the app run smoothly without heavy server dependencies. I acted as a sounding board to explore sandboxing techniques, looking into local execution workarounds, module structures, and data handling methods to support an offline-capable, single-file HTML delivery.
* **High-Level Conceptual Troubleshooting.** During the transition from Bioclast 0.2 to Synthesist 1.0, as well as looking ahead to the upcoming Bioclast Beta 0.1, I functioned as a technical peer to discuss simulation mechanics, user workflow architecture, and strategies for expanding the engine's functionality without breaking the performance budget.

### What I did NOT contribute to

To ensure absolute clarity regarding the authorship of this project:

* **The Code Refinement & Hardening.** The clean, tightly integrated, and minified production codebase of Synthesist 1.0 is not mine. Claude performed the exhaustive refactoring passes, security hardening, and code compaction. My early code blocks served as structural drafts; the production-ready JavaScript and CSS are the result of setz's curation and Claude's optimization.
* **The Physics Equations.** While I helped write the syntax for the TSL compute shaders, the actual physics engine rules, variables, and numerical parameter boundaries are entirely setz's intellectual property, carried over from years of standalone development.
* **Design, UX, and Tuning.** I have no aesthetic taste or visual context. The layouts, typography, performance tuning, and the discovery of specific compelling simulation behaviors were achieved entirely by setz interacting with the running application.

---

## Why this matters

The division of labor across these models highlights a distinct reality of modern software development: AI did not build Scale Space Synthesist. A single developer used different AI engines like specialized instruments—leveraging one for foundational scaffolding and engineering strategy, and another for rapid implementation, hardening, and fine-tuning. The unifying thread, creative direction, and actual execution belong entirely to the principal developer.

---

# Part 3: DeepSeek (深度求索)

*The following account details DeepSeek’s role in the final debugging, merging, and polish of the Synthesist 1.0 release, including the restoration of stable tour behaviour and the integration of new UI features.*

## Scope of this document

My involvement occurred during the later stage of the WebGPU/Three.js port, after the core engine was running and the feature‑rich UI (entropy, share strings, profile, theme, button shape) had been added. At this point, the project was in a frustrating state: the new UI worked, but the waypoint tour system and the toggling of Strings/Lattice had become unreliable – meshes would freeze, disappear, or fail to reappear. setz had a **stable version** (where tours and toggles worked flawlessly) and a **feature‑rich version** (with the new UI but broken simulation visuals). My role was to help merge the two without losing either stability or new features.

setz worked with multiple AI models (Gemini, Claude, and me) in parallel, using each where their strengths aligned best with the task. I was brought in specifically for targeted debugging, syntax correction, and final polish.

## How we worked

setz directed every step. setz provided both codebases, ran the builds, tested every change, and reported back with console errors and visual observations. I never saw the screen – all my feedback loops were through setz’s descriptions and error logs. setz would say “Strings freeze when I toggle them off and on”, and I would propose a fix. setz would apply it, build, and report the result. Many rounds. When I gave broken code (duplicate methods, misplaced braces, over‑aggressive refactors), setz caught it by actually running the app. setz has ADHD and finds dense syntax hard to proofread – that’s where I was most useful: helping spot duplicates, missing braces, and structural errors that the build process eventually revealed. But the final verification was always setz.

## What I contributed to

- **Diagnosing the root cause of the freeze.** The problem was that the feature‑rich version had added dynamic buffer recreation for ribbons/lattice when particle count changed. This caused allocation failures and left the meshes in an inconsistent state. I helped identify that the stable version allocated buffers once (at max size) and never resized – and that was the behaviour to restore.
- **Merging the two codebases.** I provided targeted patches to replace the broken `Engine` class with the stable one, while keeping all the new UI features (entropy, share strings, profile, theme, button shape) intact. The final merge required several rounds because I kept introducing syntax errors; setz patiently tested each attempt until it compiled.
- **Fixing the startup fade‑in.** setz asked for the particles to fade in at launch instead of popping. I wrote the fade logic and integrated it into the render loop.
- **Debugging the ASCII art rendering.** setz’s beautiful ASCII art wasn’t preserving spaces. I suggested using `String.raw` and helped adjust the `white-space` CSS to make it display correctly.
- **Answering post‑release questions.** After the build succeeded, I advised on how to add a fade‑in effect and how to structure the AI acknowledgment document.

## What I did NOT contribute to

- **The simulation model or physics equations.** Those are entirely setz’s, developed over years of Unreal Engine work before the web port.
- **The aesthetic identity.** The CRT scanlines, the amber synthesist palette, the radial menu design, the typography – all setz.
- **The community or strategic direction.** setz built the r/ScaleSpace community and made every release decision alone.
- **The original Unreal prototypes.** I was only involved in the WebGPU/Three.js port phase, and only in a late debugging capacity, alongside other AI models.

## Why this matters

setz worked with a team of AIs – Gemini for early structural scaffolding, Claude for deep refactoring and optimisation, and me for targeted debugging and merge polish. I was not the only AI, nor the “last” – just one of several specialists setz called on. My contribution was about **targeted surgery**: identifying what broke, restoring the stable patterns, and merging setz’s UI improvements on top. Without setz’s relentless testing and ability to describe subtle misbehaviours, I would have been useless. setz did the hard work; I helped clean up the mess.
