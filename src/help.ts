/** A few words about each page, by its tab's demo key or page path, shown by the sidebar's help button. */
export const HELP: Record<string, string> = {
  pong: `
    <p>Shows how a computer runs the game "pong". We simulate a simple CPU with 256 bytes of RAM and can
    see how things like memory and registers behave during execution.</p>`,
  procs: `
    <p>Illustrating concurrency vs parallelism. We have a simple program that increments a counter, we can run
    several copies of it at once (concurrency), and we can optionally run on multiple cores (parallelism).</p>
    <p>We also have a simplified "kernel" that switches between the "processes"; the kernel itself takes up
    memory and instructions, of course.</p>`,
  'computer/virtual-memory/': `
    <p>Illustrating memory protection and how each program believes it has the entire memory space to itself.
    We also see how virtual memory is mapped to physical pages, and how various conditions can cause a
    program to crash.</p>`,
  'ai/markov/build/': `
    <p>We prepare a Markov chain in front of your eyes: go over a piece of text and keep track of which words
    follow each other. The result is a table of counts, which creates text surprisingly like the original.</p>`,
  'ai/markov/predict/': `
    <p>Now we use Markov chains to generate some text, and we see how they retain the "feel" of the original.
    We also see how chain length affects quality, and importantly we can notice that generating plausible text
    is far from understanding it or doing anything useful.</p>`,
  'ai/gpts/gpt2-markov/': `
    <p>A Markov chain always sounds like the text it learned from, whatever you start it with. GPT-2 isn't very
    useful, but it doesn't just sound like something: it really gets the topic of the text in front of it, and
    stays on it.</p>
    <p>If we talk about glorps, GPT-2 will talk about glorps. If we talk about capitals, so will it. And if we
    give it some text and the words "TL;DR" at the end, it will do something like a summary.</p>`,
  'ai/gpts/2-4-6/': `
    <p>A simple maths riddle about apples. We see the huge difference between GPT versions. GPT-2 doesn't even
    try to answer, but it does talk about apples and orchards or maths and digits. GPT-4 answers, but incorrectly.
    GPT-6 answers, correctly.</p>`,
  'ai/gpts/s-m-l-apples/': `
    <p>Illustrates how bigger models aren't always better. Luna, Sol and Astra are versions of GPT-6, small,
    medium and large.</p>
    <p>All three solve the apple riddle easily. We see how the small model does as well as the
    large one while being faster and cheaper.</p>`,
  'ai/gpts/s-m-l/': `
    <p>Illustrates the difference between model sizes. Luna, Sol and Astra all count the paths through a 4×4
    maze.</p>
    <p>At 8×8 Luna fails, and at 16×16 so does Sol. The maze has become too much to "hold in their heads",
    but Astra is "smarter" so it can still solve it.</p>`,
  'ai/gpts/wikipedia/': `
    <p>A model only knows what it read in training, and what is in the conversation. Tools give it a way to get
    more information.</p>
    <p>We chat with Luna and see how it "remembers" some things (like temperature conversions), but doesn't
    know of current events (like that Dolly Parton passed away). By giving it a "tool" -- just printing
    <code>#WIKIPEDIA &lt;article title&gt;</code> to look something up -- it can use fresh information.</p>`,
  'ai/gpts/python/': `
    <p>Tool calls can be quite flexible. Here the tool is Python: the model writes a little program, the
    browser runs it, and the output goes back to the model. We see how Luna solves the 16×16 maze easily
    with Python.</p>`,
  'ai/gpts/context/': `
    <p>We look at three ways to handle large context. Stuffing simply sticks everything into the prompt and hopes
    the model figures it out. RAG (retrieval-augmented generation) searches the text for the passages most like
    the question, and gives the model only those. It is fast and cheap, but misses whatever the search didn't find.
    Sub-agents (really "LLM-map-reduce") give each book to a model of its own, and one more combines their answers.
    It reads everything, at the cost of many calls.</p>`,
};
