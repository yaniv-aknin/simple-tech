/** A few words about each page, by its tab's demo key or page path, shown by the sidebar's help button. */
export const HELP: Record<string, string> = {
  pong: `
    <p>A whole computer: a CPU and 256 bytes of RAM. The program is stored in the RAM too, as numbers, and the
    CPU runs it one instruction at a time.</p>
    <p>Turn it on and follow the highlighted line in the program. The screen only draws what is in a few bytes of
    RAM, and the ← and → keys write into another. Set the clock to 1 to follow every step.</p>`,
  procs: `
    <p>A CPU core runs one program at a time. To run several at once, a timer interrupts it every few
    instructions, and a small program, the kernel, saves where the current process was and switches to the
    next.</p>
    <p>Add processes, and each counts more slowly. Add cores, and they speed up again. Show the kernel to watch
    the switching itself.</p>`,
  'computer/virtual-memory/': `
    <p>Each program here believes it has all 256 bytes of memory to itself, starting at address 0. In fact they
    share a much smaller physical memory.</p>
    <p>Each program's page table says which frame of physical memory holds each 4-byte page of its memory. A
    page gets a frame the first time it is used. When no frame is free, the program that needed one
    crashes.</p>`,
  'ai/markov/build/': `
    <p>A Markov chain is simple: you could make one right now, with a pencil and paper. It is just tedious.</p>
    <p>Read the text, and for every pair of words, count which word comes next, and how often. That table of
    counts is the whole chain.</p>`,
  'ai/markov/predict/': `
    <p>To write with the chain, look at the last two words, and pick the next word at random, weighted by the
    counts in the table.</p>
    <p>The result is drivel, but drivel that sounds like the original. Sherlock Holmes comes out noticeably
    unlike Jane Austen. (At the Attio offsite we also had the script of The Big Lebowski, and our sales
    procedure.)</p>`,
  'ai/gpts/gpt2-markov/': `
    <p>A Markov chain always sounds like the text it learned from, whatever you start it with.</p>
    <p>GPT-2 is pretty useless, but it doesn't just sound like something: it gets the topic of the text in front
    of it, and stays on it.</p>`,
  'ai/gpts/2-4-6/': `
    <p>A simple maths riddle about apples.</p>
    <p>GPT-2 doesn't try to answer: it carries on about apples and orchards, or maths and digits. GPT-4
    answers, wrongly. GPT-6 answers correctly.</p>`,
  'ai/gpts/s-m-l-apples/': `
    <p>Luna, Sol and Astra are a small, a medium and a large GPT-6.</p>
    <p>All three solve the apple riddle. For a question this easy, the small model does as well as the
    large one.</p>`,
  'ai/gpts/s-m-l/': `
    <p>Luna, Sol and Astra, a small, a medium and a large GPT-6, all count the paths through a 4×4 maze.</p>
    <p>At 8×8 Luna fails, and at 16×16 so does Sol. The maze has become too much to hold in their heads.</p>`,
  'ai/gpts/wikipedia/': `
    <p>A model only knows what it read in training, and what is in the conversation.</p>
    <p>When Luna wants to look something up, it writes a line like <code>#WIKIPEDIA &lt;article title&gt;</code>.
    I dutifully copy that article from Wikipedia and paste it into the conversation, and now the model has
    fresh information. That is all a tool call is. Turn on Auto tools to have the page do the copying.</p>`,
  'ai/gpts/python/': `
    <p>Tool calls can be quite flexible. Here the tool is Python: the model writes a little program, the
    browser runs it, and the output goes back to the model.</p>
    <p>With code on, Luna solves the 16×16 maze, or a 256×256 one if there are enough walls.</p>`,
  'ai/gpts/context/': `
    <p>Three ways to ask about more text than a model can read at once: here, sixteen Dickens novels.</p>
    <p><b>Context stuffing</b> puts all the text in the prompt. It is thorough, but only while the text fits,
    and it is slow and costly.</p>
    <p><b>RAG</b> (retrieval-augmented generation) searches the text for the passages most like the question,
    and gives the model only those. It is fast and cheap, but misses whatever the search didn't find.</p>
    <p><b>Sub-agents</b> (map-reduce) give each book to a model of its own, and one more combines their
    answers. It reads everything, at the cost of many calls.</p>`,
};
