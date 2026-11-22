// Static per-fragment operation counts for the WebGL2 fragment shaders. The GLSL ES 3.00 source is
// compiled to SPIR-V with glslang, optimised and fully unrolled with spirv-opt, then each instruction
// is weighted by what it costs a VideoCore-style scalar-per-lane shader core:
//   one op per vector component for integer/float arithmetic, compares, selects and logic;
//   32-bit integer multiply = 4 ops (the QPU multiplier is 24-bit); division by a non-constant = 25;
//   conditional branch = 2; phi = 0.5 (moves under divergence); texture fetch = 3 ops to issue
//   plus one texture-unit access; 10 ops per fragment of fixed overhead (coordinates, output write).
// Counts cover all paths of the shader (what a 16-lane group pays when its lanes diverge). With
// `trivialDefine`, the same shader is also counted with that macro forced true, which leaves only
// its early-out path.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function haveTools() {
  try { execFileSync("glslangValidator", ["--version"], { stdio: "ignore" }); execFileSync("spirv-opt", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}

const ALU = new Set(["OpIAdd", "OpISub", "OpSNegate", "OpShiftRightLogical", "OpShiftRightArithmetic", "OpShiftLeftLogical", "OpBitwiseAnd", "OpBitwiseOr", "OpBitwiseXor", "OpNot",
  "OpIEqual", "OpINotEqual", "OpULessThan", "OpULessThanEqual", "OpUGreaterThan", "OpUGreaterThanEqual", "OpSLessThan", "OpSLessThanEqual", "OpSGreaterThan", "OpSGreaterThanEqual",
  "OpSelect", "OpLogicalAnd", "OpLogicalOr", "OpLogicalNot", "OpLogicalEqual", "OpLogicalNotEqual", "OpFAdd", "OpFSub", "OpFMul", "OpFNegate", "OpFOrdLessThan", "OpFOrdGreaterThan",
  "OpFOrdLessThanEqual", "OpFOrdGreaterThanEqual", "OpFOrdEqual", "OpFOrdNotEqual", "OpConvertUToF", "OpConvertFToU", "OpConvertSToF", "OpConvertFToS", "OpAny", "OpAll", "OpBitFieldUExtract", "OpBitFieldInsert"]);
const DIV = new Set(["OpUDiv", "OpSDiv", "OpUMod", "OpSMod", "OpSRem"]);
const FETCH = new Set(["OpImageFetch", "OpImageSampleImplicitLod", "OpImageSampleExplicitLod"]);

function toSpirvSource(fs_, defines) {
  const lines = fs_.split("\n");
  if (!lines[0].startsWith("#version 300 es")) throw new Error("expected #version 300 es");
  const extra = Object.entries(defines).map(([k, v]) => `#define ${k} ${v}`);
  return ["#version 310 es", "#extension GL_EXT_control_flow_attributes : enable", "#define UNROLL [[unroll]]", ...extra, ...lines.slice(1)].join("\n");
}

function disassemble(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-budget-spv-"));
  try {
    const f = path.join(dir, "s.frag"), a = path.join(dir, "a.spv"), b = path.join(dir, "b.spv");
    fs.writeFileSync(f, src);
    execFileSync("glslangValidator", ["-G", "--auto-map-locations", "--auto-map-bindings", "-S", "frag", "-o", a, f], { stdio: "pipe" });
    execFileSync("spirv-opt", ["-O", "--loop-unroll", "-O", a, "-o", b], { stdio: "pipe" });
    return execFileSync("spirv-dis", [b], { encoding: "utf8" });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function count(dis) {
  const width = {}, consts = {};
  const c = { fetches: 0, alu: 0, control: 0, loops: 0 };
  let inFn = false;
  for (const raw of dis.split("\n")) {
    const line = raw.trim();
    let m = /^(%\S+) = OpTypeVector \S+ (\d+)/.exec(line);
    if (m) { width[m[1]] = +m[2]; continue; }
    m = /^(%\S+) = OpConstant \S+ (-?\d+)/.exec(line);
    if (m) { consts[m[1]] = +m[2]; continue; }
    if (/OpFunction /.test(line)) inFn = true;
    if (/OpFunctionEnd/.test(line)) inFn = false;
    if (!inFn) continue;
    m = /^(?:(%\S+) = )?(Op\w+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const op = m[2], args = m[3].split(/\s+/), w = width[args[0]] || 1;
    if (ALU.has(op)) c.alu += w;
    else if (op === "OpIMul") c.alu += 4 * w;
    else if (op === "OpFDiv") c.alu += 4 * w;
    else if (DIV.has(op)) { const d = consts[args[2]]; c.alu += (d && (d & (d - 1)) === 0 ? 2 : 25) * w; }
    else if (op === "OpExtInst") c.alu += (/Clamp/.test(m[3]) ? 2 : 1) * w;
    else if (FETCH.has(op)) c.fetches += 1;
    else if (op === "OpBranchConditional") c.control += 2;
    else if (op === "OpSwitch") c.control += 2 + (args.length - 2) / 2;
    else if (op === "OpPhi") c.control += 0.5 * w;
    else if (op === "OpLoopMerge") c.loops++;
  }
  c.ops = Math.round(10 + c.alu + c.control + 3 * c.fetches);
  return c;
}

export function shaderCost(fsSource, trivialDefine = null) {
  const full = count(disassemble(toSpirvSource(fsSource, {})));
  const trivial = trivialDefine ? count(disassemble(toSpirvSource(fsSource, { [trivialDefine]: "true" }))) : null;
  return { full, trivial, method: "spirv" };
}

// Fallback when glslang/spirv-tools are missing: texture fetch count from the source text only.
export function roughCost(fsSource) {
  const fetches = (fsSource.match(/texelFetch\(/g) || []).length;
  return { full: { fetches, alu: NaN, control: NaN, ops: NaN }, trivial: null, method: "none (install glslang-tools and spirv-tools)" };
}
