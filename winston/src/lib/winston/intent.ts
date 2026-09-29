import type { Intent, SpecKind, VoiceCommand } from "./types";
import { parseShiftTime } from "./hours";
import { matchStation, spokenFreq, wantsRadioOff } from "./stations";

const WAKE_NAME =
  "(?:win\\s*ston|winston|winson|winsten|winstin|winstan|whenston|whinston|winstone)";

const WAKE_ONLY = new RegExp(
  `^(?:(?:ok(?:ay)?|hey+|hi+|hello|yo|hay)\\s+)?${WAKE_NAME}[.!?]*$`,
  "i",
);

const HANDS_FREE: VoiceCommand[] = [
  "steps",
  "repeat",
  "back",
  "close",
  "ingredients",
  "start-over",
  "half",
  "double",
  "full-batch",
];

const COMMANDS: { re: RegExp; command: VoiceCommand }[] = [
  {
    re: /^(steps|all steps|the steps|read(?:\s+(?:the|all))?\s+steps|next|next step|what(?:'| i)?s next)[.!?]*$/i,
    command: "steps",
  },
  {
    re: /^(repeat|say that again|repeat that)[.!?]*$/i,
    command: "repeat",
  },
  {
    re: /^(go back|previous step|last step)[.!?]*$/i,
    command: "back",
  },
  {
    re: /^(close(?:\s+(?:the\s+)?(?:spec|card|recipe|it))?|stop|that's enough|never ?mind)[.!?]*$/i,
    command: "close",
  },
  {
    re: /^(ingredients|what do i need)[.!?]*$/i,
    command: "ingredients",
  },
  {
    re: /^(half(?:\s*(?:batch|recipe|size))?|one half|1\s*\/\s*2|the half)[.!?]*$/i,
    command: "half",
  },
  {
    re: /^(double(?:\s*(?:batch|recipe|size))?|two times|2\s*x|2x|twice)[.!?]*$/i,
    command: "double",
  },
  {
    re: /^(full(?:\s*(?:batch|recipe|size))?|standard|regular(?:\s*batch)?)[.!?]*$/i,
    command: "full-batch",
  },
  {
    re: /^(start over|from the beginning)[.!?]*$/i,
    command: "start-over",
  },
  {
    re: /^(what(?:'| i)?s in specs|list specs|what do you have)[.!?]*$/i,
    command: "list",
  },
];

const FILLER =
  /^(please|can you|could you|would you|i (?:want|need)|tell me|read(?: me)?|give me|find(?: me)?|look up)\s+/i;

const STEP_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

function parseStepNumber(token: string): number | null {
  const t = token.toLowerCase().replace(/(?:st|nd|rd|th)$/i, "");
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n > 0 ? n : null;
  }
  return STEP_WORDS[t] ?? null;
}

export function parseStepAsk(text: string): number | null {
  const t = text.trim().replace(/\s+/g, " ").replace(/\?+$/, "");
  const a = t.match(
    /^(?:what(?:'| i)?s\s+)?(?:(?:read|say|tell me)\s+)?(?:step|the step)\s+(?:number\s+)?([a-z0-9]+)[.!?]*$/i,
  );
  if (a?.[1]) return parseStepNumber(a[1]);
  const b = t.match(/^(?:the\s+)?([a-z0-9]+)\s+step[.!?]*$/i);
  if (b?.[1]) return parseStepNumber(b[1]);
  return null;
}

export function foldHeard(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(
      /\b(hi|high|tie|tai|ty|thigh)(?=\s+(curry|bbq|barbecue|barbeque|bowl|noodle|noodles|food|chicken|beef|shrimp|basil|peanut))\b/gi,
      "thai",
    )
    .replace(/^(hi|tie|tai|ty)\b/i, "thai");
}

export function isHandsFreeCommand(command: VoiceCommand) {
  return HANDS_FREE.includes(command);
}

export function stripWake(text: string): { woke: boolean; rest: string } {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return { woke: false, rest: "" };
  if (WAKE_ONLY.test(trimmed)) {
    return { woke: true, rest: "" };
  }
  const atStart = new RegExp(
    `^(?:(?:ok(?:ay)?|hey+|hi+|hello|yo|hay|um+|uh+|so)\\s+)*${WAKE_NAME}\\b[,.!?]*\\s*`,
    "i",
  );
  const match = atStart.exec(trimmed);
  if (match) {
    const rest = trimmed.slice(match[0].length).trim();
    return { woke: true, rest };
  }
  const buried = trimmed.match(new RegExp(`\\b${WAKE_NAME}\\b[,.!?]*\\s*(.*)$`, "i"));
  if (buried) {
    return { woke: true, rest: (buried[1] ?? "").trim() };
  }
  return { woke: false, rest: trimmed };
}

/** Pull a spec command out of a noisy line, such as radio talk around "steps". */
export function looseSpecCommand(text: string): Intent | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return null;
  const step = parseStepAsk(t) ?? parseStepAsk(t.replace(/^.*\b(?:winston|winson|winsten)\b/i, "").trim());
  if (step) return { type: "goto-step", n: step };
  if (/\b((?:read|say)\s+(?:me\s+)?)?(?:the\s+|all\s+(?:the\s+)?)?steps\b/i.test(t)) {
    return { type: "command", command: "steps" };
  }
  if (/\brepeat\b/i.test(t) && t.split(/\s+/).length <= 6) {
    return { type: "command", command: "repeat" };
  }
  if (/\b(close|stop)\b/i.test(t) && /\b(spec|card|recipe|it|that)\b/i.test(t)) {
    return { type: "command", command: "close" };
  }
  if (/^(close|stop)[.!?]*$/i.test(t)) return { type: "command", command: "close" };
  return null;
}

export function parseIntent(text: string): Intent {
  let rest = text.trim().replace(/\s+/g, " ");
  if (!rest) return { type: "unknown", raw: text };

  if (wantsRadioOff(rest)) return { type: "radio-stop" };
  if (
    /^(?:play|put on|turn on|start)(?:\s+(?:the|some))?\s+radio[.!?]*$/i.test(rest) ||
    /^radio[.!?]*$/i.test(rest)
  ) {
    return { type: "radio", query: "" };
  }
  const tuned = rest.match(/^(?:play|put on|tune(?:\s+to)?|start)\s+(.+?)[.!?]*$/i);
  if (tuned?.[1] && (matchStation(tuned[1]) || spokenFreq(tuned[1]))) {
    return { type: "radio", query: tuned[1] };
  }
  const clockedIn = rest.match(/^(?:clock|punch|check)\s*in(?:\s+(?:for|at|to|around))?\s*(.*?)[.!?]*$/i);
  if (clockedIn) {
    const said = (clockedIn[1] ?? "").trim();
    const at = said ? parseShiftTime(said) : null;
    return { type: "clock-in", at, missed: Boolean(said) && at == null };
  }
  const clockedOut = rest.match(/^(?:clock|punch|check)\s*out(?:\s+(?:for|at|to|around))?\s*(.*?)[.!?]*$/i);
  if (clockedOut) {
    const said = (clockedOut[1] ?? "").trim();
    const at = said ? parseShiftTime(said) : null;
    return { type: "clock-out", at, missed: Boolean(said) && at == null };
  }
  if (/^(?:my hours|show(?: me)?(?: my)? hours|time\s*sheet|timesheet|hours)[.!?]*$/i.test(rest)) {
    return { type: "hours" };
  }

  for (const { re, command } of COMMANDS) {
    if (re.test(rest)) return { type: "command", command };
  }

  const stepNow = parseStepAsk(rest);
  if (stepNow) return { type: "goto-step", n: stepNow };

  rest = rest.replace(FILLER, "").trim();

  let kindHint: SpecKind | undefined;
  if (/\b(recipe|cook|bake|make)\b/i.test(rest)) kindHint = "recipe";
  if (/\b(procedure|process|how to|steps for|instructions)\b/i.test(rest)) {
    kindHint = "procedure";
  }

  const stripped = rest
    .replace(
      /^(what(?:'| i)?s\s+the\s+)?(recipe|procedure|process|instructions?)\s+(for|to|on)\s+/i,
      "",
    )
    .replace(/^(how do i|how to|how can i)\s+/i, "")
    .replace(/^(the\s+)?(recipe|procedure|process)\s+(for|to)\s+/i, "")
    .replace(/^(what(?:'| i)?s\s+)/i, "")
    .replace(/\?+$/, "")
    .trim();

  if (!stripped) return { type: "unknown", raw: text };

  if (COMMANDS.some(({ re }) => re.test(stripped))) {
    const hit = COMMANDS.find(({ re }) => re.test(stripped));
    if (hit) return { type: "command", command: hit.command };
  }

  const stepLater = parseStepAsk(stripped);
  if (stepLater) return { type: "goto-step", n: stepLater };

  if (stripped.length < 3) return { type: "unknown", raw: text };

  return { type: "lookup", query: stripped, kindHint };
}

export function isRecipeAsk(text: string) {
  const t = text.toLowerCase().trim();
  if (!t) return false;
  return /\b(recipe|procedure|process|spec sheet|spec card|\bcards?\b|ingredients|how do i make|how to make|how do i cook|how to cook)\b/.test(
    t,
  );
}

export function spokenList(titles: string[]): string {
  if (titles.length === 0) {
    return "I don't have any of your specs loaded yet. Add a photo of a recipe or process.";
  }
  if (titles.length === 1) return `I have ${titles[0]}.`;
  if (titles.length === 2) return `I have ${titles[0]} and ${titles[1]}.`;
  const head = titles.slice(0, -1).join(", ");
  const last = titles[titles.length - 1];
  return `I have ${titles.length} cards. ${head}, and ${last}.`;
}
