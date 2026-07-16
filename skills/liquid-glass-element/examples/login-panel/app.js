// WebGL Setup
const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl');

if (!gl) {
    console.error("WebGL not supported");
}

const vertexShaderSource = `
    attribute vec2 position;
    void main() {
        gl_Position = vec4(position, 0.0, 1.0);
    }
`;

const fragmentShaderSource = `
    precision highp float;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform sampler2D u_image;
    
    // Panel
    uniform vec4 u_panel_rect;
    uniform float u_panel_radius;

    // Helper: Exact Signed Distance Field for a Rounded Box
    float sdRoundedBox(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
    }

    // Calculates the gradient of the SDF to get the 2D surface normal
    vec2 getNormal(vec2 p, vec2 b, float r) {
        vec2 e = vec2(1.0, 0.0);
        float dx = sdRoundedBox(p + e.xy, b, r) - sdRoundedBox(p - e.xy, b, r);
        float dy = sdRoundedBox(p + e.yx, b, r) - sdRoundedBox(p - e.yx, b, r);
        if (length(vec2(dx, dy)) == 0.0) return vec2(0.0);
        return normalize(vec2(dx, dy));
    }

    // Cover UV to maintain aspect ratio (like background-size: cover)
    vec2 coverUv(vec2 uv) {
        vec2 s = u_resolution.xy;
        vec2 i = vec2(1920.0, 1080.0); // Image native resolution
        float rs = s.x / s.y;
        float ri = i.x / i.y;
        vec2 new = rs < ri ? vec2(i.x * s.y / i.y, s.y) : vec2(s.x, i.y * s.x / i.x);
        vec2 offset = (rs < ri ? vec2((new.x - s.x) / 2.0, 0.0) : vec2(0.0, (new.y - s.y) / 2.0)) / new;
        return uv * s / new + offset;
    }

    // Real Image Background Generator
    vec3 getBackground(vec2 uv) {
        vec2 texUv = coverUv(uv);
        texUv = clamp(texUv, 0.0, 1.0);
        
        vec3 col = texture2D(u_image, texUv).rgb;
        return col;
    }

    void main() {
        vec2 st = gl_FragCoord.xy / u_resolution.xy;
        vec2 uv = vec2(st.x, 1.0 - st.y); // CORRECT Y-FLIP FOR TEXTURE
        
        // --- Panel ---
        vec2 pCenter = u_panel_rect.xy + u_panel_rect.zw * 0.5;
        pCenter.y = u_resolution.y - pCenter.y;
        vec2 p = gl_FragCoord.xy - pCenter;
        vec2 halfSize = u_panel_rect.zw * 0.5;
        float radius = u_panel_radius;
        float d = sdRoundedBox(p, halfSize, radius);
        
        if (d > 1.0) {
            // Completely transparent outside the glass panels so the CSS background shows through
            gl_FragColor = vec4(0.0);
        } else {
            // We are inside one of the glass panels
            
            // Gaussian falloff for the bevel so it blends completely unnoticeably into the flat center
            float tilt = exp(-pow(max(0.0, -d) / 25.0, 2.0));
            
            // 2D Normal from SDF gradient
            vec2 normal2D = getNormal(p, halfSize, radius);
            
            // Blend in an organic 'pillow' bulge to prevent the straight edges from looking flattened
            vec2 pillowNormal = p / max(halfSize.x, halfSize.y);
            normal2D = normalize(mix(normal2D, pillowNormal, 0.15));
            
            // 3D surface normal
            vec3 surfaceNormal = normalize(vec3(normal2D * tilt, 1.0 - tilt * 0.5));
            
            // --- Refraction ---
            float glassIOR = 0.03; // slightly reduced for a natural look
            vec2 refrOffset = surfaceNormal.xy * glassIOR;
            vec2 refrUv = uv - refrOffset; // Using correct Y-flipped UV
            vec3 glassColor = getBackground(refrUv);
            
            // --- Lighting ---
            vec3 viewDir = vec3(0.0, 0.0, 1.0); 
            float fresnel = pow(1.0 - max(dot(surfaceNormal, viewDir), 0.0), 4.0);
            glassColor += fresnel * 0.25 * tilt;
            
            vec3 lightDir = normalize(vec3(-1.0, 1.0, 1.0));
            vec3 reflectDir = reflect(-lightDir, surfaceNormal);
            float specular = pow(max(dot(reflectDir, viewDir), 0.0), 32.0);
            glassColor += specular * 0.4 * tilt;
            
            // Seamless tinting
            glassColor *= mix(1.0, 0.8, tilt);
            
            // Microscope-perfect anti-aliasing using a cubic hermite smoothstep
            float alpha = smoothstep(1.0, -1.0, d);
            
            gl_FragColor = vec4(glassColor, alpha);
        }
    }
`;

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

const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

const program = gl.createProgram();
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
gl.linkProgram(program);

// Fullscreen quad
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1.0, -1.0,
     1.0, -1.0,
    -1.0,  1.0,
    -1.0,  1.0,
     1.0, -1.0,
     1.0,  1.0
]), gl.STATIC_DRAW);

const positionLocation = gl.getAttribLocation(program, "position");
gl.enableVertexAttribArray(positionLocation);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

// Setup texture with the same image as CSS background
const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

const image = new Image();
image.crossOrigin = "anonymous";
image.src = "https://images.unsplash.com/photo-1511497584788-876760111969?ixlib=rb-4.0.3&auto=format&fit=crop&w=1920&q=80";
image.onload = function() {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
};

// Uniforms
gl.useProgram(program);
const u_resolution = gl.getUniformLocation(program, "u_resolution");
const u_time = gl.getUniformLocation(program, "u_time");
const u_image = gl.getUniformLocation(program, "u_image");

// Panel Uniforms
const u_panel_rect = gl.getUniformLocation(program, "u_panel_rect");
const u_panel_radius = gl.getUniformLocation(program, "u_panel_radius");

gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.uniform1i(u_image, 0);

// Blending for the WebGL canvas over the CSS background
gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // Premultiplied alpha

// UI and Physics State
const loginPanel = document.getElementById('loginPanel');
const dragHandle = document.getElementById('dragHandle');
const resizeHandle = document.getElementById('resizeHandle');
const opacitySlider = document.getElementById('opacitySlider');

let panelState = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    width: 360,
    height: loginPanel.offsetHeight || 400
};

setTimeout(() => { 
    panelState.height = loginPanel.offsetHeight; 
    targetHeight = panelState.height;
}, 100);

let isDragging = false;
let isResizing = false;
let resizeDir = '';
let dragOffsetX = 0;
let dragOffsetY = 0;
let resizeStartX, resizeStartY, startWidth, startHeight, startX, startY;

// Spongy Resize Physics State
let targetWidth = panelState.width;
let targetHeight = panelState.height;
let vw = 0;
let vh = 0;
const SPRING = 0.15;
const DAMPING = 0.75;

dragHandle.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragOffsetX = e.clientX - panelState.x;
    dragOffsetY = e.clientY - panelState.y;
});

// Setup 8-way resizers
document.querySelectorAll('.resizer').forEach(el => {
    el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        isResizing = true;
        resizeDir = e.target.className.split(' ')[1]; // e.g. r-br
        
        // Visual feedback
        document.querySelectorAll('.resizer').forEach(r => r.classList.remove('active'));
        e.target.classList.add('active');
        
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        startWidth = panelState.width;
        startHeight = panelState.height;
        startX = panelState.x;
        startY = panelState.y;
        targetWidth = startWidth;
        targetHeight = startHeight;
    });
});

window.addEventListener('mousemove', (e) => {
    if (isResizing) {
        let dx = e.clientX - resizeStartX;
        let dy = e.clientY - resizeStartY;
        
        let newWidth = startWidth;
        let newHeight = startHeight;
        
        if (resizeDir.includes('right') || resizeDir.includes('r-tr') || resizeDir.includes('r-br')) newWidth += dx;
        if (resizeDir.includes('left') || resizeDir.includes('r-tl') || resizeDir.includes('r-bl')) newWidth -= dx;
        
        if (resizeDir.includes('bottom') || resizeDir.includes('r-bl') || resizeDir.includes('r-br')) newHeight += dy;
        if (resizeDir.includes('top') || resizeDir.includes('r-tl') || resizeDir.includes('r-tr')) newHeight -= dy;
        
        targetWidth = Math.max(340, newWidth);
        targetHeight = Math.max(380, newHeight);
    } else if (isDragging) {
        panelState.x = e.clientX - dragOffsetX;
        panelState.y = e.clientY - dragOffsetY;
    }
});

window.addEventListener('mouseup', () => {
    isDragging = false;
    isResizing = false;
    document.querySelectorAll('.resizer').forEach(r => r.classList.remove('active'));
});

function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

let startTime = Date.now();

function render() {
    // Spongy resize physics update
    let aw = (targetWidth - panelState.width) * SPRING;
    let ah = (targetHeight - panelState.height) * SPRING;
    
    vw = (vw + aw) * DAMPING;
    vh = (vh + ah) * DAMPING;
    
    let oldWidth = panelState.width;
    let oldHeight = panelState.height;
    
    panelState.width += vw;
    panelState.height += vh;
    
    // Shift center to keep the appropriate edge anchored during the bouncy resize
    let dw = panelState.width - oldWidth;
    let dh = panelState.height - oldHeight;
    
    let shiftX = 0;
    let shiftY = 0;
    
    if (resizeDir.includes('right') || resizeDir.includes('r-tr') || resizeDir.includes('r-br')) shiftX = dw / 2;
    if (resizeDir.includes('left') || resizeDir.includes('r-tl') || resizeDir.includes('r-bl')) shiftX = -dw / 2;
    
    if (resizeDir.includes('bottom') || resizeDir.includes('r-bl') || resizeDir.includes('r-br')) shiftY = dh / 2;
    if (resizeDir.includes('top') || resizeDir.includes('r-tl') || resizeDir.includes('r-tr')) shiftY = -dh / 2;
    
    panelState.x += shiftX;
    panelState.y += shiftY;

    // Apply to DOM
    loginPanel.style.width = `${panelState.width}px`;
    loginPanel.style.height = `${panelState.height}px`;
    loginPanel.style.left = `${panelState.x}px`;
    loginPanel.style.top = `${panelState.y}px`;
    loginPanel.style.transform = `translate(-50%, -50%)`;

    // Render WebGL
    let time = (Date.now() - startTime) * 0.001;
    
    const dpr = window.devicePixelRatio || 1;
    gl.uniform2f(u_resolution, canvas.width, canvas.height);
    gl.uniform1f(u_time, time);
    
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    // --- Login Panel Uniforms ---
    let rectX = (panelState.x - panelState.width / 2) * dpr;
    let rectY = (panelState.y - panelState.height / 2) * dpr;
    gl.uniform4f(u_panel_rect, rectX, rectY, panelState.width * dpr, panelState.height * dpr);
    gl.uniform1f(u_panel_radius, 32.0 * dpr);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
}

// Restore slider fill logic
function updateSliderFill() {
    const value = (opacitySlider.value - opacitySlider.min) / (opacitySlider.max - opacitySlider.min);
    opacitySlider.style.backgroundSize = (value * 100) + '% 100%';
    
    // Scale blur from 0px to 50px
    const blurPx = value * 50;
    document.documentElement.style.setProperty('--blur-amount', `${blurPx}px`);
}
opacitySlider.addEventListener('input', updateSliderFill);
updateSliderFill();

render();
