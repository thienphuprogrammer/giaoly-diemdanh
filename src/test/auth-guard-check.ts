/**
 * Bộ kiểm tra cấu trúc (dựa trên văn bản) cho ranh giới xác thực.
 * Proxy không còn chặn request không phải GET khi thiếu phiên, nên MỌI server action và route handler phải tự xác thực
 * (requireUser / getCurrentUser). Đây là hàm thuần để có thể kiểm thử riêng; `auth-guard.test.ts` áp nó lên cả `src`.
 */

export type GuardViolation = { file: string; name: string; reason: string };

const AUTH_CALL = /\b(?:requireUser|getCurrentUser)\s*\(/;
const DIRECTIVE = /["']use server["']/;

/** Thay chú thích và chuỗi/template bằng khoảng trắng (giữ nguyên độ dài, xuống dòng) để regex/đếm ngoặc không bị lừa. */
export function maskLiterals(src: string): string {
  let out = "";
  let i = 0;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      const stop = Math.min(j + 1, src.length);
      // Giữ dấu nháy để thấy ranh giới, bỏ nội dung.
      out += c + blank(src.slice(i + 1, stop - 1)) + (stop - 1 > i ? c : "");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Vị trí `}` khớp với `{` tại `open` (trong văn bản đã mask); -1 nếu không khớp. */
function matchBrace(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "{") depth++;
    else if (masked[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Vị trí `)` khớp với `(` tại `open`. */
function matchParen(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === "(") depth++;
    else if (masked[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

/** `{` mở thân hàm sau danh sách tham số: bỏ qua `{` thuộc kiểu trả về (đứng sau `:`, `<`, `,`, `|`, `&`...). */
function findBodyOpen(masked: string, from: number): number {
  for (let i = from; i < masked.length; i++) {
    if (masked[i] !== "{") continue;
    const prev = masked.slice(from, i).trimEnd().slice(-1);
    if (prev === "" || !":<,|&;(".includes(prev)) return i;
  }
  return -1;
}

function hasTopLevelDirective(src: string): boolean {
  const lead = src.replace(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use server["']/.test(lead);
}

/** Thân của hàm có `(` tham số mở tại `paren`: arrow hay function đều trả về đoạn văn bản thân. */
function bodyAfterParams(masked: string, paren: number, isArrow: boolean): string | null {
  const close = matchParen(masked, paren);
  if (close === -1) return null;
  let from = close + 1;
  if (isArrow) {
    const arrow = masked.indexOf("=>", from);
    if (arrow === -1) return null;
    from = arrow + 2;
    const rest = masked.slice(from);
    const lead = rest.length - rest.trimStart().length;
    if (rest.trimStart()[0] !== "{") {
      // Arrow dạng biểu thức: đến hết câu lệnh (dòng `export` kế hoặc hết tệp).
      const next = masked.slice(from).search(/\n(?=export\b)/);
      return masked.slice(from, next === -1 ? masked.length : from + next);
    }
    from += lead;
  }
  const open = findBodyOpen(masked, from);
  if (open === -1) return null;
  const end = matchBrace(masked, open);
  return end === -1 ? null : masked.slice(open, end + 1);
}

/** Tên các hàm (cùng tệp) có thân gọi requireUser/getCurrentUser: action đi qua chúng cũng được coi là đã xác thực. */
function authHelpers(masked: string): string[] {
  const names: string[] = [];
  const re = /(?:^|\n)\s*(?:async\s+)?function\s*\*?\s*(\w+)\s*\(|(?:^|\n)\s*const\s+(\w+)\s*=\s*async\s*\(/g;
  for (const m of masked.matchAll(re)) {
    const name = m[1] ?? m[2];
    const paren = (m.index ?? 0) + m[0].length - 1;
    const body = bodyAfterParams(masked, paren, m[2] !== undefined);
    if (body !== null && AUTH_CALL.test(body)) names.push(name);
  }
  return names;
}

function checkTopLevel(file: string, src: string, masked: string, allow: Set<string>): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const helpers = authHelpers(masked).map((n) => new RegExp(`\\b${n}\\s*\\(`));
  const exportRe = /^export\s+(?!type\b|interface\b)(.*)$/gm;
  for (const m of masked.matchAll(exportRe)) {
    const start = m.index ?? 0;
    const head = masked.slice(start);
    const fn = /^export\s+(?:default\s+)?async\s+function\s*\*?\s*(\w*)\s*\(/.exec(head);
    const arrow = /^export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*async\s*(?:function\s*\w*\s*)?\(/.exec(head);
    const hit = fn ?? arrow;
    const name = hit?.[1] || "default";
    if (allow.has(`${file}::${name}`)) continue;
    if (!hit) {
      const unknown = /^export\s+(?:default\s+)?(?:const|let|var|function|class)?\s*(\w+)?/.exec(head)?.[1] ?? "?";
      violations.push({ file, name: unknown, reason: "export không nhận dạng được trong tệp 'use server'; không chứng minh được có xác thực" });
      continue;
    }
    const paren = start + hit[0].length - 1;
    const body = bodyAfterParams(masked, paren, Boolean(arrow));
    if (body === null || !(AUTH_CALL.test(body) || helpers.some((h) => h.test(body)))) {
      violations.push({ file, name, reason: "server action không gọi requireUser( hoặc getCurrentUser(" });
    }
  }
  void src;
  return violations;
}

function checkInline(file: string, src: string, masked: string, allow: Set<string>): GuardViolation[] {
  const violations: GuardViolation[] = [];
  // Mask làm mất directive; tìm lại trên bản chỉ bỏ chú thích bằng vị trí trong `src`, rồi đối chiếu độ dài giống nhau.
  const re = new RegExp(DIRECTIVE.source, "g");
  for (const m of src.matchAll(re)) {
    const pos = m.index ?? 0;
    if (masked[pos] !== '"' && masked[pos] !== "'") continue; // nằm trong chú thích/chuỗi khác
    // Đi ngược tìm `{` chưa đóng bao quanh: đó là thân hàm chứa directive.
    let depth = 0;
    let open = -1;
    for (let i = pos - 1; i >= 0; i--) {
      if (masked[i] === "}") depth++;
      else if (masked[i] === "{") {
        if (depth === 0) {
          open = i;
          break;
        }
        depth--;
      }
    }
    if (open === -1) continue;
    const close = matchBrace(masked, open);
    const body = close === -1 ? masked.slice(open) : masked.slice(open, close + 1);
    const before = masked.slice(0, open);
    const tail = before.slice(-300);
    const lastFn = [...tail.matchAll(/function\s*\*?\s*(\w+)\s*\(/g)].pop()?.[1];
    const lastArrow = [...tail.matchAll(/(\w+)\s*=\s*async[^=]*=>\s*$/g)].pop()?.[1];
    const name = (lastArrow ?? lastFn) || "inline";
    if (allow.has(`${file}::${name}`)) continue;
    if (!AUTH_CALL.test(body)) {
      violations.push({ file, name, reason: "server action nội tuyến không gọi requireUser( hoặc getCurrentUser(" });
    }
  }
  return violations;
}

/**
 * Kiểm một tệp nguồn. `allow` là danh sách "đường-dẫn::tên" được miễn (ví dụ login, logout nội tuyến).
 * Tệp không có "use server" ở đâu cả thì bỏ qua.
 */
export function checkServerActionSource(file: string, src: string, allow: readonly string[] = []): GuardViolation[] {
  if (!DIRECTIVE.test(src)) return [];
  const allowSet = new Set(allow);
  const masked = maskLiterals(src);
  if (hasTopLevelDirective(src)) return checkTopLevel(file, src, masked, allowSet);
  return checkInline(file, src, masked, allowSet);
}

/** Route handler phải tự xác thực: tham chiếu getCurrentUser hoặc đi qua handleScanApi (đã gọi getUser). `allow` là tệp route công khai có chủ đích (đường dẫn tương đối). */
/**
 * `allow`: `tệp` (route công khai, miễn hẳn) hoặc `tệp::hàm` (route tự xác thực bằng cách khác phiên, ví dụ cron bằng
 * CRON_SECRET): chỉ miễn khi chính tệp đó GỌI `hàm(` ngoài chú thích/chuỗi; bỏ lời gọi đó thì lại là vi phạm.
 */
export function checkRouteSource(file: string, src: string, allow: readonly string[] = []): GuardViolation | null {
  if (allow.includes(file)) return null;
  const masked = maskLiterals(src);
  const markers = allow.filter((a) => a.startsWith(`${file}::`)).map((a) => a.slice(file.length + 2));
  if (markers.some((m) => /^\w+$/.test(m) && new RegExp(`\\b${m}\\s*\\(`).test(masked))) return null;
  if (/\bgetCurrentUser\b/.test(masked) || /\bhandleScanApi\b/.test(masked)) return null;
  return { file, name: "route", reason: "route handler không tham chiếu getCurrentUser hoặc handleScanApi" };
}
