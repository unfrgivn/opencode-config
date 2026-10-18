import * as fs from "node:fs"
import * as path from "node:path"

type AgentArt = {
  name: string
  theme: "descriptive" | "lotr" | "common"
  title: string
  subtitle: string
  palette: {
    bg: string
    bg2: string
    border: string
    skin: string
    main: string
    dark: string
    light: string
    accent: string
    glow: string
  }
  prop: "staff" | "bow" | "leaf" | "tree" | "hammer" | "rune" | "star" | "sword" | "map" | "book" | "gear" | "shield" | "spark" | "bug" | "input" | "unknown"
}

const ART_DIR = path.resolve(import.meta.dir, "..", "companion", "art")
const FRAME_WIDTH = 128
const FRAME_HEIGHT = 160
const FRAME_COUNT = 4

const agents: AgentArt[] = [
  art("descriptive", "orchestrator", "ORCHESTRATOR", "routes the party", palette("#141827", "#202742", "#f5a3d9", "#f1c27d", "#8b5cf6", "#312e81", "#c4b5fd", "#f59e0b", "#fde68a"), "staff"),
  art("descriptive", "explorer", "EXPLORER", "maps the unknown", palette("#10231f", "#193a34", "#7dd3fc", "#d6a36a", "#10b981", "#064e3b", "#a7f3d0", "#38bdf8", "#bbf7d0"), "map"),
  art("descriptive", "researcher", "RESEARCHER", "finds receipts", palette("#111827", "#1f2937", "#93c5fd", "#e0a46b", "#2563eb", "#1e3a8a", "#bfdbfe", "#fbbf24", "#dbeafe"), "book"),
  art("descriptive", "planner", "PLANNER", "keeps the path", palette("#1f1b2e", "#30294a", "#c4b5fd", "#d7a46a", "#7c3aed", "#4c1d95", "#ddd6fe", "#34d399", "#ede9fe"), "shield"),
  art("descriptive", "implementer", "IMPLEMENTER", "ships the fix", palette("#201513", "#3a211c", "#fb923c", "#c98245", "#dc2626", "#7f1d1d", "#fecaca", "#fbbf24", "#fed7aa"), "hammer"),
  art("descriptive", "architect", "ARCHITECT", "draws the bones", palette("#0f172a", "#1e293b", "#67e8f9", "#d19a66", "#0891b2", "#164e63", "#cffafe", "#a3e635", "#ecfeff"), "rune"),
  art("descriptive", "analyst", "ANALYST", "reads the signal", palette("#1c1917", "#292524", "#f0abfc", "#e5aa75", "#be185d", "#831843", "#fbcfe8", "#22d3ee", "#fae8ff"), "star"),
  art("descriptive", "tdd", "TDD", "red green refactor", palette("#111111", "#242424", "#86efac", "#d6a36a", "#16a34a", "#14532d", "#bbf7d0", "#ef4444", "#dcfce7"), "bug"),
  art("lotr", "gandalf", "GANDALF", "you shall not fail", palette("#101827", "#1f2937", "#f9a8d4", "#f0c48a", "#94a3b8", "#475569", "#e5e7eb", "#f59e0b", "#fef3c7"), "staff"),
  art("lotr", "legolas", "LEGOLAS", "eyes on the trail", palette("#0f241c", "#193829", "#86efac", "#e7b77b", "#16a34a", "#14532d", "#bbf7d0", "#38bdf8", "#dcfce7"), "bow"),
  art("lotr", "radagast", "RADAGAST", "talks to docs", palette("#1b2315", "#2d3a20", "#bef264", "#d7a46a", "#65a30d", "#3f6212", "#ecfccb", "#facc15", "#f7fee7"), "leaf"),
  art("lotr", "treebeard", "TREEBEARD", "slow plans fast", palette("#1c160f", "#3a2a19", "#fdba74", "#b87945", "#854d0e", "#422006", "#fed7aa", "#84cc16", "#ffedd5"), "tree"),
  art("lotr", "celebrimbor", "CELEBRIMBOR", "forges changes", palette("#231312", "#3b1d1a", "#fca5a5", "#d09357", "#dc2626", "#7f1d1d", "#fecaca", "#fbbf24", "#fee2e2"), "hammer"),
  art("lotr", "elrond", "ELROND", "sees the shape", palette("#0b1f2a", "#123040", "#67e8f9", "#e2aa74", "#0891b2", "#164e63", "#cffafe", "#a3e635", "#ecfeff"), "rune"),
  art("lotr", "galadriel", "GALADRIEL", "mirror bright", palette("#1f1b2d", "#31294a", "#f0abfc", "#f0bf83", "#a855f7", "#581c87", "#f5d0fe", "#22d3ee", "#fae8ff"), "star"),
  art("lotr", "aragorn", "ARAGORN", "tests the crown", palette("#151a16", "#293225", "#86efac", "#d7a46a", "#15803d", "#14532d", "#bbf7d0", "#eab308", "#dcfce7"), "sword"),
  art("common", "input", "INPUT", "your move", palette("#141827", "#202742", "#f9a8d4", "#9cc8ff", "#38bdf8", "#0c4a6e", "#bae6fd", "#f59e0b", "#e0f2fe"), "input"),
  art("common", "intro", "READY", "standing by", palette("#111827", "#1f2937", "#94a3b8", "#9cc8ff", "#64748b", "#334155", "#cbd5e1", "#38bdf8", "#f8fafc"), "spark"),
  art("common", "unknown", "UNKNOWN", "mystery agent", palette("#171717", "#262626", "#d4d4d4", "#a3a3a3", "#737373", "#404040", "#e5e5e5", "#f97316", "#fafafa"), "unknown"),
]

for (const agent of agents) {
  const dir = path.join(ART_DIR, agent.theme)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${agent.name}.svg`), spriteSheet(agent))
}

function art(theme: AgentArt["theme"], name: string, title: string, subtitle: string, palette: AgentArt["palette"], prop: AgentArt["prop"]): AgentArt {
  return { theme, name, title, subtitle, palette, prop }
}

function palette(bg: string, bg2: string, border: string, skin: string, main: string, dark: string, light: string, accent: string, glow: string): AgentArt["palette"] {
  return { bg, bg2, border, skin, main, dark, light, accent, glow }
}

function spriteSheet(agent: AgentArt): string {
  const frames = Array.from({ length: FRAME_COUNT }, (_, index) => frame(agent, index)).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAME_WIDTH * FRAME_COUNT} ${FRAME_HEIGHT}" width="${FRAME_WIDTH * FRAME_COUNT}" height="${FRAME_HEIGHT}" shape-rendering="crispEdges">${frames}</svg>\n`
}

function frame(agent: AgentArt, index: number): string {
  const x = index * FRAME_WIDTH
  const bob = index % 2 === 0 ? 0 : -2
  const arm = index === 1 ? -3 : index === 3 ? 3 : 0
  return `<g transform="translate(${x} 0)">
    <rect width="128" height="160" rx="0" fill="${agent.palette.bg}"/>
    <rect x="4" y="4" width="120" height="152" fill="${agent.palette.bg2}"/>
    <rect x="8" y="8" width="112" height="144" fill="${agent.palette.bg}"/>
    <rect x="12" y="12" width="104" height="108" fill="${agent.palette.bg2}"/>
    ${visual(agent, bob, arm, index)}
    <rect x="8" y="122" width="112" height="30" fill="#050816"/>
    <rect x="8" y="122" width="112" height="2" fill="${agent.palette.border}"/>
    <text x="64" y="138" text-anchor="middle" font-family="Monaco, 'Courier New', monospace" font-size="11" font-weight="700" fill="${agent.palette.light}">${escapeXml(agent.title)}</text>
    <text x="64" y="149" text-anchor="middle" font-family="Monaco, 'Courier New', monospace" font-size="5" letter-spacing="0.8" fill="${agent.palette.border}">${escapeXml(agent.subtitle.toUpperCase())}</text>
  </g>`
}

function visual(agent: AgentArt, bob: number, arm: number, index: number): string {
  if (agent.theme === "descriptive" || agent.theme === "common") {
    return symbolScene(agent, bob, index)
  }

  return `${character(agent, bob, arm)}${prop(agent, bob, arm, index)}`
}

function symbolScene(agent: AgentArt, bob: number, index: number): string {
  const p = agent.palette
  const pulse = index % 2 === 0 ? p.accent : p.glow
  const y = bob

  const base = `<g transform="translate(0 ${y})">
    <rect x="28" y="30" width="72" height="72" fill="${p.dark}"/>
    <rect x="32" y="34" width="64" height="64" fill="${p.bg}"/>
    <rect x="36" y="38" width="56" height="56" fill="${p.bg2}"/>
  `

  switch (agent.prop) {
    case "staff":
      return `${base}<rect x="61" y="45" width="6" height="36" fill="${p.light}"/><rect x="44" y="52" width="10" height="10" fill="${pulse}"/><rect x="74" y="52" width="10" height="10" fill="${p.accent}"/><rect x="59" y="82" width="10" height="10" fill="${p.glow}"/><rect x="54" y="56" width="20" height="4" fill="${p.border}"/><rect x="64" y="62" width="14" height="4" fill="${p.border}"/></g>`
    case "map":
      return `${base}<rect x="42" y="47" width="44" height="34" fill="${p.glow}"/><rect x="42" y="47" width="4" height="34" fill="${p.accent}"/><rect x="58" y="47" width="3" height="34" fill="${p.dark}"/><rect x="73" y="47" width="3" height="34" fill="${p.dark}"/><rect x="49" y="56" width="10" height="4" fill="${p.main}"/><rect x="68" y="67" width="12" height="4" fill="${pulse}"/><rect x="82" y="43" width="10" height="10" fill="${p.border}"/></g>`
    case "book":
      return `${base}<rect x="39" y="49" width="50" height="36" fill="${p.accent}"/><rect x="64" y="49" width="3" height="36" fill="${p.dark}"/><rect x="44" y="56" width="15" height="3" fill="${p.light}"/><rect x="70" y="56" width="14" height="3" fill="${p.light}"/><rect x="45" y="68" width="13" height="3" fill="${pulse}"/><rect x="78" y="72" width="12" height="12" fill="none" stroke="${p.glow}" stroke-width="4"/><rect x="88" y="82" width="14" height="4" fill="${p.glow}"/></g>`
    case "shield":
      return `${base}<rect x="45" y="45" width="38" height="42" fill="${p.dark}"/><rect x="49" y="49" width="30" height="30" fill="${p.accent}"/><rect x="61" y="49" width="6" height="30" fill="${p.glow}"/><rect x="53" y="61" width="22" height="5" fill="${p.light}"/><rect x="43" y="91" width="42" height="5" fill="${pulse}"/></g>`
    case "hammer":
      return `${base}<rect x="47" y="78" width="40" height="9" fill="${p.dark}"/><rect x="55" y="46" width="8" height="38" fill="${p.accent}"/><rect x="45" y="39" width="34" height="12" fill="${p.light}"/><rect x="41" y="43" width="42" height="8" fill="${p.border}"/><rect x="70" y="62" width="18" height="18" fill="${pulse}"/><rect x="74" y="66" width="10" height="10" fill="${p.bg}"/></g>`
    case "rune":
      return `${base}<rect x="42" y="49" width="44" height="34" fill="${p.dark}"/><rect x="47" y="54" width="34" height="4" fill="${p.glow}"/><rect x="47" y="66" width="26" height="4" fill="${p.accent}"/><rect x="47" y="78" width="31" height="4" fill="${p.light}"/><rect x="87" y="42" width="9" height="52" fill="${pulse}"/><rect x="90" y="45" width="3" height="46" fill="${p.bg}"/></g>`
    case "star":
      return `${base}<rect x="61" y="44" width="6" height="42" fill="${p.glow}"/><rect x="43" y="62" width="42" height="6" fill="${p.glow}"/><rect x="54" y="54" width="20" height="20" fill="${pulse}"/><rect x="48" y="84" width="10" height="6" fill="${p.accent}"/><rect x="63" y="80" width="10" height="10" fill="${p.light}"/><rect x="78" y="84" width="10" height="6" fill="${p.accent}"/></g>`
    case "bug":
      return `${base}<rect x="42" y="48" width="18" height="16" fill="#ef4444"/><rect x="68" y="48" width="18" height="16" fill="#22c55e"/><rect x="55" y="72" width="18" height="16" fill="${pulse}"/><rect x="47" y="53" width="8" height="4" fill="${p.light}"/><rect x="73" y="53" width="8" height="4" fill="${p.light}"/><rect x="60" y="77" width="8" height="4" fill="${p.dark}"/></g>`
    case "input":
      return `${base}<rect x="43" y="50" width="42" height="30" fill="${p.dark}"/><rect x="48" y="55" width="32" height="20" fill="${p.glow}"/><rect x="52" y="63" width="18" height="4" fill="${p.bg}"/><rect x="73" y="63" width="5" height="4" fill="${pulse}"/></g>`
    default:
      return `${base}<rect x="51" y="47" width="26" height="26" fill="${pulse}"/><rect x="57" y="53" width="14" height="14" fill="${p.bg}"/><rect x="61" y="80" width="8" height="8" fill="${p.light}"/></g>`
  }
}

function character(agent: AgentArt, bob: number, arm: number): string {
  if (agent.name === "treebeard") {
    return treebeard(agent, bob, arm)
  }

  const details = lotrDetails(agent)
  return `<g transform="translate(0 ${bob})">
    ${details.back}
    <rect x="50" y="33" width="28" height="20" fill="${agent.palette.skin}"/>
    <rect x="46" y="29" width="36" height="10" fill="${agent.palette.dark}"/>
    ${details.head}
    <rect x="54" y="41" width="6" height="6" fill="#06111f"/>
    <rect x="70" y="41" width="6" height="6" fill="#06111f"/>
    <rect x="58" y="51" width="14" height="4" fill="${agent.palette.dark}"/>
    <rect x="42" y="55" width="44" height="42" fill="${agent.palette.main}"/>
    ${details.body}
    <rect x="48" y="61" width="32" height="30" fill="${agent.palette.light}" opacity="0.92"/>
    <rect x="34" y="60" width="10" height="28" fill="${agent.palette.dark}"/>
    <rect x="84" y="${60 + arm}" width="10" height="28" fill="${agent.palette.dark}"/>
    <rect x="48" y="97" width="12" height="18" fill="${agent.palette.dark}"/>
    <rect x="68" y="97" width="12" height="18" fill="${agent.palette.dark}"/>
    <rect x="44" y="113" width="18" height="5" fill="${agent.palette.accent}"/>
    <rect x="66" y="113" width="18" height="5" fill="${agent.palette.accent}"/>
    ${details.front}
  </g>`
}

function treebeard(agent: AgentArt, bob: number, arm: number): string {
  return `<g transform="translate(0 ${bob})">
    <rect x="44" y="42" width="40" height="72" fill="${agent.palette.dark}"/>
    <rect x="50" y="36" width="28" height="78" fill="${agent.palette.main}"/>
    <rect x="55" y="28" width="18" height="14" fill="${agent.palette.accent}"/>
    <rect x="36" y="31" width="56" height="12" fill="${agent.palette.accent}"/>
    <rect x="30" y="43" width="20" height="16" fill="${agent.palette.main}"/>
    <rect x="78" y="43" width="20" height="16" fill="${agent.palette.main}"/>
    <rect x="55" y="52" width="5" height="5" fill="#06111f"/>
    <rect x="68" y="52" width="5" height="5" fill="#06111f"/>
    <rect x="58" y="64" width="14" height="4" fill="${agent.palette.light}"/>
    <rect x="39" y="66" width="9" height="28" fill="${agent.palette.dark}"/>
    <rect x="82" y="${66 + arm}" width="9" height="28" fill="${agent.palette.dark}"/>
    <rect x="52" y="114" width="12" height="5" fill="${agent.palette.accent}"/>
    <rect x="67" y="114" width="12" height="5" fill="${agent.palette.accent}"/>
  </g>`
}

function lotrDetails(agent: AgentArt): { back: string; head: string; body: string; front: string } {
  switch (agent.name) {
    case "gandalf":
      return {
        back: `<rect x="55" y="14" width="18" height="20" fill="${agent.palette.dark}"/><rect x="48" y="28" width="32" height="7" fill="${agent.palette.light}"/>`,
        head: `<rect x="53" y="51" width="22" height="12" fill="${agent.palette.light}"/><rect x="58" y="60" width="12" height="10" fill="${agent.palette.light}"/>`,
        body: `<rect x="53" y="57" width="22" height="40" fill="${agent.palette.dark}"/>`,
        front: `<rect x="61" y="65" width="6" height="30" fill="${agent.palette.border}"/>`,
      }
    case "legolas":
      return {
        back: `<rect x="44" y="27" width="40" height="8" fill="#facc15"/><rect x="40" y="56" width="48" height="50" fill="${agent.palette.dark}" opacity="0.85"/>`,
        head: `<rect x="42" y="41" width="8" height="5" fill="${agent.palette.skin}"/><rect x="78" y="41" width="8" height="5" fill="${agent.palette.skin}"/>`,
        body: `<rect x="51" y="58" width="26" height="34" fill="${agent.palette.main}"/>`,
        front: `<rect x="48" y="55" width="32" height="4" fill="${agent.palette.accent}"/>`,
      }
    case "radagast":
      return {
        back: `<rect x="44" y="24" width="40" height="13" fill="#7c2d12"/><rect x="73" y="17" width="10" height="10" fill="${agent.palette.accent}"/>`,
        head: `<rect x="47" y="35" width="7" height="14" fill="#7c2d12"/><rect x="75" y="35" width="7" height="14" fill="#7c2d12"/>`,
        body: `<rect x="49" y="59" width="30" height="35" fill="#854d0e"/>`,
        front: `<rect x="55" y="66" width="18" height="6" fill="${agent.palette.accent}"/>`,
      }
    case "celebrimbor":
      return {
        back: `<rect x="49" y="22" width="30" height="8" fill="${agent.palette.light}"/><rect x="55" y="17" width="5" height="7" fill="${agent.palette.accent}"/><rect x="68" y="17" width="5" height="7" fill="${agent.palette.accent}"/>`,
        head: `<rect x="46" y="39" width="36" height="6" fill="${agent.palette.light}"/>`,
        body: `<rect x="48" y="58" width="32" height="30" fill="${agent.palette.dark}"/><rect x="55" y="63" width="18" height="8" fill="${agent.palette.border}"/>`,
        front: `<rect x="58" y="76" width="12" height="12" fill="${agent.palette.accent}"/>`,
      }
    case "elrond":
      return {
        back: `<rect x="47" y="25" width="34" height="10" fill="#111827"/><rect x="51" y="29" width="26" height="3" fill="${agent.palette.accent}"/>`,
        head: `<rect x="42" y="41" width="8" height="5" fill="${agent.palette.skin}"/><rect x="78" y="41" width="8" height="5" fill="${agent.palette.skin}"/>`,
        body: `<rect x="50" y="58" width="28" height="36" fill="${agent.palette.dark}"/><rect x="59" y="59" width="10" height="32" fill="${agent.palette.glow}"/>`,
        front: `<rect x="54" y="68" width="20" height="4" fill="${agent.palette.accent}"/>`,
      }
    case "galadriel":
      return {
        back: `<rect x="43" y="27" width="42" height="62" fill="#fde68a"/><rect x="50" y="24" width="28" height="4" fill="${agent.palette.glow}"/>`,
        head: `<rect x="45" y="38" width="6" height="18" fill="#fde68a"/><rect x="77" y="38" width="6" height="18" fill="#fde68a"/>`,
        body: `<rect x="48" y="58" width="32" height="38" fill="#fdf4ff"/><rect x="58" y="61" width="12" height="28" fill="${agent.palette.light}"/>`,
        front: `<rect x="58" y="72" width="12" height="12" fill="${agent.palette.glow}"/>`,
      }
    case "aragorn":
      return {
        back: `<rect x="44" y="27" width="40" height="12" fill="#1f2937"/><rect x="49" y="22" width="30" height="4" fill="${agent.palette.accent}"/>`,
        head: `<rect x="47" y="36" width="7" height="14" fill="#1f2937"/><rect x="74" y="36" width="7" height="14" fill="#1f2937"/>`,
        body: `<rect x="48" y="58" width="32" height="34" fill="${agent.palette.dark}"/><rect x="54" y="63" width="20" height="8" fill="${agent.palette.main}"/>`,
        front: `<rect x="61" y="79" width="6" height="18" fill="${agent.palette.light}"/>`,
      }
    default:
      return { back: "", head: "", body: "", front: "" }
  }
}

function prop(agent: AgentArt, bob: number, arm: number, index: number): string {
  const p = agent.palette
  const y = bob
  switch (agent.prop) {
    case "staff":
      return `<g transform="translate(0 ${y})"><rect x="92" y="28" width="5" height="82" fill="${p.accent}"/><rect x="88" y="21" width="13" height="13" fill="${p.glow}"/><rect x="91" y="24" width="7" height="7" fill="${p.border}"/></g>`
    case "bow":
      return `<g transform="translate(0 ${y})"><rect x="92" y="36" width="4" height="70" fill="${p.accent}"/><rect x="96" y="43" width="4" height="8" fill="${p.light}"/><rect x="96" y="91" width="4" height="8" fill="${p.light}"/><rect x="88" y="62" width="20" height="4" fill="${p.glow}"/></g>`
    case "leaf":
      return `<g transform="translate(0 ${y})"><rect x="92" y="62" width="5" height="42" fill="${p.dark}"/><rect x="86" y="40" width="18" height="20" fill="${p.accent}"/><rect x="92" y="44" width="14" height="18" fill="${p.glow}"/></g>`
    case "tree":
      return `<g transform="translate(0 ${y})"><rect x="91" y="58" width="8" height="46" fill="${p.dark}"/><rect x="82" y="34" width="26" height="18" fill="${p.accent}"/><rect x="78" y="48" width="34" height="16" fill="${p.main}"/></g>`
    case "hammer":
      return `<g transform="translate(0 ${y})"><rect x="91" y="42" width="6" height="60" fill="${p.accent}"/><rect x="82" y="33" width="24" height="12" fill="${p.light}"/><rect x="78" y="37" width="32" height="8" fill="${p.border}"/></g>`
    case "rune":
      return `<g transform="translate(0 ${y})"><rect x="88" y="36" width="24" height="24" fill="${p.dark}"/><rect x="94" y="40" width="4" height="16" fill="${p.glow}"/><rect x="98" y="48" width="8" height="4" fill="${p.accent}"/></g>`
    case "star":
      return `<g transform="translate(0 ${y})"><rect x="96" y="30" width="6" height="24" fill="${p.glow}"/><rect x="87" y="39" width="24" height="6" fill="${p.glow}"/><rect x="94" y="37" width="10" height="10" fill="${p.accent}"/></g>`
    case "sword":
      return `<g transform="translate(0 ${y})"><rect x="95" y="30" width="5" height="58" fill="${p.light}"/><rect x="90" y="82" width="15" height="5" fill="${p.accent}"/><rect x="96" y="87" width="3" height="20" fill="${p.dark}"/></g>`
    case "map":
      return `<g transform="translate(0 ${y})"><rect x="88" y="44" width="28" height="32" fill="${p.glow}"/><rect x="92" y="49" width="8" height="4" fill="${p.accent}"/><rect x="104" y="61" width="7" height="4" fill="${p.main}"/></g>`
    case "book":
      return `<g transform="translate(0 ${y})"><rect x="88" y="52" width="28" height="22" fill="${p.accent}"/><rect x="102" y="52" width="2" height="22" fill="${p.dark}"/><rect x="92" y="57" width="8" height="3" fill="${p.light}"/></g>`
    case "shield":
      return `<g transform="translate(0 ${y})"><rect x="90" y="47" width="24" height="28" fill="${p.dark}"/><rect x="94" y="51" width="16" height="18" fill="${p.accent}"/><rect x="100" y="51" width="4" height="18" fill="${p.glow}"/></g>`
    case "bug":
      return `<g transform="translate(0 ${y})"><rect x="90" y="52" width="22" height="18" fill="${index % 2 ? p.accent : p.glow}"/><rect x="94" y="48" width="4" height="4" fill="${p.light}"/><rect x="104" y="48" width="4" height="4" fill="${p.light}"/></g>`
    case "input":
      return `<g transform="translate(0 ${y})"><rect x="88" y="46" width="28" height="24" fill="${p.dark}"/><rect x="92" y="50" width="20" height="16" fill="${p.glow}"/><rect x="96" y="56" width="12" height="4" fill="${p.bg}"/></g>`
    default:
      return `<g transform="translate(0 ${y})"><rect x="91" y="44" width="22" height="22" fill="${p.accent}"/><rect x="96" y="49" width="12" height="12" fill="${p.glow}"/></g>`
  }
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}
