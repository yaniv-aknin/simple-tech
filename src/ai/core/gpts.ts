import {chat, type Json, type Post, type WireRecord} from './openai.ts';

export const RUNS = 5;
export const LIVE_MAZE_TOKENS = 16000;

export interface Model {
  id: string;
  name: string;
  sub: string;
  /** OpenAI's paper or system card for the model: a file under public/ai/papers/. */
  paper?: string;
  api?: string;
  params?: Json;
  /** Only recorded answers exist: the model cannot be run any more. */
  frozen?: boolean;
  /** Runs in the browser instead of through an API. */
  client?: {corpus: string; order: number};
}

export interface Option {
  id: string;
  title?: string;
  sub?: string;
  emoji?: string;
  prompt: string;
  grid?: string;
  truth?: string;
  compact?: boolean;
  default?: boolean;
  models: Model[];
}

export interface Task {
  title: string;
  runs?: number;
  multiline?: boolean;
  options: Option[];
}

export interface GptsData {
  speed: string;
  entries: Record<string, WireRecord>;
}

const APPLES =
  'I have 3 apples. I eat one, buy five more, then give half of what I have to a friend. ' +
  'How many apples do I have left? Answer with just the number.';

const GRID_4 = `...#
.#..
....
.#..`;

const GRID_8 = `..#.....
...###..
#.....##
........
......#.
........
.#.##.#.
......#.`;

const GRID_16 = `...##.......#...
.....##.......#.
#...#.........#.
................
..#.............
..#...#.#....#..
.....#.#.#.#.#..
##..#.##...#.#..
.........#..#...
#....#.#####....
...........##.#.
.##.............
#..##........#.#
...#.....#...#.#
.....###....#...
................`;

const GLORP =
  'A glorp is a small blue animal that lives in the mountains of Peru. Glorps eat mostly berries. ' +
  'One morning, a farmer found a glorp.';
const CAPITALS = 'France: Paris\nJapan: Tokyo\nKenya: Nairobi\nCanada:';

/** The deduction scene from A Scandal in Bohemia (texts/holmes.txt), followed by the TL;DR cue. */
const HOLMES_TLDR =
  [
    'His manner was not effusive. It seldom was; but he was glad, I think, to see me. With hardly a word spoken, but with a kindly eye, he waved me to an armchair, threw across his case of cigars, and indicated a spirit case and a gasogene in the corner. Then he stood before the fire and looked me over in his singular introspective fashion.',
    '“Wedlock suits you,” he remarked. “I think, Watson, that you have put on seven and a half pounds since I saw you.”',
    '“Seven!” I answered.',
    '“Indeed, I should have thought a little more. Just a trifle more, I fancy, Watson. And in practice again, I observe. You did not tell me that you intended to go into harness.”',
    '“Then, how do you know?”',
    '“I see it, I deduce it. How do I know that you have been getting yourself very wet lately, and that you have a most clumsy and careless servant girl?”',
    '“My dear Holmes,” said I, “this is too much. You would certainly have been burned, had you lived a few centuries ago. It is true that I had a country walk on Thursday and came home in a dreadful mess, but as I have changed my clothes I can’t imagine how you deduce it. As to Mary Jane, she is incorrigible, and my wife has given her notice, but there, again, I fail to see how you work it out.”',
    'He chuckled to himself and rubbed his long, nervous hands together.',
    '“It is simplicity itself,” said he; “my eyes tell me that on the inside of your left shoe, just where the firelight strikes it, the leather is scored by six almost parallel cuts. Obviously they have been caused by someone who has very carelessly scraped round the edges of the sole in order to remove crusted mud from it. Hence, you see, my double deduction that you had been out in vile weather, and that you had a particularly malignant boot-slitting specimen of the London slavey. As to your practice, if a gentleman walks into my rooms smelling of iodoform, with a black mark of nitrate of silver upon his right forefinger, and a bulge on the right side of his top-hat to show where he has secreted his stethoscope, I must be dull, indeed, if I do not pronounce him to be an active member of the medical profession.”',
  ].join('\n\n') + '\n\nTL;DR:';

function versusOption(
  id: string,
  title: string,
  emoji: string,
  prompt: string,
  extra: Partial<Option> = {},
): Option {
  return {
    id,
    title,
    sub: '',
    emoji,
    prompt,
    ...extra,
    models: [
      {id: 'gpt-2', name: 'GPT-2', sub: 'reads the whole text', frozen: true},
      {
        id: 'markov',
        name: 'Markov chain',
        sub: 'remembers 2 words',
        client: {corpus: 'holmes.txt', order: 2},
      },
    ],
  };
}

export function countPaths(grid: string) {
  const rows = grid.split('\n');
  const ways = rows.map(row => Array<number>(row.length).fill(0));
  ways[0][0] = 1;
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === '.' && (r || c)) ways[r][c] = (r ? ways[r - 1][c] : 0) + (c ? ways[r][c - 1] : 0);
    }),
  );
  return ways[rows.length - 1][rows[0].length - 1];
}

function mazePrompt(grid: string) {
  const n = grid.split('\n').length;
  return (
    `In this ${n}x${n} grid, '#' is a wall and '.' is open. Starting at the top-left cell and moving only ` +
    `right or down, how many different paths reach the bottom-right cell?\n${grid}\nAnswer with just the number.`
  );
}

const reasoning = (maxTokens: number) => ({reasoning_effort: 'low', max_completion_tokens: maxTokens});

function gpt6Models(maxTokens: number): Model[] {
  return [
    {id: 'luna', name: 'Luna', sub: 'small', api: 'gpt-6-luna', params: reasoning(maxTokens)},
    {id: 'sol', name: 'Sol', sub: 'medium', api: 'gpt-6-sol', params: reasoning(maxTokens)},
    {id: 'astra', name: 'Astra', sub: 'large', api: 'gpt-6-astra', params: reasoning(maxTokens)},
  ];
}

function mazeOption(size: number, grid: string, maxTokens: number, extra: Partial<Option> = {}): Option {
  return {
    id: String(size),
    title: `${size}×${size} maze`,
    sub: 'Count the paths',
    emoji: '🧩',
    prompt: mazePrompt(grid),
    grid,
    truth: String(countPaths(grid)),
    models: gpt6Models(maxTokens),
    ...extra,
  };
}

export const TASKS: Record<string, Task> = {
  '2-4-6': {
    title: 'GPT Then and Now',
    options: [
      {
        id: 'apples',
        prompt: APPLES,
        truth: '3.5',
        models: [
          {
            id: 'gpt-2',
            name: 'GPT-2',
            sub: '2019',
            paper: 'language_models_are_unsupervised_multitask_learners.pdf',
            frozen: true,
          },
          {
            id: 'gpt-4',
            name: 'GPT-4',
            sub: '2023',
            paper: 'gpt-4-system-card.pdf',
            api: 'gpt-4',
            params: {max_tokens: 250},
            frozen: true,
          },
          {
            id: 'gpt-6',
            name: 'GPT-6',
            sub: '2026',
            paper: 'gpt-6-astra.pdf',
            api: 'gpt-6-sol',
            params: reasoning(3000),
          },
        ],
      },
    ],
  },
  's-m-l-apples': {
    title: "Size isn't Everything",
    options: [{id: 'apples', prompt: APPLES, truth: '3.5', models: gpt6Models(3000)}],
  },
  'gpt2-markov': {
    title: 'GPT2 vs Markov',
    runs: 3,
    multiline: true,
    options: [
      versusOption('glorp', 'Glorp', '🐾', GLORP),
      versusOption('capitals', 'Capitals', '🌍', CAPITALS, {compact: true}),
      versusOption('tldr', 'TL;DR', '🔍', HOLMES_TLDR),
    ],
  },
  's-m-l': {
    title: "Size isn't Everything",
    options: [
      mazeOption(4, GRID_4, 4000),
      mazeOption(8, GRID_8, 8000, {default: true}),
      mazeOption(16, GRID_16, 16000),
    ],
  },
};

export const taskRuns = (task: Task) => task.runs ?? RUNS;

export const entryKey = (taskId: string, optionId: string, modelId: string, run: number | string) =>
  `${taskId}/${optionId}/${modelId}/${run}`;

export const speedOf = (data: {speed?: string}) => {
  const speed = Number(data.speed ?? 1);
  return speed > 0 ? speed : 1;
};

/** One live run of `model` on `prompt`, with the larger token budget edited mazes get. */
export function runLive(post: Post, taskId: string, model: Model, prompt: string) {
  if (!model.api || model.frozen) throw new Error(`${model.name} is not available live`);
  const params =
    taskId === 's-m-l' ? {...model.params, max_completion_tokens: LIVE_MAZE_TOKENS} : model.params;
  return chat(post, model.api, prompt, params);
}
