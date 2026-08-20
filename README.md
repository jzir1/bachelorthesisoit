@"
# Order-Independent Transparency: WebGL2 & WebGPU

Bachelor's thesis project comparing five order-independent transparency (OIT) rendering techniques in real time, built from scratch in vanilla JavaScript with **no external rendering libraries** — the WebGL2/WebGPU pipelines, glTF binary (.glb) parser, and orbit camera controls are all hand-written.

## What this is

Transparent geometry is normally rendered back-to-front, which requires sorting — expensive and error-prone for overlapping or interpenetrating meshes. OIT techniques solve this without per-triangle sorting. This project implements and benchmarks five of them side by side, on the same scenes, so their quality and performance trade-offs are directly comparable:

| Method | Backend | Idea |
|---|---|---|
| **Depth Peeling + Occlusion Queries** | WebGL2 | Peels transparent layers front-to-back one pass at a time; occlusion queries skip peeling once no more fragments remain |
| **Dual Depth Peeling + OQ** | WebGL2 | Peels from both front and back simultaneously, halving the number of passes needed for the same layer count |
| **Stochastic OIT** | WebGL2 | Approximates transparency via per-fragment stochastic sampling instead of exact layer accumulation |
| **Weighted Blended OIT** | WebGL2 | Single-pass approximation (McGuire & Bavoil) using weighted color/alpha accumulation — fast but approximate |
| **Linked-List OIT** | WebGPU | Per-pixel linked lists of fragments built with atomics, resolved and sorted in a compute/fragment pass |

## Live demo

![demo](docs/demo.gif)

## Benchmark

The built-in benchmark runs each method across 11 scenes at different screen resolutions, measuring both FPS and quality. Dedicated sub-benchmarks also isolate layer-cap trade-offs for depth peeling and dual depth peeling against an unlimited-layer reference.

Results and analysis are in the written thesis. This repo is the implementation and interactive tool behind it.

## Tech stack

- Vanilla JavaScript (ES modules), no bundler, no framework
- WebGL2 (GLSL) for four of the five OIT methods
- WebGPU (WGSL) for the linked-list method
- Hand-written binary glTF (.glb) loader — no three.js / babylon.js / gltf-loader.js

## Running locally

Needs a local server (ES module imports + fetch of ``.glb`` files don't work from ``file://``).
Then open ``http://localhost:8080``. For the WebGPU method, use a browser with WebGPU enabled (recent Chrome/Edge).

**Note:** ``models/`` contains real-world ``.glb`` assets used for benchmarking (~110MB total). Cloning the repo will pull all of them.

## Project structuremain.js # app entry point, scene/method switching
benchmark.js # automated benchmark harness
controls.js # hand-written orbit camera
glb_loader.js # binary glTF parser
math.js / mesh.js # small math + procedural mesh utilities
renderers/ # one file per OIT technique
scenes/ # procedural scene generators (spheres, coverage cubes)
shaders/webgl/ # GLSL shaders
shaders/webgpu/ # WGSL shaders
models/

## Author

Maksim Saprykin — bachelor's thesis, Faculty of Electrical Engineering, Czech Technical University in Prague (ČVUT FEL), Open Informatics — Computer Graphics and Games.