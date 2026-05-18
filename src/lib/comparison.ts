export type Priority =
  | "price"
  | "quality"
  | "convenience"
  | "risk"
  | "durability";

export type AgentName =
  | "value"
  | "fit"
  | "risk"
  | "evidence"
  | "longevity";

export interface OptionInput {
  id: string;
  name: string;
  url?: string;
  notes?: string;
}

export type PriorityWeights = Record<Priority, number>;

export interface ComparisonInput {
  prompt?: string;
  options: OptionInput[];
  priorities: PriorityWeights;
  mustHaves?: string;
  dealBreakers?: string;
}

export interface AgentScore {
  agent: AgentName;
  score: number;
  rationale: string;
}

export interface ScoredOption {
  id: string;
  name: string;
  url?: string;
  notes?: string;
  finalScore: number;
  agentScores: AgentScore[];
  rank: number;
}

export interface ComparisonSignals {
  confidence: number;
  uncertainty: string[];
  whatWouldChange: string[];
}

export interface ComparisonResult {
  topPick: ScoredOption;
  shortlist: ScoredOption[];
  ranked: ScoredOption[];
  signals: ComparisonSignals;
  receiptPayloadHash: string;
}

export const DEFAULT_PRIORITIES: PriorityWeights = {
  price: 50,
  quality: 50,
  convenience: 50,
  risk: 50,
  durability: 50,
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  price: "Price",
  quality: "Quality",
  convenience: "Convenience",
  risk: "Risk tolerance",
  durability: "Durability",
};

export const AGENT_LABELS: Record<AgentName, string> = {
  value: "Value analyst",
  fit: "Fit analyst",
  risk: "Risk analyst",
  evidence: "Evidence analyst",
  longevity: "Long-term analyst",
};

const AGENT_PRIORITY_BIAS: Record<AgentName, Priority[]> = {
  value: ["price", "quality"],
  fit: ["convenience", "quality"],
  risk: ["risk"],
  evidence: ["quality"],
  longevity: ["durability", "quality"],
};

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

function hashToUnit(input: string): number {
  return fnv1a(input) / 0xffffffff;
}

function shortHash(input: string): string {
  return fnv1a(input).toString(16).padStart(8, "0");
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function priorityVector(weights: PriorityWeights, agent: AgentName): number {
  const biased = AGENT_PRIORITY_BIAS[agent];
  const sum = biased.reduce((acc, p) => acc + weights[p], 0);
  return sum / (biased.length * 100);
}

function scoreAgent(
  option: OptionInput,
  agent: AgentName,
  weights: PriorityWeights,
  saltedPrompt: string,
): AgentScore {
  const seed = `${agent}::${option.id}::${option.name}::${saltedPrompt}`;
  const base = hashToUnit(seed);
  const bias = priorityVector(weights, agent);
  const raw = 0.55 * base + 0.45 * bias;
  const score = clamp(Math.round(raw * 100), 1, 99);
  const rationale = buildRationale(agent, score, option, weights);
  return { agent, score, rationale };
}

function buildRationale(
  agent: AgentName,
  score: number,
  option: OptionInput,
  weights: PriorityWeights,
): string {
  const tier = score >= 75 ? "strong" : score >= 55 ? "decent" : "weak";
  const focusPriority = AGENT_PRIORITY_BIAS[agent][0];
  const focusWeight = weights[focusPriority];
  switch (agent) {
    case "value":
      return `${tier} value read given price weight ${focusWeight}`;
    case "fit":
      return `${tier} fit against your stated priorities`;
    case "risk":
      return `${tier} risk profile for "${option.name}"`;
    case "evidence":
      return `${tier} evidence depth in source notes`;
    case "longevity":
      return `${tier} durability outlook for ${focusWeight}-weighted longevity`;
  }
}

function inputSalt(input: ComparisonInput): string {
  const weights = (Object.keys(input.priorities) as Priority[])
    .sort()
    .map((k) => `${k}=${input.priorities[k]}`)
    .join("|");
  return [
    input.prompt ?? "",
    weights,
    input.mustHaves ?? "",
    input.dealBreakers ?? "",
  ].join("::");
}

function aggregate(_option: OptionInput, agentScores: AgentScore[]): number {
  const sum = agentScores.reduce((a, s) => a + s.score, 0);
  return Math.round((sum / agentScores.length) * 10) / 10;
}

function buildSignals(
  ranked: ScoredOption[],
  input: ComparisonInput,
): ComparisonSignals {
  const top = ranked[0];
  const second = ranked[1];
  const gap = top && second ? top.finalScore - second.finalScore : 100;
  const confidence = clamp(Math.round(50 + gap * 1.5), 30, 95);
  const uncertainty: string[] = [];
  if (gap < 5) {
    uncertainty.push("Top pick and runner-up are within 5 points");
  }
  if (input.options.length < 3) {
    uncertainty.push("Fewer than 3 options reduces comparison strength");
  }
  if (!input.mustHaves && !input.dealBreakers) {
    uncertainty.push("No must-haves or deal-breakers provided");
  }
  const whatWouldChange: string[] = [];
  const sortedPriorities = (Object.keys(input.priorities) as Priority[])
    .sort((a, b) => input.priorities[b] - input.priorities[a]);
  whatWouldChange.push(
    `Lowering ${PRIORITY_LABELS[sortedPriorities[0]]} weight could shift the ranking`,
  );
  whatWouldChange.push("Adding evidence notes per option would raise confidence");
  return { confidence, uncertainty, whatWouldChange };
}

export function runComparison(input: ComparisonInput): ComparisonResult {
  if (input.options.length === 0) {
    throw new Error("At least one option is required");
  }
  const salt = inputSalt(input);
  const agents: AgentName[] = ["value", "fit", "risk", "evidence", "longevity"];

  const ranked: ScoredOption[] = input.options
    .map((option) => {
      const agentScores = agents.map((a) =>
        scoreAgent(option, a, input.priorities, salt),
      );
      return {
        id: option.id,
        name: option.name,
        url: option.url,
        notes: option.notes,
        agentScores,
        finalScore: aggregate(option, agentScores),
        rank: 0,
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const shortlist = ranked.slice(0, Math.min(3, ranked.length));
  const signals = buildSignals(ranked, input);
  const receiptPayloadHash = shortHash(
    `${salt}::${ranked.map((r) => `${r.id}=${r.finalScore}`).join(",")}`,
  );

  return {
    topPick: ranked[0],
    shortlist,
    ranked,
    signals,
    receiptPayloadHash,
  };
}

export function makeOptionId(): string {
  const seed = `opt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return shortHash(seed);
}
