export type SpecKind = "recipe" | "procedure";

export type SpecSource = "drive" | "phone" | "starter";

export type Spec = {
  id: string;
  title: string;
  kind: SpecKind;
  source: SpecSource;
  driveFileId?: string;
  mimeType?: string;
  photoDataUrl?: string;
  time?: string;
  servings?: string;
  ingredients: string[];
  materials: string[];
  steps: string[];
  notes?: string;
  spokenIntro: string;
  updatedAt: number;
};

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
};

export type DriveStatus =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "login"; message: string; loginUrl?: string }
  | { state: "not_connected"; message: string }
  | { state: "ready"; folderName: string; fileCount: number }
  | { state: "missing_folder"; message: string }
  | { state: "error"; message: string };

export type VoiceCommand =
  | "next"
  | "repeat"
  | "back"
  | "stop"
  | "ingredients"
  | "start-over"
  | "list";

export type Intent =
  | { type: "command"; command: VoiceCommand }
  | { type: "lookup"; query: string; kindHint?: SpecKind }
  | { type: "unknown"; raw: string };

export type AgentPhase =
  | "idle"
  | "listening"
  | "capturing"
  | "thinking"
  | "speaking"
  | "awaiting"
  | "error";

export type ExtractedSpec = {
  title: string;
  kind: SpecKind;
  time?: string;
  servings?: string;
  ingredients: string[];
  materials: string[];
  steps: string[];
  notes?: string;
  spokenIntro: string;
};
