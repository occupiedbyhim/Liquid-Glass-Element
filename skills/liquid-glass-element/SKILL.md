---
name: liquid-glass-element
description: Transform any HTML element into Apple's Liquid Glass aesthetic using a dual-layer WebGL + CSS architecture. Applies physically accurate frosted glass blur, 3D edge refraction with organic pillow-bulge normals, Fresnel reflections, specular highlights, and sub-pixel anti-aliased edges.
---

# Liquid Glass Element

Apply Apple's Liquid Glass aesthetic to **any** HTML element. The effect combines CSS `backdrop-filter` frosted blur with a WebGL canvas that renders physically-based 3D edge bevels, refraction, Fresnel reflections, and specular highlights.

> See `references/shader-math.md` for the complete GLSL source and math breakdown.
> See `examples/login-panel/` for a fully working demo.

---

## Architecture Overview

The effect uses a **dual-layer rendering** approach:

| Layer | Technology | Responsibility |
|-------|-----------|----------------|
| **Background blur** | CSS `backdrop-filter` | Gaussian frosted-glass blur behind the element |
| **3D glass effects** | WebGL fragment shader | Edge bevels, refraction, Fresnel, specular highlights |

### How it works

1. The **CSS layer** (the target DOM element) sits at `z-index: 2` with `backdrop-filter: blur(...)` to create the frosted look.
2. A **WebGL `<canvas>`** sits at `z-index: 1` with `pointer-events: none`, rendering the 3D bevel/refraction/specular effects. It reads the target element's bounding rect each frame and passes it as a shader uniform.
3. The same background image is set on both `body` (CSS `background-image`) and loaded as a WebGL texture, so the shader can sample it for refraction offsets.

```
┌─────────────────────────────────────────┐
│  z:100  UI controls (sliders, etc.)     │
│  z:2    Target element (CSS blur)       │
│  z:1    WebGL canvas (bevel/specular)   │
│  z:0    body background-image           │
└─────────────────────────────────────────┘
```

---

## Step-by-Step Application Guide

Follow these steps to apply the Liquid Glass effect to any HTML element.

### Step 1 — Add the WebGL canvas

Insert a full-viewport canvas as a direct child of `<body>`, **before** the target element:

```html
<canvas id="glcanvas"></canvas>
```

Style it to cover the viewport, sit below the target element, and ignore pointer events:

```css
#glcanvas {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 1;
    pointer-events: none;
}
```

### Step 2 — Set the background image

The same image must appear in **two** places:

**CSS** (on `body`):
```css
body {
    background-image: url('your-image.jpg');
    background-size: cover;
    background-position: center;
}
```

**WebGL** (loaded as a texture):
```javascript
const image = new Image();
image.crossOrigin = "anonymous";
image.src = "your-image.jpg"; // Same URL as CSS
image.onload = function() {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
};
```

> **Critical**: The fragment shader must Y-flip the texture coordinate:
> `vec2 uv = vec2(st.x, 1.0 - st.y);`

### Step 3 — Apply glass CSS to the target element

Add these CSS properties to the target element. Use CSS custom properties for configurability:

```css
:root {
    --blur-amount: 35px;
    --glass-radius: 32px;
}

.your-element {
    /* Frosted blur */
    backdrop-filter: blur(var(--blur-amount));
    -webkit-backdrop-filter: blur(var(--blur-amount));

    /* Near-transparent background */
    background: rgba(255, 255, 255, 0.02);

    /* Glass borders — top edge brighter for light directionality */
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-top: 1px solid rgba(255, 255, 255, 0.4);

    /* Layered glass shadows */
    box-shadow:
        inset 0 0 20px rgba(255, 255, 255, 0.05),  /* inner glow */
        inset 0 1px 1px rgba(255, 255, 255, 0.4),   /* top edge catch */
        0 30px 60px rgba(0, 0, 0, 0.4),              /* deep shadow */
        0 15px 20px rgba(0, 0, 0, 0.2);              /* contact shadow */

    /* Shape */
    border-radius: var(--glass-radius);
    color: rgba(255, 255, 255, 0.9);

    /* Must sit above the WebGL canvas */
    z-index: 2;
    position: absolute; /* or fixed */
}
```

### Step 4 — Initialize the WebGL shader program

Get the WebGL context and compile the shader program. The vertex shader is a simple fullscreen quad pass-through. The fragment shader contains all the glass optics (see `references/shader-math.md` for the full source).

```javascript
const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl');

// Vertex shader: fullscreen quad
const vertexShaderSource = `
    attribute vec2 position;
    void main() {
        gl_Position = vec4(position, 0.0, 1.0);
    }
`;

// Fragment shader: see references/shader-math.md for full source
const fragmentShaderSource = `...`; // Paste from shader-math.md

// Compile, link, create program (standard WebGL boilerplate)
function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

const vs = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
const program = gl.createProgram();
gl.attachShader(program, vs);
gl.attachShader(program, fs);
gl.linkProgram(program);
gl.useProgram(program);
```

Create the fullscreen quad geometry:

```javascript
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1
]), gl.STATIC_DRAW);

const pos = gl.getAttribLocation(program, "position");
gl.enableVertexAttribArray(pos);
gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
```

### Step 5 — Pass element bounds as uniforms each frame

In the `requestAnimationFrame` render loop, read the target element's position and size and pass them to the shader:

```javascript
const u_resolution = gl.getUniformLocation(program, "u_resolution");
const u_panel_rect = gl.getUniformLocation(program, "u_panel_rect");
const u_panel_radius = gl.getUniformLocation(program, "u_panel_radius");
const u_time = gl.getUniformLocation(program, "u_time");

function render() {
    const dpr = window.devicePixelRatio || 1;

    // Resize canvas to match viewport
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Read element bounds
    const rect = document.querySelector('.your-element').getBoundingClientRect();

    gl.uniform2f(u_resolution, canvas.width, canvas.height);
    gl.uniform1f(u_time, performance.now() * 0.001);
    gl.uniform4f(u_panel_rect,
        rect.left * dpr, rect.top * dpr,
        rect.width * dpr, rect.height * dpr
    );
    gl.uniform1f(u_panel_radius, 32.0 * dpr);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
}
render();
```

### Step 6 — Enable premultiplied alpha blending

This is **critical** — without it the WebGL layer will render with black fringing:

```javascript
gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
```

---

## CSS Requirements (Complete Reference)

| Property | Value | Purpose |
|----------|-------|---------|
| `backdrop-filter` | `blur(var(--blur-amount))` | Frosted glass blur |
| `-webkit-backdrop-filter` | `blur(var(--blur-amount))` | Safari/Chrome support |
| `background` | `rgba(255, 255, 255, 0.02)` | Near-invisible fill for blur compositing |
| `border` | `1px solid rgba(255, 255, 255, 0.2)` | Subtle glass edge |
| `border-top` | `1px solid rgba(255, 255, 255, 0.4)` | Brighter top edge (directional light) |
| `box-shadow` | _(see Step 3)_ | Inner glow + deep shadow + contact shadow |
| `border-radius` | `32px` / `var(--glass-radius)` | Rounded corners matching the SDF |
| `z-index` | `2` | Above WebGL canvas |

---

## WebGL Shader Requirements (Summary)

The fragment shader implements these optical effects in order:

1. **SDF Geometry** — `sdRoundedBox(vec2 p, vec2 b, float r)` defines the panel shape
2. **Surface Normals** — Computed from the SDF gradient via finite differences
3. **Pillow Bulge** — Blended with SDF normals: `mix(sdfNormal, p / maxDim, 0.15)`
4. **Bevel Falloff** — Gaussian: `exp(-pow(max(0.0, -d) / 25.0, 2.0))`
5. **Refraction** — IOR offset: `surfaceNormal.xy * 0.03`
6. **Fresnel** — `pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.25 * tilt`
7. **Specular** — `pow(max(dot(R, V), 0.0), 32.0) * 0.4 * tilt`
8. **Anti-aliasing** — `smoothstep(1.0, -1.0, d)` for sub-pixel edges

> Full shader source with line-by-line explanations: `references/shader-math.md`

---

## Interactive Features (Optional)

### Draggable Panel

Add a `.drag-handle` element inside the target that covers its full area at `z-index: -1`:

```html
<div class="drag-handle" id="dragHandle"></div>
```

```css
.drag-handle {
    position: absolute;
    inset: 0;
    cursor: grab;
    border-radius: var(--glass-radius);
    z-index: -1;
}
.drag-handle:active { cursor: grabbing; }
```

Track mouse offsets on `mousedown`, update element position on `mousemove`.

### 8-Way Resizable Panel

Add `.resizer` elements for all 8 edges/corners:

```html
<div class="resizer r-top"></div>
<div class="resizer r-bottom"></div>
<div class="resizer r-left"></div>
<div class="resizer r-right"></div>
<div class="resizer r-tl"></div>
<div class="resizer r-tr"></div>
<div class="resizer r-bl"></div>
<div class="resizer r-br"></div>
```

Use spring-damper physics for a spongy resize feel:

```javascript
const SPRING  = 0.15;
const DAMPING = 0.75;

// Each frame:
let accel = (targetSize - currentSize) * SPRING;
velocity = (velocity + accel) * DAMPING;
currentSize += velocity;
```

### Blur Slider

Control the `--blur-amount` CSS variable with a range input:

```html
<input type="range" id="blurSlider" min="0" max="1" step="0.01" value="0.95">
```

```javascript
slider.addEventListener('input', () => {
    const blurPx = slider.value * 50;
    document.documentElement.style.setProperty('--blur-amount', `${blurPx}px`);
});
```

---

## Configurable Parameters

| Parameter | Default | CSS Variable | Description |
|-----------|---------|-------------|-------------|
| Blur amount | `35px` | `--blur-amount` | Frosted glass blur radius |
| Border radius | `32px` | `--glass-radius` | Corner roundness (must match shader) |
| Glass IOR | `0.03` | — | Refraction strength in shader |
| Bevel width | `25.0` | — | Gaussian falloff width in pixels |
| Pillow blend | `0.15` | — | Organic bulge vs. hard SDF normal |
| Fresnel power | `4.0` | — | Edge reflection falloff exponent |
| Fresnel intensity | `0.25` | — | Edge reflection brightness |
| Specular power | `32.0` | — | Highlight sharpness |
| Specular intensity | `0.4` | — | Highlight brightness |
| Spring constant | `0.15` | — | Spongy resize stiffness |
| Damping factor | `0.75` | — | Spongy resize damping |

---

## Checklist

Before considering the implementation complete, verify:

- [ ] `<canvas id="glcanvas">` exists in the DOM with `pointer-events: none`
- [ ] Same background image set on both CSS `body` and WebGL texture
- [ ] Target element has `backdrop-filter` and `-webkit-backdrop-filter`
- [ ] Target element `z-index` > canvas `z-index`
- [ ] Fragment shader Y-flips texture: `vec2(st.x, 1.0 - st.y)`
- [ ] GL blending enabled: `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)`
- [ ] Render loop reads `getBoundingClientRect()` and passes to uniforms
- [ ] Canvas resizes with `window.devicePixelRatio` for Retina displays
- [ ] `border-radius` in CSS matches `u_panel_radius` uniform in shader
