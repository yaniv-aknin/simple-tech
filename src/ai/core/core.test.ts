import {describe, expect, it} from 'vitest';
import {recordingKey, sentences} from './context.ts';
import {TASKS, countPaths} from './gpts.ts';
import {Corpus, generate} from './markov.ts';
import {prettyJoin, stripBoilerplate, tokenize} from './text.ts';
import {TOOL_LINE, scriptedReply, type WikiData} from './wiki.ts';

describe('text', () => {
  it('tokenizes words and punctuation, and joins them back', () => {
    const tokens = tokenize('"Well," said Mr. Holmes -- quietly.');
    expect(tokens).toEqual(['“', 'Well', ',', '”', 'said', 'Mr.', 'Holmes', ',', 'quietly', '.']);
    expect(prettyJoin(tokens)).toBe('“Well,” said Mr. Holmes, quietly.');
  });

  it('strips Gutenberg boilerplate', () => {
    const text =
      'licence\n*** START OF THE BOOK ***\nThe story.\nProject Gutenberg note\n*** END OF THE BOOK ***\nmore';
    expect(stripBoilerplate(text)).toBe('The story.\n');
  });
});

describe('markov', () => {
  it('only continues with words that followed in the corpus', () => {
    const corpus = new Corpus('The cat sat. The cat ran. A dog sat.');
    const steps = generate(corpus, 1, '', 20);
    for (const step of steps.filter(s => s.cands)) {
      expect(step.cands!.some(c => c.id === step.chosenId) || step.extra).toBeTruthy();
    }
  });

  it('marks text copied from the corpus at memory 3', () => {
    const corpus = new Corpus('One two three four five six seven eight nine ten eleven twelve.');
    const steps = generate(corpus, 3, '', 10);
    expect(steps.some(s => s.copied)).toBe(true);
  });
});

describe('gpts', () => {
  it('knows the answer to every maze', () => {
    for (const option of TASKS['s-m-l'].options) expect(String(countPaths(option.grid!))).toBe(option.truth);
    expect(countPaths('..\n..')).toBe(2);
  });
});

describe('context', () => {
  it('splits sentences without breaking after Mr.', () => {
    expect(sentences('Mr. Pickwick smiled. “Why?” he asked! Done')).toEqual([
      'Mr. Pickwick smiled.',
      '“Why?”',
      'he asked!',
      'Done',
    ]);
  });

  it('keys recordings by preset question', () => {
    const preset = 'In which novel does a character say "Barkis is willin\'", and what does it mean?';
    expect(recordingKey('stuff', preset, 'all')).toBe('stuff|barkis|all');
    expect(recordingKey('rag', preset, 'all')).toBe('rag|barkis|-');
    expect(recordingKey('rag', 'something else', 'book')).toBeNull();
  });
});

describe('wiki', () => {
  const script: WikiData = {
    exchanges: [
      {user: 'Hi', response: {text: 'Hello', latency_ms: 1}},
      {user: 'Who?', response: {text: '#WIKIPEDIA Someone', latency_ms: 1}},
      {tool_title: 'Someone', tool_chars: 100, response: {text: 'They did a thing.', latency_ms: 1}},
    ],
  };

  it('replays the script while the conversation follows it', () => {
    const tool = `Result of #WIKIPEDIA Someone:\n\n${'x'.repeat(80)}`;
    const messages = [
      {role: 'user', content: 'Hi'},
      {role: 'assistant', content: 'Hello'},
      {role: 'user', content: 'Who?'},
      {role: 'assistant', content: '#WIKIPEDIA Someone'},
      {role: 'user', content: tool},
    ] as const;
    expect(scriptedReply(script, [...messages.slice(0, 1)])?.text).toBe('Hello');
    expect(scriptedReply(script, [...messages])?.text).toBe('They did a thing.');
    expect(scriptedReply(script, [{role: 'user', content: 'Hey'}])).toBeNull();
  });

  it('finds the tool line', () => {
    expect(TOOL_LINE.exec('Let me check.\n#WIKIPEDIA Dolly Parton ')?.[1]).toBe('Dolly Parton');
  });
});
