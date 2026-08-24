/**
 * The animated gradient behind the password page.
 *
 * A single full-screen quad and one fragment shader: layered value noise,
 * swirled a few times, then thresholded into three colours. Ported from a
 * supplied React component; the shader is kept as it was, because the shader
 * is the artwork. The wrapper around it is not.
 *
 * What changed, and why each one matters on this particular page:
 *
 *   WebGL2 is required by the original, and it simply returns if the context
 *   is missing, leaving an empty div. This page is where a founder sets their
 *   password; it cannot depend on a GPU. The caller is told, and paints a
 *   plain background instead.
 *
 *   It uses the raw devicePixelRatio. On a 3x phone that is nine times the
 *   pixels through a swirl loop with up to 30 iterations, which is how a
 *   background melts a battery. Capped at 2.
 *
 *   It never stops, so the loop keeps running on a backgrounded tab.
 *
 *   Reduced motion draws one frame and holds it.
 */

export type GradientShape = "Checks" | "Stripes" | "Edge";

export type GradientParams = {
  color1: string;
  color2: string;
  color3: string;
  rotation: number;
  proportion: number;
  scale: number;
  speed: number;
  distortion: number;
  swirl: number;
  swirlIterations: number;
  softness: number;
  offset: number;
  shape: GradientShape;
  shapeSize: number;
};

const SHAPES: Record<GradientShape, number> = { Checks: 0, Stripes: 1, Edge: 2 };

/**
 * The Sprint's own. Built on the supplied "Mist" preset, which is the one that
 * stays out of the way of a form, with its pink swapped for signal red.
 */
export const SPRINT_MIST: GradientParams = {
  color1: "#050505",
  color2: "#E8170A",
  color3: "#050505",
  rotation: 0,
  proportion: 33,
  scale: 0.48,
  speed: 26,
  distortion: 4,
  swirl: 65,
  swirlIterations: 5,
  softness: 100,
  offset: -235,
  shape: "Edge",
  shapeSize: 48,
};

/** #rgb, #rrggbb and #rrggbbaa, to 0..1 components. */
export function hexToRgba(hex: string): [number, number, number, number] {
  const c = hex.replace("#", "");
  const pair = (i: number) => parseInt(c.slice(i, i + 2), 16) / 255;
  if (c.length === 3) {
    return [
      parseInt(c[0]! + c[0]!, 16) / 255,
      parseInt(c[1]! + c[1]!, 16) / 255,
      parseInt(c[2]! + c[2]!, 16) / 255,
      1,
    ];
  }
  if (c.length >= 6) {
    return [pair(0), pair(2), pair(4), c.length === 8 ? pair(6) : 1];
  }
  return [0, 0, 0, 1];
}

const VERT = `#version 300 es
in vec4 a_position;
void main() { gl_Position = a_position; }`;

/* Kept verbatim from the supplied component: this is the picture. */
const FRAG = `#version 300 es
precision highp float;

uniform float u_time;
uniform float u_pixelRatio;
uniform vec2 u_resolution;

uniform float u_scale;
uniform float u_rotation;
uniform vec4 u_color1;
uniform vec4 u_color2;
uniform vec4 u_color3;
uniform float u_proportion;
uniform float u_softness;
uniform float u_shape;
uniform float u_shapeScale;
uniform float u_distortion;
uniform float u_swirl;
uniform float u_swirlIterations;

out vec4 fragColor;

#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846

vec2 rotate(vec2 uv, float th) {
  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float noise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = random(i);
  float b = random(i + vec2(1.0, 0.0));
  float c = random(i + vec2(0.0, 1.0));
  float d = random(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x1 = mix(a, b, u.x);
  float x2 = mix(c, d, u.x);
  return mix(x1, x2, u.y);
}

vec4 blend_colors(vec4 c1, vec4 c2, vec4 c3, float mixer, float edgesWidth, float edge_blur) {
    vec3 color1 = c1.rgb * c1.a;
    vec3 color2 = c2.rgb * c2.a;
    vec3 color3 = c3.rgb * c3.a;
    float r1 = smoothstep(.0 + .35 * edgesWidth, .7 - .35 * edgesWidth + .5 * edge_blur, mixer);
    float r2 = smoothstep(.3 + .35 * edgesWidth, 1. - .35 * edgesWidth + edge_blur, mixer);
    vec3 blended_color_2 = mix(color1, color2, r1);
    float blended_opacity_2 = mix(c1.a, c2.a, r1);
    vec3 c = mix(blended_color_2, color3, r2);
    float o = mix(blended_opacity_2, c3.a, r2);
    return vec4(c, o);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    float t = .5 * u_time;
    float noise_scale = .0005 + .006 * u_scale;

    uv -= .5;
    uv *= (noise_scale * u_resolution);
    uv = rotate(uv, u_rotation * .5 * PI);
    uv /= u_pixelRatio;
    uv += .5;

    float n1 = noise(uv * 1. + t);
    float n2 = noise(uv * 2. - t);
    float angle = n1 * TWO_PI;
    uv.x += 4. * u_distortion * n2 * cos(angle);
    uv.y += 4. * u_distortion * n2 * sin(angle);

    float iterations_number = ceil(clamp(u_swirlIterations, 1., 30.));
    for (float i = 1.; i <= iterations_number; i++) {
        uv.x += clamp(u_swirl, 0., 2.) / i * cos(t + i * 1.5 * uv.y);
        uv.y += clamp(u_swirl, 0., 2.) / i * cos(t + i * 1. * uv.x);
    }

    float proportion = clamp(u_proportion, 0., 1.);
    float shape = 0.;
    float mixer = 0.;
    if (u_shape < .5) {
      vec2 checks_shape_uv = uv * (.5 + 3.5 * u_shapeScale);
      shape = .5 + .5 * sin(checks_shape_uv.x) * cos(checks_shape_uv.y);
      mixer = shape + .48 * sign(proportion - .5) * pow(abs(proportion - .5), .5);
    } else if (u_shape < 1.5) {
      vec2 stripes_shape_uv = uv * (.25 + 3. * u_shapeScale);
      float f = fract(stripes_shape_uv.y);
      shape = smoothstep(.0, .55, f) * smoothstep(1., .45, f);
      mixer = shape + .48 * sign(proportion - .5) * pow(abs(proportion - .5), .5);
    } else {
      float sh = 1. - uv.y;
      sh -= .5;
      sh /= (noise_scale * u_resolution.y);
      sh += .5;
      float shape_scaling = .2 * (1. - u_shapeScale);
      shape = smoothstep(.45 - shape_scaling, .55 + shape_scaling, sh + .3 * (proportion - .5));
      mixer = shape;
    }

    vec4 color_mix = blend_colors(u_color1, u_color2, u_color3, mixer, 1. - clamp(u_softness, 0., 1.), .01 + .01 * u_scale);
    fragColor = vec4(color_mix.rgb, color_mix.a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  /* The original never checks. A shader that fails to compile links into a
     program that draws nothing, silently, and the page looks merely blank. */
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Start the gradient on a canvas.
 *
 * Returns a stop function, or null if WebGL2 is unavailable or the program
 * fails to build, so the caller can fall back rather than show an empty box.
 */
export function mountAnimatedGradient(
  canvas: HTMLCanvasElement,
  params: GradientParams = SPRINT_MIST,
): (() => void) | null {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const u = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    time: u("u_time"),
    resolution: u("u_resolution"),
    pixelRatio: u("u_pixelRatio"),
    scale: u("u_scale"),
    rotation: u("u_rotation"),
    color1: u("u_color1"),
    color2: u("u_color2"),
    color3: u("u_color3"),
    proportion: u("u_proportion"),
    softness: u("u_softness"),
    shape: u("u_shape"),
    shapeScale: u("u_shapeScale"),
    distortion: u("u_distortion"),
    swirl: u("u_swirl"),
    swirlIterations: u("u_swirlIterations"),
  };

  /* Capped at 2. The original uses the raw ratio, which on a 3x phone is nine
     times the fragments through a loop of up to 30 swirl iterations. */
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  const resize = () => {
    const ratio = dpr();
    const w = Math.max(1, Math.round(window.innerWidth * ratio));
    const h = Math.max(1, Math.round(window.innerHeight * ratio));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
  };

  const draw = (seconds: number) => {
    const [r1, g1, b1, a1] = hexToRgba(params.color1);
    const [r2, g2, b2, a2] = hexToRgba(params.color2);
    const [r3, g3, b3, a3] = hexToRgba(params.color3);

    gl.uniform1f(uniforms.time, seconds * (params.speed / 100) * 5 + params.offset * 0.01);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.pixelRatio, dpr());
    gl.uniform1f(uniforms.scale, params.scale);
    gl.uniform1f(uniforms.rotation, (params.rotation * Math.PI) / 180);
    gl.uniform4f(uniforms.color1, r1, g1, b1, a1);
    gl.uniform4f(uniforms.color2, r2, g2, b2, a2);
    gl.uniform4f(uniforms.color3, r3, g3, b3, a3);
    gl.uniform1f(uniforms.proportion, params.proportion / 100);
    gl.uniform1f(uniforms.softness, params.softness / 100);
    gl.uniform1f(uniforms.shape, SHAPES[params.shape]);
    gl.uniform1f(uniforms.shapeScale, params.shapeSize / 100);
    gl.uniform1f(uniforms.distortion, params.distortion / 50);
    gl.uniform1f(uniforms.swirl, params.swirl / 100);
    gl.uniform1f(uniforms.swirlIterations, params.swirl === 0 ? 0 : params.swirlIterations);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const dispose = () => {
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteBuffer(buffer);
  };

  resize();
  window.addEventListener("resize", resize);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // One frame, held. A slowly churning full-screen field is exactly what
    // this setting exists to stop.
    draw(0);
    return () => {
      window.removeEventListener("resize", resize);
      dispose();
    };
  }

  /* One frame straight away, before the loop.
     Without this a page that loads while its tab is backgrounded never paints
     at all: requestAnimationFrame does not run in a hidden tab, so the canvas
     stays empty until the tab is focused. Which is exactly what happened. */
  draw(0);

  const start = performance.now();
  let frame = 0;

  const tick = (now: number) => {
    resize();
    draw((now - start) / 1000);
    frame = requestAnimationFrame(tick);
  };

  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else if (!frame) {
      frame = requestAnimationFrame(tick);
    }
  };

  document.addEventListener("visibilitychange", onVisibility);
  frame = requestAnimationFrame(tick);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("resize", resize);
    if (frame) cancelAnimationFrame(frame);
    dispose();
  };
}
