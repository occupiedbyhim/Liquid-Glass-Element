# Liquid Glass — Shader Math Reference

This document contains the complete GLSL fragment shader source code used by the Liquid Glass Element skill, with line-by-line mathematical explanations.

---

## Complete Fragment Shader Source

```glsl
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_image;

// Panel geometry: vec4(x, y, width, height) in device pixels
uniform vec4 u_panel_rect;
uniform float u_panel_radius;
```

### 1. Signed Distance Field — Rounded Box

```glsl
float sdRoundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
```

**Returns**: The signed distance from point `p` to a rounded rectangle with half-extents `b` and corner radius `r`.
- **d < 0**: Point is inside the shape
- **d = 0**: Point is exactly on the edge
- **d > 0**: Point is outside the shape

The `abs(p)` exploits the 4-fold symmetry of the rectangle. The `- b + r` shrinks the box to account for the corner rounding, and the final `- r` restores the correct distance.

---

### 2. SDF Gradient Normal

```glsl
vec2 getNormal(vec2 p, vec2 b, float r) {
    vec2 e = vec2(1.0, 0.0);
    float dx = sdRoundedBox(p + e.xy, b, r) - sdRoundedBox(p - e.xy, b, r);
    float dy = sdRoundedBox(p + e.yx, b, r) - sdRoundedBox(p - e.yx, b, r);
    if (length(vec2(dx, dy)) == 0.0) return vec2(0.0);
    return normalize(vec2(dx, dy));
}
```

**Purpose**: Computes the 2D surface normal via central finite differences of the SDF.

The gradient of the SDF always points in the direction of steepest distance increase, which is perpendicular to the isosurface — i.e., the surface normal. We sample the SDF at `p ± (1, 0)` and `p ± (0, 1)` to get the partial derivatives `∂d/∂x` and `∂d/∂y`.

At the exact center of the rectangle (`d << 0`), the gradient is zero, so we return `(0, 0)` to avoid division by zero.

---

### 3. Cover UV (Aspect-Correct Sampling)

```glsl
vec2 coverUv(vec2 uv) {
    vec2 s = u_resolution.xy;          // Screen size
    vec2 i = vec2(1920.0, 1080.0);     // Image native resolution
    float rs = s.x / s.y;
    float ri = i.x / i.y;
    vec2 new = rs < ri
        ? vec2(i.x * s.y / i.y, s.y)
        : vec2(s.x, i.y * s.x / i.x);
    vec2 offset = (rs < ri
        ? vec2((new.x - s.x) / 2.0, 0.0)
        : vec2(0.0, (new.y - s.y) / 2.0)) / new;
    return uv * s / new + offset;
}
```

**Purpose**: Replicates CSS `background-size: cover` in the shader. Scales and centers the texture so it fills the viewport without stretching, cropping the excess along one axis.

---

### 4. Main Fragment Shader

```glsl
void main() {
    vec2 st = gl_FragCoord.xy / u_resolution.xy;
    vec2 uv = vec2(st.x, 1.0 - st.y);  // Y-flip for texture
```

**Critical Y-Flip**: WebGL's `gl_FragCoord.y` increases upward, but textures and CSS both increase downward. Without this flip, the refracted background would appear upside-down inside the glass.

---

#### 4a. Panel Setup

```glsl
    vec2 pCenter = u_panel_rect.xy + u_panel_rect.zw * 0.5;
    pCenter.y = u_resolution.y - pCenter.y;
    vec2 p = gl_FragCoord.xy - pCenter;
    vec2 halfSize = u_panel_rect.zw * 0.5;
    float radius = u_panel_radius;
    float d = sdRoundedBox(p, halfSize, radius);
```

Converts the panel rect (in CSS top-left coordinates) to WebGL center coordinates, then evaluates the SDF.

---

#### 4b. Gaussian Bevel Falloff

```glsl
    float tilt = exp(-pow(max(0.0, -d) / 25.0, 2.0));
```

**The Gaussian**: This is the key to seamless edge blending.

$$\text{tilt} = e^{-\left(\frac{\max(0, -d)}{25}\right)^2}$$

- At the edge (`d = 0`): `tilt = exp(0) = 1.0` — full bevel
- 25px inside (`d = -25`): `tilt = exp(-1) ≈ 0.37` — significant falloff
- 50px inside (`d = -50`): `tilt = exp(-4) ≈ 0.018` — virtually zero

The Gaussian has **infinite support** (it never truly reaches zero), which means there is no hard cutoff line — the bevel fades to nothing imperceptibly. This eliminates the visible "seam" that simpler linear or smoothstep falloffs produce.

The `max(0, -d)` ensures the falloff only applies inside the shape (where `d < 0`).

---

#### 4c. Organic Pillow Bulge

```glsl
    vec2 normal2D = getNormal(p, halfSize, radius);

    vec2 pillowNormal = p / max(halfSize.x, halfSize.y);
    normal2D = normalize(mix(normal2D, pillowNormal, 0.15));
```

**Problem**: On perfectly straight edges, the SDF gradient points in a single fixed direction (e.g., straight up along the top edge). This causes uniform refraction that "flattens" the image.

**Solution**: We blend in a **pillow normal** — the normalized position vector from the center, simulating a convex spherical surface. At 15% blend, this adds a subtle organic curvature to straight edges without distorting the round corners (where the SDF normal is already curved).

$$\mathbf{n}_{2D} = \text{normalize}\left(0.85 \cdot \mathbf{n}_{SDF} + 0.15 \cdot \frac{\mathbf{p}}{\max(w, h)}\right)$$

---

#### 4d. 3D Surface Normal

```glsl
    vec3 surfaceNormal = normalize(vec3(normal2D * tilt, 1.0 - tilt * 0.5));
```

Promotes the 2D normal to 3D. The Z component increases as tilt decreases (towards the center), making the surface progressively face the viewer — i.e., the center of the glass is flat, the edges are tilted.

---

#### 4e. Refraction

```glsl
    float glassIOR = 0.03;
    vec2 refrOffset = surfaceNormal.xy * glassIOR;
    vec2 refrUv = uv - refrOffset;
    vec3 glassColor = getBackground(refrUv);
```

Offsets the texture sampling coordinate by the surface normal, scaled by the Index of Refraction. This creates the lensing distortion visible at the edges of the glass.

At `IOR = 0.03`, the maximum offset is ~3% of the screen, which produces a subtle, realistic distortion.

---

#### 4f. Fresnel Reflections

```glsl
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    float fresnel = pow(1.0 - max(dot(surfaceNormal, viewDir), 0.0), 4.0);
    glassColor += fresnel * 0.25 * tilt;
```

**Schlick's Approximation** of the Fresnel equation:

$$F = (1 - \cos\theta)^4$$

Where $\theta$ is the angle between the surface normal and the view direction. At grazing angles (edges), $\cos\theta \to 0$ and $F \to 1$, creating the bright rim of light that real glass exhibits.

Multiplied by `tilt` so it only appears on the beveled edge, not the flat center.

---

#### 4g. Specular Highlights

```glsl
    vec3 lightDir = normalize(vec3(-1.0, 1.0, 1.0));
    vec3 reflectDir = reflect(-lightDir, surfaceNormal);
    float specular = pow(max(dot(reflectDir, viewDir), 0.0), 32.0);
    glassColor += specular * 0.4 * tilt;
```

**Phong specular** with exponent 32 (sharp highlight):

$$S = \left(\max(\mathbf{R} \cdot \mathbf{V}, 0)\right)^{32}$$

The light comes from the upper-left (`-1, 1, 1`), creating a bright specular catch on the top-left bevel of the glass.

---

#### 4h. Tinting & Anti-Aliasing

```glsl
    glassColor *= mix(1.0, 0.8, tilt);
    float alpha = smoothstep(1.0, -1.0, d);
    gl_FragColor = vec4(glassColor, alpha);
```

**Tinting**: The edges are darkened by 20% (`mix(1.0, 0.8, tilt)`) to simulate light absorption through thicker glass at the bevel.

**Anti-aliasing**: `smoothstep(1.0, -1.0, d)` produces a cubic hermite curve:

$$\alpha = 3t^2 - 2t^3 \quad \text{where} \quad t = \frac{1 - d}{2}$$

This transitions from 0 to 1 over exactly 2 pixels centered on the edge (`d = 0`), producing microscopically smooth anti-aliasing with no jagged steps.

---

## Parameter Tuning Guide

| Parameter | Location | Range | Effect |
|-----------|----------|-------|--------|
| **glassIOR** | `float glassIOR = 0.03` | `0.01 – 0.10` | Higher = more edge distortion |
| **Bevel sigma** | `/ 25.0` in Gaussian | `10.0 – 50.0` | Higher = wider, softer bevel |
| **Pillow blend** | `mix(..., 0.15)` | `0.0 – 0.3` | Higher = more organic curvature on straight edges |
| **Fresnel power** | `pow(..., 4.0)` | `2.0 – 6.0` | Higher = tighter rim glow |
| **Fresnel intensity** | `* 0.25` | `0.1 – 0.5` | Higher = brighter rim |
| **Specular power** | `pow(..., 32.0)` | `8.0 – 128.0` | Higher = sharper highlight |
| **Specular intensity** | `* 0.4` | `0.1 – 0.8` | Higher = brighter highlight |
| **Tint darkening** | `mix(1.0, 0.8, tilt)` | `0.6 – 1.0` | Lower second value = darker edges |
| **AA width** | `smoothstep(1.0, -1.0, d)` | `(0.5, -0.5)` to `(2.0, -2.0)` | Wider = softer edges |
