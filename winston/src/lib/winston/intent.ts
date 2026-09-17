import type { Intent, SpecKind, VoiceCommand } from "./types";

const WAKE_NAME =
  "(?:win\\s*ston|winston|winson|winsten|winstin|winstan|whenston|whinston|winstone)";

const WAKE_ONLY = new RegExp(
  `^(?:ok(?:ay)?|hey+|hi+|hello|yo|hay)\\s+${WAKE_NAME}[.!?]*$`,
  "i",
);

const HANDS_FREE: VoiceCommand[] = [
  "next",
  "repeat",
  "back",
  "stop",
  "ingredients",
  "start-over",
];

const COMMANDS: { re: RegExp; command: VoiceCommand }[] = [
  {
    re: /^(next|next step|what(?:'| i)?s next)[.!?]*$/i,
    command: "next",
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
    re: /^(stop|that's enough|never ?mind)[.!?]*$/i,
    command: "stop",
  },
  {
    re: /^(ingredients|what do i need)[.!?]*$/i,
    command: "ingredients",
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
  const anywhere = new RegExp(
    `(?:^|\\s)(?:ok(?:ay)?|hey+|hi+|hello|yo|hay)\\s+${WAKE_NAME}\\b[,.!?]*\\s*`,
    "i",
  );
  const match = anywhere.exec(trimmed);
  if (match && match.index !== undefined) {
    const rest = trimmed.slice(match.index + match[0].length).trim();
    return { woke: true, rest };
  }
  return { woke: false, rest: trimmed };
}

export function parseIntent(text: string): Intent {
  let rest = text.trim().replace(/\s+/g, " ");
  if (!rest) return { type: "unknown", raw: text };

  for (const { re, command } of COMMANDS) {
    if (re.test(rest)) return { type: "command", command };
  }

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

  if (stripped.length < 3) return { type: "unknown", raw: text };

  return { type: "lookup", query: stripped, kindHint };
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
